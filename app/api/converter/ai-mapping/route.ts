import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface MappingRequest {
  templateColumns: string[];
  dataColumns: string[];
  templateSampleData?: Record<string, unknown>[];
  dataSampleData?: Record<string, unknown>[];
  dataMetadata?: Record<string, string>;
}

interface MappingResult {
  templateField: string;
  dataColumn: string;
  confidence: number;
  reason: string;
  isMetadata?: boolean;
  metadataValue?: string;
}

// --- Column normalization helpers ---

/** Normalize column name: replace newlines with spaces, strip trailing dots, trim */
function normalizeColName(name: string): string {
  return name.replace(/\n/g, ' ').replace(/\.+$/, '').trim();
}

/** Strip composite prefixes like "class 정보_", "학습자 정보_", "출결현황_" from column names */
function stripCompositePrefix(name: string): string {
  return name.replace(/^[^_]+_/g, '').trim();
}

/** Detect if a column is an attendance date column (e.g. "4월_1회차_14 (Mo)", "1 Week_1_09월 29일", "12월_1회차") */
function isAttendanceColumn(colName: string): boolean {
  const normalized = normalizeColName(colName);
  // Must contain a numeric + time-related keyword
  if (!/\d+\s*(week|월|회차)/i.test(normalized)) return false;
  // Must NOT be a summary column (출석률, 결석 등)
  // "회차" alone (e.g. "출결현황_회차") is summary, but "N회차" (e.g. "12월_1회차") is attendance
  if (/출결|출석률|결석|합계|비고|미참석|출석\s*\(|공결/i.test(normalized)) return false;
  // Pure "회차" without a preceding number = summary column
  if (/(?<!\d)회차\s*$/i.test(normalized)) return false;
  return true;
}

/** Strip "출결 현황_" prefix and normalize for summary matching */
function normalizeSummaryCol(name: string): string {
  return name
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')           // collapse multiple spaces
    .replace(/^출결\s*현황[_\s]*/i, '')
    .replace(/[_\s]+/g, ' ')        // normalize underscores to spaces
    .trim();
}

/** Extract the base keyword from a summary column for fuzzy matching.
 *  e.g. "결석(N,C)" → "결석", "출석(Y)" → "출석", "실 출석률" → "실 출석률"
 */
function summaryBaseKeyword(normalized: string): string {
  return normalized.replace(/\s*\(.*?\)\s*/g, '').trim();
}

/** Extract codes from parenthetical notation.
 *  e.g. "공결(BZ)" → ["bz"], "업무_(BZ/VA)" → ["bz", "va"]
 */
function extractParenCodes(s: string): string[] {
  const match = s.match(/\(([^)]+)\)/);
  if (!match) return [];
  return match[1].split(/[,/]/).map(c => c.trim().toLowerCase()).filter(c => c.length > 0);
}

/** Check if a column is a summary/statistics column */
function isSummaryColumn(colName: string): boolean {
  const normalized = normalizeColName(colName);
  // "N회차" (e.g. "12월_1회차") is NOT summary — it's an attendance column
  // Pure "회차" (e.g. "출결현황_회차") IS summary
  if (/출석\s*\(|결석\s*\(|지각\s*\(|출석률|실\s*출석률|BZ|공결|미참석|업무/i.test(normalized)) return true;
  if (/(?<!\d)회차\s*$/i.test(normalized)) return true;
  return false;
}

// --- Metadata field mapping ---

const METADATA_FIELD_MAP: Record<string, string[]> = {
  '강사': ['Teacher Name', 'Teacher', '강사명', '강사'],
  '요일': ['Class Day', 'Day', '요일', '수업요일'],
  '진행시간': ['Class Time', 'Time', '시간', '수업시간', '진행시간'],
  '클래스': ['Class Name', 'Class', '클래스', '반명', '클래스명'],
  '프로그램': ['Book Name', 'Program', '교재', '프로그램', '교재명'],
  '법인': ['Company', '법인', '회사', '기업명'],
  '레벨': ['Level', '레벨', '수준'],
};

// --- Synonym dictionary (preserved from original) ---

const SYNONYM_GROUPS: string[][] = [
  ['이름', '성명', '한글이름', '성함', 'name', 'full_name', '이름(한글)', '직원명', '사원명', '참가자명', '학생명'],
  ['번호', 'No', 'No.', '순번', '연번', 'number', 'num', '#', '순서'],
  ['이메일', 'email', 'e-mail', '전자메일', '메일', '이메일주소', 'email_address'],
  ['전화번호', '연락처', '핸드폰', '휴대폰', 'phone', 'tel', '전화', '폰번호', '핸드폰번호', '휴대전화'],
  ['부서', '부서명', 'department', 'dept', '소속', '소속부서'],
  ['직급', '직위', '직책', 'position', 'title', 'rank', '직함'],
  ['날짜', '일자', 'date', '기준일', '작성일', '등록일', '일시'],
  ['금액', '비용', '가격', '단가', 'price', 'amount', 'cost', '매출', '매출액', '판매금액'],
  ['수량', '개수', '건수', 'quantity', 'qty', 'count', '갯수'],
  ['주소', '주소지', 'address', '거주지', '소재지'],
  ['회사', '회사명', '업체', '업체명', '거래처', 'company', '기관', '기관명', '소속기관'],
  ['출석', '출결', '참석', 'attendance', '출석률', '출결현황', '참석여부'],
  ['점수', '성적', '평점', 'score', 'grade', '등급', '평가'],
  ['비고', '메모', '기타', '참고', 'note', 'notes', 'memo', 'remark', '비고사항'],
  ['시작일', '시작', '시작날짜', 'start', 'start_date', '개시일', '시작일자'],
  ['종료일', '종료', '마감일', 'end', 'end_date', '완료일', '종료일자', '마감'],
  ['기간', '주차', '회차', '월회차', 'week', 'period', '차수'],
  ['합계', '총계', '소계', 'total', 'sum', '총합'],
  ['평균', '평균값', 'average', 'avg', '평균치'],
  ['상품', '상품명', '제품', '제품명', '품명', '품목', 'product', 'item', '물품'],
  ['카테고리', '분류', '구분', 'category', '종류', '유형', 'type'],
  ['생년월일', '생일', 'birthday', 'birth_date', 'dob'],
  ['성별', '성', 'gender', 'sex'],
  ['ID', '아이디', 'id', 'identifier', '사번', '학번', '사원번호'],
  ['영문이름', '영문명', '영어이름', 'english_name', 'eng_name', 'name_en'],
];

// --- Synonym matching ---

function findSynonymMatch(
  templateCol: string,
  dataColumns: string[]
): { dataColumn: string; confidence: number; reason: string } | null {
  const templateNorm = normalizeColName(templateCol).toLowerCase();

  for (const group of SYNONYM_GROUPS) {
    const templateInGroup = group.some(
      syn => syn.toLowerCase() === templateNorm ||
        templateNorm.includes(syn.toLowerCase()) ||
        syn.toLowerCase().includes(templateNorm)
    );

    if (templateInGroup) {
      for (const dataCol of dataColumns) {
        const dataNorm = normalizeColName(dataCol).toLowerCase();
        const dataInGroup = group.some(
          syn => syn.toLowerCase() === dataNorm ||
            dataNorm.includes(syn.toLowerCase()) ||
            syn.toLowerCase().includes(dataNorm)
        );

        if (dataInGroup) {
          return {
            dataColumn: dataCol,
            confidence: templateNorm === dataNorm ? 1.0 : 0.8,
            reason: `동의어 매칭 (${group[0]} 그룹)`,
          };
        }
      }
    }
  }

  return null;
}

// --- Date extraction helpers for attendance matching ---

interface ParsedDate {
  month?: number;
  day?: number;
}

/**
 * Extract ALL dates from template column name.
 * Template columns may contain multiple dates (one per class schedule).
 * e.g. "1 Week_1_09월 29일_09월 30일" → [{month:9, day:29}, {month:9, day:30}]
 */
function extractDatesFromTemplateCol(colName: string): ParsedDate[] {
  const dates: ParsedDate[] = [];
  const regex = /(\d{1,2})월\s*(\d{1,2})일/g;
  let match;
  while ((match = regex.exec(colName)) !== null) {
    dates.push({ month: parseInt(match[1], 10), day: parseInt(match[2], 10) });
  }
  return dates;
}

/**
 * Extract month from raw data column name.
 * e.g. "12월_1회차" → 12, "9월_3회차" → 9
 */
function extractMonthFromDataCol(colName: string): number | null {
  const match = colName.match(/(\d{1,2})월/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Extract day from raw data sample value.
 * e.g. "02(Tu)" → 2, "14(Mo)" → 14, "29(Wed)" → 29
 */
function extractDayFromSampleValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2})\s*\(/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Extract embedded field values from class name string.
 * Typical format: "쿠팡 25-4학기_Biz Conversation_Intermediate3_Mon/Wed 10:00-11:00_Group"
 * Parts: [company semester]_[program]_[level]_[schedule]_[type]
 */
function extractFromClassName(className: string, fieldKey: string): string | null {
  const parts = className.split('_');
  if (parts.length < 3) return null;

  const key = fieldKey.toLowerCase();

  if (key === '법인' || key === '회사' || key === 'company') {
    // First part: strip semester info (e.g., "쿠팡 25-4학기" → "쿠팡")
    const companyPart = parts[0].replace(/\s*\d{2,4}[-–]?\d*학기.*$/, '').trim();
    return companyPart.length > 0 ? companyPart : null;
  }

  if (key === '프로그램' || key === 'program' || key === '교재') {
    return parts.length >= 2 ? parts[1].trim() : null;
  }

  if (key === '레벨' || key === 'level') {
    for (const part of parts) {
      if (/^(beginner|elementary|pre.?intermediate|intermediate|upper.?intermediate|advanced)/i.test(part.trim())) {
        return part.trim();
      }
    }
    return parts.length >= 3 ? parts[2].trim() : null;
  }

  return null;
}

/**
 * Date-based attendance column matching.
 * Matches template columns (with full dates like "09월 29일") to raw data columns
 * (with month in header "12월_1회차" and day in first data row "02(Tu)").
 */
function dateBasedAttendanceMapping(
  templateAttendanceCols: string[],
  dataAttendanceCols: string[],
  dataSampleData?: Record<string, unknown>[]
): MappingResult[] {
  const results: MappingResult[] = [];

  // Build template date index: date → column name
  // Each template column may contain multiple dates (e.g. Mon date + Tue date)
  const templateDateMap = new Map<string, string>();
  for (const col of templateAttendanceCols) {
    const dates = extractDatesFromTemplateCol(col);
    for (const date of dates) {
      if (date.month && date.day) {
        templateDateMap.set(`${date.month}-${date.day}`, col);
      }
    }
  }

  if (templateDateMap.size === 0) {
    return []; // Template doesn't have parseable dates, fall back to positional
  }

  // Build raw data date index
  const usedTemplateCols = new Set<string>();
  for (const dataCol of dataAttendanceCols) {
    const month = extractMonthFromDataCol(dataCol);
    if (!month) continue;

    // Try to get day from ANY sample data row (not just the first)
    // Raw data has 2-row-per-student pattern: date row ("02(Tu)") + value row ("Y"/"N")
    let day: number | null = null;
    if (dataSampleData) {
      for (const row of dataSampleData) {
        if (row[dataCol] !== undefined) {
          const extracted = extractDayFromSampleValue(row[dataCol]);
          if (extracted !== null) {
            day = extracted;
            break;
          }
        }
      }
    }

    if (day !== null) {
      const dateKey = `${month}-${day}`;
      const matchedTemplateCol = templateDateMap.get(dateKey);
      if (matchedTemplateCol) {
        // Allow multiple data columns to map to the same template column
        // (different class groups may contribute to the same date slot)
        results.push({
          templateField: matchedTemplateCol,
          dataColumn: dataCol,
          confidence: usedTemplateCols.has(matchedTemplateCol) ? 0.85 : 0.95,
          reason: `날짜 매칭 (${month}월 ${day}일)`,
        });
        usedTemplateCols.add(matchedTemplateCol);
      }
    }
  }

  return results;
}

// --- Attendance-aware mapping logic ---

function attendanceAwareMapping(
  templateColumns: string[],
  dataColumns: string[],
  metadata?: Record<string, string>,
  dataSampleData?: Record<string, unknown>[]
): MappingResult[] {
  const results: MappingResult[] = [];
  const usedDataColumns = new Set<string>();
  const mappedTemplateFields = new Set<string>();

  // Categorize template columns
  const templateAttendanceCols: string[] = [];
  const templateSummaryCols: string[] = [];
  const templateMetadataCols: string[] = [];
  const templateIdentityCols: string[] = [];

  for (const col of templateColumns) {
    if (isAttendanceColumn(col)) {
      templateAttendanceCols.push(col);
    } else if (isSummaryColumn(col)) {
      templateSummaryCols.push(col);
    } else {
      // Check if it's a metadata column (only if metadata is provided)
      const normalizedCol = normalizeColName(col);
      const metaFieldEntry = Object.entries(METADATA_FIELD_MAP).find(
        ([key]) => normalizedCol === key || normalizedCol.includes(key) || key.includes(normalizedCol)
      );
      if (metaFieldEntry && metadata && Object.keys(metadata).length > 0) {
        templateMetadataCols.push(col);
      } else {
        templateIdentityCols.push(col);
      }
    }
  }

  // Categorize data columns
  const dataAttendanceCols: string[] = [];
  const dataSummaryCols: string[] = [];
  const dataIdentityCols: string[] = [];

  for (const col of dataColumns) {
    if (isAttendanceColumn(col)) {
      dataAttendanceCols.push(col);
    } else if (isSummaryColumn(col)) {
      dataSummaryCols.push(col);
    } else {
      dataIdentityCols.push(col);
    }
  }

  const hasAttendancePattern = templateAttendanceCols.length > 0 && dataAttendanceCols.length > 0;

  // --- Step 1: Identity column matching (exact, partial, synonym) ---
  for (const templateCol of templateIdentityCols) {
    const templateNorm = normalizeColName(templateCol).toLowerCase();

    // 1a. Exact match
    const exactMatch = dataIdentityCols.find(
      dc => normalizeColName(dc).toLowerCase() === templateNorm && !usedDataColumns.has(dc)
    );
    if (exactMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: exactMatch,
        confidence: 1.0,
        reason: '정확 일치',
      });
      usedDataColumns.add(exactMatch);
      mappedTemplateFields.add(templateCol);
      continue;
    }

    // 1b. Partial match
    const partialMatch = dataIdentityCols.find(
      dc => !usedDataColumns.has(dc) && (
        normalizeColName(dc).toLowerCase().includes(templateNorm) ||
        templateNorm.includes(normalizeColName(dc).toLowerCase())
      )
    );
    if (partialMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: partialMatch,
        confidence: 0.7,
        reason: '부분 일치',
      });
      usedDataColumns.add(partialMatch);
      mappedTemplateFields.add(templateCol);
      continue;
    }

    // 1c. Partial match with composite prefix stripping
    // Handles "강사" ↔ "class 정보_Teacher Name" by stripping "class 정보_" first
    const prefixStrippedMatch = dataIdentityCols.find(dc => {
      if (usedDataColumns.has(dc)) return false;
      const stripped = stripCompositePrefix(normalizeColName(dc)).toLowerCase();
      return stripped === templateNorm || stripped.includes(templateNorm) || templateNorm.includes(stripped);
    });
    if (prefixStrippedMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: prefixStrippedMatch,
        confidence: 0.75,
        reason: '접두사 제거 후 부분 일치',
      });
      usedDataColumns.add(prefixStrippedMatch);
      mappedTemplateFields.add(templateCol);
      continue;
    }

    // 1d. METADATA_FIELD_MAP cross-language matching
    // Handles "강사" ↔ "Teacher Name" via field map synonyms
    // Only match short column names (≤8 chars) to avoid false positives like "추가 입과 및 클래스 변경" → "클래스"
    const metaFieldEntry = templateNorm.length <= 8
      ? Object.entries(METADATA_FIELD_MAP).find(
          ([key]) => key === templateNorm || templateNorm === key
        )
      : null;
    if (metaFieldEntry) {
      const [, aliases] = metaFieldEntry;
      const metaMatch = dataIdentityCols.find(dc => {
        if (usedDataColumns.has(dc)) return false;
        const dataNorm = normalizeColName(dc).toLowerCase();
        const dataStripped = stripCompositePrefix(dataNorm).toLowerCase();
        return aliases.some(alias => {
          const aliasLower = alias.toLowerCase();
          return dataNorm === aliasLower || dataStripped === aliasLower ||
            dataNorm.includes(aliasLower) || dataStripped.includes(aliasLower);
        });
      });
      if (metaMatch) {
        results.push({
          templateField: templateCol,
          dataColumn: metaMatch,
          confidence: 0.85,
          reason: `필드맵 매칭 (${metaFieldEntry[0]})`,
        });
        usedDataColumns.add(metaMatch);
        mappedTemplateFields.add(templateCol);
        continue;
      }
    }

    // 1e. Synonym match
    const remainingDataCols = dataIdentityCols.filter(dc => !usedDataColumns.has(dc));
    const synonymMatch = findSynonymMatch(templateCol, remainingDataCols);
    if (synonymMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: synonymMatch.dataColumn,
        confidence: synonymMatch.confidence,
        reason: synonymMatch.reason,
      });
      usedDataColumns.add(synonymMatch.dataColumn);
      mappedTemplateFields.add(templateCol);
      continue;
    }
  }

  // --- Step 2: Attendance date columns - date-based matching ---
  if (hasAttendancePattern) {
    // Try date-based matching first, fall back to positional
    const dateMatched = dateBasedAttendanceMapping(
      templateAttendanceCols, dataAttendanceCols, dataSampleData
    );

    if (dateMatched.length > 0) {
      for (const m of dateMatched) {
        results.push(m);
        usedDataColumns.add(m.dataColumn);
        mappedTemplateFields.add(m.templateField);
      }
    } else {
      // Fallback: positional matching
      const matchCount = Math.min(templateAttendanceCols.length, dataAttendanceCols.length);
      for (let i = 0; i < matchCount; i++) {
        results.push({
          templateField: templateAttendanceCols[i],
          dataColumn: dataAttendanceCols[i],
          confidence: 0.85,
          reason: `출결 날짜 위치 매칭 (${i + 1}번째)`,
        });
        usedDataColumns.add(dataAttendanceCols[i]);
        mappedTemplateFields.add(templateAttendanceCols[i]);
      }
    }
  }

  // --- Step 3: Summary columns - enhanced partial match with prefix stripping ---
  for (const templateCol of templateSummaryCols) {
    const templateSummaryNorm = normalizeSummaryCol(templateCol).toLowerCase();

    // Try exact match after normalization
    let matched = false;
    for (const dataCol of dataSummaryCols) {
      if (usedDataColumns.has(dataCol)) continue;
      const dataSummaryNorm = normalizeSummaryCol(dataCol).toLowerCase();

      if (templateSummaryNorm === dataSummaryNorm) {
        results.push({
          templateField: templateCol,
          dataColumn: dataCol,
          confidence: 0.95,
          reason: '출결 요약 정규화 매칭',
        });
        usedDataColumns.add(dataCol);
        mappedTemplateFields.add(templateCol);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Try partial match after normalization
    for (const dataCol of dataSummaryCols) {
      if (usedDataColumns.has(dataCol)) continue;
      const dataSummaryNorm = normalizeSummaryCol(dataCol).toLowerCase();

      if (templateSummaryNorm.includes(dataSummaryNorm) || dataSummaryNorm.includes(templateSummaryNorm)) {
        results.push({
          templateField: templateCol,
          dataColumn: dataCol,
          confidence: 0.8,
          reason: '출결 요약 부분 매칭 (접두사 제거)',
        });
        usedDataColumns.add(dataCol);
        mappedTemplateFields.add(templateCol);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Try base keyword match (strip parenthetical differences)
    // e.g. "결석(N,C)" base="결석" matches "결석(N)" base="결석"
    const templateBase = summaryBaseKeyword(templateSummaryNorm);
    if (templateBase.length > 0) {
      for (const dataCol of dataSummaryCols) {
        if (usedDataColumns.has(dataCol)) continue;
        const dataSummaryNorm2 = normalizeSummaryCol(dataCol).toLowerCase();
        const dataBase = summaryBaseKeyword(dataSummaryNorm2);
        if (templateBase === dataBase || templateBase.includes(dataBase) || dataBase.includes(templateBase)) {
          results.push({
            templateField: templateCol,
            dataColumn: dataCol,
            confidence: 0.85,
            reason: '출결 요약 키워드 매칭',
          });
          usedDataColumns.add(dataCol);
          mappedTemplateFields.add(templateCol);
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    // Try parenthetical code matching (e.g. 공결(BZ) ↔ 업무_(BZ/VA) via shared "BZ")
    const templateCodes = extractParenCodes(templateSummaryNorm);
    if (templateCodes.length > 0) {
      for (const dataCol of dataSummaryCols) {
        if (usedDataColumns.has(dataCol)) continue;
        const dataSummaryNorm3 = normalizeSummaryCol(dataCol).toLowerCase();
        const dataCodes = extractParenCodes(dataSummaryNorm3);
        if (dataCodes.length > 0 && templateCodes.some(tc => dataCodes.includes(tc))) {
          results.push({
            templateField: templateCol,
            dataColumn: dataCol,
            confidence: 0.8,
            reason: `출결 요약 코드 매칭 (${templateCodes.join(',')} ∩ ${dataCodes.join(',')})`,
          });
          usedDataColumns.add(dataCol);
          mappedTemplateFields.add(templateCol);
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    // Also try matching against all remaining data columns (not just summary)
    const allRemainingData = dataColumns.filter(dc => !usedDataColumns.has(dc));
    for (const dataCol of allRemainingData) {
      const dataSummaryNorm2 = normalizeSummaryCol(dataCol).toLowerCase();
      if (templateSummaryNorm === dataSummaryNorm2 ||
        templateSummaryNorm.includes(dataSummaryNorm2) ||
        dataSummaryNorm2.includes(templateSummaryNorm)) {
        results.push({
          templateField: templateCol,
          dataColumn: dataCol,
          confidence: 0.75,
          reason: '출결 요약 확장 매칭',
        });
        usedDataColumns.add(dataCol);
        mappedTemplateFields.add(templateCol);
        break;
      }
    }
  }

  // --- Step 4: Metadata columns ---
  if (metadata && Object.keys(metadata).length > 0) {
    for (const templateCol of templateMetadataCols) {
      if (mappedTemplateFields.has(templateCol)) continue;

      const normalizedCol = normalizeColName(templateCol);

      // Find matching METADATA_FIELD_MAP entry
      const metaFieldEntry = Object.entries(METADATA_FIELD_MAP).find(
        ([key]) => normalizedCol === key || normalizedCol.includes(key) || key.includes(normalizedCol)
      );

      if (!metaFieldEntry) continue;

      const [, metadataKeys] = metaFieldEntry;

      // Check if any of the metadata keys exist in the provided metadata
      for (const metaKey of metadataKeys) {
        if (metadata[metaKey] !== undefined) {
          results.push({
            templateField: templateCol,
            dataColumn: `__metadata__${metaKey}`,
            confidence: 0.9,
            reason: `메타데이터 매칭 (${metaKey})`,
            isMetadata: true,
            metadataValue: metadata[metaKey],
          });
          mappedTemplateFields.add(templateCol);
          break;
        }
      }
    }
  }

  // --- Step 5: Extract embedded fields from class name for unmapped metadata columns ---
  // Handles 법인, 레벨, 프로그램 embedded in Class Name (e.g. "쿠팡 25-4학기_Biz Conversation_Intermediate3_...")
  const classNameCol = dataColumns.find(dc => {
    const lower = normalizeColName(dc).toLowerCase();
    return lower.includes('class name') || lower.includes('클래스명') ||
           lower.includes('class_name') || stripCompositePrefix(lower).includes('class name');
  });

  if (classNameCol && dataSampleData && dataSampleData.length > 0) {
    let classNameValue: string | null = null;
    for (const row of dataSampleData) {
      if (row[classNameCol]) {
        classNameValue = String(row[classNameCol]).trim();
        if (classNameValue.length > 0) break;
      }
    }

    if (classNameValue) {
      for (const templateCol of templateColumns) {
        if (mappedTemplateFields.has(templateCol)) continue;

        const normalizedCol = normalizeColName(templateCol);
        const metaEntry = Object.entries(METADATA_FIELD_MAP).find(
          ([key]) => normalizedCol === key || normalizedCol.includes(key) || key.includes(normalizedCol)
        );

        if (metaEntry) {
          const extracted = extractFromClassName(classNameValue, metaEntry[0]);
          if (extracted) {
            results.push({
              templateField: templateCol,
              dataColumn: `__extracted__${classNameCol}`,
              confidence: 0.7,
              reason: `클래스명에서 추출 (${metaEntry[0]}: "${extracted}")`,
              isMetadata: true,
              metadataValue: extracted,
            });
            mappedTemplateFields.add(templateCol);
          }
        }
      }
    }
  }

  return results;
}

// --- Original rule-based fallback (no attendance awareness) ---

function fallbackRuleMapping(
  templateColumns: string[],
  dataColumns: string[]
): MappingResult[] {
  const results: MappingResult[] = [];
  const usedDataColumns = new Set<string>();

  // Pre-compute stripped versions for composite prefix matching (e.g. "class 정보_Class Name" → "Class Name")
  const strippedDataMap = new Map<string, string>();
  for (const dc of dataColumns) {
    strippedDataMap.set(dc, stripCompositePrefix(dc).toLowerCase());
  }

  for (const templateCol of templateColumns) {
    const templateNorm = normalizeColName(templateCol).toLowerCase();

    // 1. Exact match (with normalization)
    const exactMatch = dataColumns.find(
      dc => normalizeColName(dc).toLowerCase() === templateNorm && !usedDataColumns.has(dc)
    );
    if (exactMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: exactMatch,
        confidence: 1.0,
        reason: '정확 일치',
      });
      usedDataColumns.add(exactMatch);
      continue;
    }

    // 2. Exact match after stripping composite prefix
    const strippedExact = dataColumns.find(
      dc => !usedDataColumns.has(dc) && strippedDataMap.get(dc) === templateNorm
    );
    if (strippedExact) {
      results.push({
        templateField: templateCol,
        dataColumn: strippedExact,
        confidence: 0.95,
        reason: '접두사 제거 후 일치',
      });
      usedDataColumns.add(strippedExact);
      continue;
    }

    // 3. METADATA_FIELD_MAP match (한국어↔영어 필드 매핑)
    let metadataMatch: string | null = null;
    for (const [, aliases] of Object.entries(METADATA_FIELD_MAP)) {
      const aliasesLower = aliases.map(a => a.toLowerCase());
      if (aliasesLower.includes(templateNorm)) {
        // Template matches an alias → find data column matching any other alias
        metadataMatch = dataColumns.find(dc => {
          if (usedDataColumns.has(dc)) return false;
          const dcStripped = strippedDataMap.get(dc) || '';
          const dcNorm = normalizeColName(dc).toLowerCase();
          return aliasesLower.includes(dcNorm) || aliasesLower.includes(dcStripped);
        }) || null;
        if (metadataMatch) break;
      }
    }
    // Also check if template matches a METADATA_FIELD_MAP key
    if (!metadataMatch) {
      const mapEntry = METADATA_FIELD_MAP[templateCol] || METADATA_FIELD_MAP[normalizeColName(templateCol)];
      if (mapEntry) {
        const aliasesLower = mapEntry.map(a => a.toLowerCase());
        metadataMatch = dataColumns.find(dc => {
          if (usedDataColumns.has(dc)) return false;
          const dcStripped = strippedDataMap.get(dc) || '';
          const dcNorm = normalizeColName(dc).toLowerCase();
          return aliasesLower.includes(dcNorm) || aliasesLower.includes(dcStripped);
        }) || null;
      }
    }
    if (metadataMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: metadataMatch,
        confidence: 0.9,
        reason: '필드맵 매칭',
      });
      usedDataColumns.add(metadataMatch);
      continue;
    }

    // 4. Partial match (with normalization + stripped prefix)
    const partialMatch = dataColumns.find(
      dc => !usedDataColumns.has(dc) && (
        normalizeColName(dc).toLowerCase().includes(templateNorm) ||
        templateNorm.includes(normalizeColName(dc).toLowerCase()) ||
        (strippedDataMap.get(dc) || '').includes(templateNorm) ||
        templateNorm.includes(strippedDataMap.get(dc) || '\x00')
      )
    );
    if (partialMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: partialMatch,
        confidence: 0.7,
        reason: '부분 일치',
      });
      usedDataColumns.add(partialMatch);
      continue;
    }

    // 5. Synonym match
    const synonymMatch = findSynonymMatch(
      templateCol,
      dataColumns.filter(dc => !usedDataColumns.has(dc))
    );
    if (synonymMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: synonymMatch.dataColumn,
        confidence: synonymMatch.confidence,
        reason: synonymMatch.reason,
      });
      usedDataColumns.add(synonymMatch.dataColumn);
      continue;
    }

    // 6. Synonym match with stripped prefix
    const strippedSynonymMatch = findSynonymMatch(
      templateCol,
      dataColumns.filter(dc => !usedDataColumns.has(dc)).map(dc => stripCompositePrefix(dc))
    );
    if (strippedSynonymMatch) {
      // Find original data column
      const origDc = dataColumns.find(dc =>
        !usedDataColumns.has(dc) && stripCompositePrefix(dc) === strippedSynonymMatch.dataColumn
      );
      if (origDc) {
        results.push({
          templateField: templateCol,
          dataColumn: origDc,
          confidence: strippedSynonymMatch.confidence * 0.9,
          reason: `접두사 제거 + ${strippedSynonymMatch.reason}`,
        });
        usedDataColumns.add(origDc);
        continue;
      }
    }
  }

  return results;
}

// --- Build mapping prompt (shared by Gemini and OpenAI) ---
function buildMappingPrompt(
  templateColumns: string[],
  dataColumns: string[],
  templateSampleData?: Record<string, unknown>[],
  dataSampleData?: Record<string, unknown>[]
): string {
  const templateSampleStr = templateSampleData && templateSampleData.length > 0
    ? '\n\n템플릿 샘플 데이터 (첫 2행):\n' + templateSampleData.slice(0, 2).map(
        (row, i) => `행 ${i + 1}: ${Object.entries(row).map(([k, v]) => `${k}="${v}"`).join(', ')}`
      ).join('\n')
    : '';

  const dataSampleStr = dataSampleData && dataSampleData.length > 0
    ? '\n\n데이터 파일 샘플 (첫 3행):\n' + dataSampleData.slice(0, 3).map(
        (row, i) => `행 ${i + 1}: ${Object.entries(row).map(([k, v]) => `${k}="${v}"`).join(', ')}`
      ).join('\n')
    : '';

  return `당신은 엑셀 데이터 매핑 전문가입니다.
두 개의 컬럼 목록을 의미론적으로 매칭해야 합니다.

## 템플릿 컬럼 (보고서 양식의 필드):
${templateColumns.map((c, i) => `${i + 1}. "${c}"`).join('\n')}
${templateSampleStr}

## 데이터 컬럼 (원본 데이터의 필드):
${dataColumns.map((c, i) => `${i + 1}. "${c}"`).join('\n')}
${dataSampleStr}

## 매핑 규칙:
1. 이름이 같으면 당연히 매칭 (confidence: 1.0)
2. 의미가 같은 한국어/영어 컬럼명 매칭 (예: "이름"↔"name", "번호"↔"No.")
3. 약어, 줄임말 인식 (예: "연락처"↔"전화번호", "금액"↔"price")
4. 날짜/기간 패턴 인식 (예: "주차"↔"Week", "기간"↔"period")
5. 비즈니스 도메인 유사성 (예: "출석률"↔"출결현황")
6. 샘플 데이터의 값 패턴으로 유추 (숫자만 있는 컬럼, 이메일 형식 등)
7. 매칭할 수 없는 컬럼은 포함하지 마세요
8. 하나의 데이터 컬럼은 하나의 템플릿 필드에만 매칭하세요

## 응답 형식 (반드시 JSON 배열만 출력):
[
  {"templateField": "템플릿필드명", "dataColumn": "데이터컬럼명", "confidence": 0.9, "reason": "매칭 이유"}
]

매칭 가능한 모든 쌍을 찾아 JSON 배열로 응답하세요. JSON 외의 텍스트는 출력하지 마세요.`;
}

// --- Parse and filter AI mapping response ---
function parseAiMappingResponse(
  text: string,
  templateColumns: string[],
  dataColumns: string[],
  provider: string,
): MappingResult[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse ${provider} response as JSON array`);
  }

  const parsed: MappingResult[] = JSON.parse(jsonMatch[0]);
  console.log(`[ai-mapping] ${provider} returned ${parsed.length} raw mappings`);

  const templateSet = new Set(templateColumns);
  const dataSet = new Set(dataColumns);

  const templateNormMap = new Map<string, string>();
  for (const t of templateColumns) templateNormMap.set(normalizeColName(t).toLowerCase().trim(), t);
  const dataNormMap = new Map<string, string>();
  for (const d of dataColumns) dataNormMap.set(normalizeColName(d).toLowerCase().trim(), d);

  const filtered = parsed
    .map(m => {
      let tField = templateSet.has(m.templateField) ? m.templateField : null;
      let dCol = dataSet.has(m.dataColumn) ? m.dataColumn : null;
      if (!tField) tField = templateNormMap.get(normalizeColName(m.templateField).toLowerCase().trim()) || null;
      if (!dCol) dCol = dataNormMap.get(normalizeColName(m.dataColumn).toLowerCase().trim()) || null;
      if (tField && dCol) return { ...m, templateField: tField, dataColumn: dCol };
      return null;
    })
    .filter((m): m is MappingResult => m !== null);

  if (filtered.length < parsed.length) {
    console.warn(`[ai-mapping] ${provider}: Dropped ${parsed.length - filtered.length}/${parsed.length} mappings due to name mismatch`);
  }

  return filtered;
}

// --- Gemini API call ---
async function callGemini(
  apiKey: string,
  prompt: string,
): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, topK: 40, topP: 0.95, maxOutputTokens: 4096 },
      }),
    }
  );
  if (!response.ok) throw new Error(`Gemini API error: ${response.status} ${await response.text().catch(() => '')}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

// --- OpenAI API call ---
async function callOpenAI(
  apiKey: string,
  prompt: string,
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 4096,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status} ${await response.text().catch(() => '')}`);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned empty response');
  return text;
}

// --- AI mapping with Gemini → OpenAI fallback ---
async function aiMapping(
  apiKey: string,
  templateColumns: string[],
  dataColumns: string[],
  templateSampleData?: Record<string, unknown>[],
  dataSampleData?: Record<string, unknown>[]
): Promise<MappingResult[]> {
  const prompt = buildMappingPrompt(templateColumns, dataColumns, templateSampleData, dataSampleData);

  // Try Gemini first
  try {
    console.log('[ai-mapping] Trying Gemini...');
    const text = await callGemini(apiKey, prompt);
    return parseAiMappingResponse(text, templateColumns, dataColumns, 'Gemini');
  } catch (geminiError) {
    console.error('[ai-mapping] Gemini failed:', geminiError);
  }

  // Fallback to OpenAI
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      console.log('[ai-mapping] Falling back to OpenAI...');
      const text = await callOpenAI(openaiKey, prompt);
      return parseAiMappingResponse(text, templateColumns, dataColumns, 'OpenAI');
    } catch (openaiError) {
      console.error('[ai-mapping] OpenAI also failed:', openaiError);
    }
  }

  throw new Error('All AI providers failed (Gemini + OpenAI)');
}

// --- Detect if this is an attendance report scenario ---

function isAttendanceReport(templateColumns: string[], dataColumns: string[]): boolean {
  const templateAttendance = templateColumns.filter(isAttendanceColumn);
  const dataAttendance = dataColumns.filter(isAttendanceColumn);
  // If both sides have 3+ attendance columns, treat as attendance report
  return templateAttendance.length >= 3 && dataAttendance.length >= 3;
}

export async function POST(request: NextRequest) {
  try {
    const body: MappingRequest = await request.json();
    const { templateColumns, dataColumns, templateSampleData, dataSampleData, dataMetadata } = body;

    if (!templateColumns || !dataColumns || templateColumns.length === 0 || dataColumns.length === 0) {
      return NextResponse.json(
        { success: false, error: '템플릿 컬럼과 데이터 컬럼이 필요합니다.' },
        { status: 400 }
      );
    }

    let mappings: MappingResult[];

    // Check if this is an attendance report scenario
    if (isAttendanceReport(templateColumns, dataColumns)) {
      console.log('[ai-mapping] Attendance report detected. Using attendance-aware mapping.');
      console.log(`[ai-mapping] Template attendance cols: ${templateColumns.filter(isAttendanceColumn).length}`);
      console.log(`[ai-mapping] Data attendance cols: ${dataColumns.filter(isAttendanceColumn).length}`);
      if (dataMetadata) {
        console.log(`[ai-mapping] Metadata keys: ${Object.keys(dataMetadata).join(', ')}`);
      }

      // Use attendance-aware mapping (no Gemini needed for positional matching)
      mappings = attendanceAwareMapping(templateColumns, dataColumns, dataMetadata, dataSampleData);

      // For unmapped identity columns, try Gemini if available
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const mappedTemplates = new Set(mappings.map(m => m.templateField));
      const unmappedTemplates = templateColumns.filter(t =>
        !mappedTemplates.has(t) && !isAttendanceColumn(t) && !isSummaryColumn(t)
      );

      if (unmappedTemplates.length > 0 && geminiApiKey) {
        try {
          const mappedDataCols = new Set(mappings.map(m => m.dataColumn));
          const remainingDataCols = dataColumns.filter(d => !mappedDataCols.has(d));
          const aiResults = await aiMapping(
            geminiApiKey,
            unmappedTemplates,
            remainingDataCols,
            templateSampleData,
            dataSampleData
          );
          mappings = [...mappings, ...aiResults];
        } catch (error) {
          console.error('[ai-mapping] Gemini supplementary mapping failed:', error);
        }
      }
    } else {
      // Non-attendance: use original flow (Gemini + fallback)
      const geminiApiKey = process.env.GEMINI_API_KEY;
      console.log(`[ai-mapping] Non-attendance mode. GEMINI_API_KEY: ${geminiApiKey ? 'SET' : 'NOT SET'}`);
      console.log(`[ai-mapping] isAttendanceReport: false. Template attendance cols: ${templateColumns.filter(isAttendanceColumn).length}, Data attendance cols: ${dataColumns.filter(isAttendanceColumn).length}`);

      if (geminiApiKey) {
        try {
          console.log(`[ai-mapping] Calling Gemini with ${templateColumns.length} template cols, ${dataColumns.length} data cols`);
          mappings = await aiMapping(
            geminiApiKey,
            templateColumns,
            dataColumns,
            templateSampleData,
            dataSampleData
          );
          console.log(`[ai-mapping] Gemini success: ${mappings.length} mappings`);

          // Supplement with rule-based for unmapped columns
          const aiMappedTemplates = new Set(mappings.map(m => m.templateField));
          const unmappedTemplates = templateColumns.filter(t => !aiMappedTemplates.has(t));

          if (unmappedTemplates.length > 0) {
            const aiMappedDataCols = new Set(mappings.map(m => m.dataColumn));
            const remainingDataCols = dataColumns.filter(d => !aiMappedDataCols.has(d));
            const supplementary = fallbackRuleMapping(unmappedTemplates, remainingDataCols);
            mappings = [...mappings, ...supplementary];
          }
        } catch (error) {
          console.error('[ai-mapping] Gemini FAILED:', error);
          mappings = fallbackRuleMapping(templateColumns, dataColumns);
          console.log(`[ai-mapping] Fallback rule mapping: ${mappings.length} mappings`);
        }
      } else {
        console.warn('[ai-mapping] No GEMINI_API_KEY, using fallback only');
        mappings = fallbackRuleMapping(templateColumns, dataColumns);
        console.log(`[ai-mapping] Fallback rule mapping: ${mappings.length} mappings`);
      }
    }

    return NextResponse.json({
      success: true,
      mappings,
      totalTemplate: templateColumns.length,
      totalData: dataColumns.length,
      mappedCount: mappings.length,
      isAttendanceReport: isAttendanceReport(templateColumns, dataColumns),
    });
  } catch (error) {
    console.error('AI mapping error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'AI 매핑 실패' },
      { status: 500 }
    );
  }
}
