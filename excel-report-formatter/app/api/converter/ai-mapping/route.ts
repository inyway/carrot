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

/** Normalize column name: replace newlines with spaces, trim */
function normalizeColName(name: string): string {
  return name.replace(/\n/g, ' ').trim();
}

/** Detect if a column is an attendance date column (e.g. "4월_1회차_14 (Mo)", "1 Week_1_09월 29일") */
function isAttendanceColumn(colName: string): boolean {
  const normalized = normalizeColName(colName);
  // Must contain a numeric + time-related keyword
  if (!/\d+\s*(week|월|회차)/i.test(normalized)) return false;
  // Must NOT be a summary column
  if (/출결|출석률|결석|합계|비고|미참석|출석\s*\(|공결|회차\s*$/i.test(normalized)) return false;
  return true;
}

/** Strip "출결 현황_" prefix and normalize for summary matching */
function normalizeSummaryCol(name: string): string {
  return name
    .replace(/\n/g, ' ')
    .replace(/^출결\s*현황[_\s]*/i, '')
    .trim();
}

/** Check if a column is a summary/statistics column */
function isSummaryColumn(colName: string): boolean {
  const normalized = normalizeColName(colName);
  return /출석\s*\(|결석\s*\(|지각\s*\(|출석률|실\s*출석률|BZ|공결|미참석|업무|회차$/i.test(normalized);
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

// --- Attendance-aware mapping logic ---

function attendanceAwareMapping(
  templateColumns: string[],
  dataColumns: string[],
  metadata?: Record<string, string>
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
      if (metaFieldEntry && metadata) {
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

    // 1c. Synonym match
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

  // --- Step 2: Attendance date columns - positional matching ---
  if (hasAttendancePattern) {
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

    // Also try matching against all remaining data columns (not just summary)
    const allRemainingData = dataColumns.filter(dc => !usedDataColumns.has(dc));
    for (const dataCol of allRemainingData) {
      const dataSummaryNorm = normalizeSummaryCol(dataCol).toLowerCase();
      if (templateSummaryNorm === dataSummaryNorm ||
        templateSummaryNorm.includes(dataSummaryNorm) ||
        dataSummaryNorm.includes(templateSummaryNorm)) {
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

  return results;
}

// --- Original rule-based fallback (no attendance awareness) ---

function fallbackRuleMapping(
  templateColumns: string[],
  dataColumns: string[]
): MappingResult[] {
  const results: MappingResult[] = [];
  const usedDataColumns = new Set<string>();

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

    // 2. Partial match (with normalization)
    const partialMatch = dataColumns.find(
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
      continue;
    }

    // 3. Synonym match
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
  }

  return results;
}

// Gemini API AI mapping (preserved from original)
async function aiMapping(
  apiKey: string,
  templateColumns: string[],
  dataColumns: string[],
  templateSampleData?: Record<string, unknown>[],
  dataSampleData?: Record<string, unknown>[]
): Promise<MappingResult[]> {
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

  const prompt = `당신은 엑셀 데이터 매핑 전문가입니다.
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini API returned empty response');
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Failed to parse Gemini response as JSON array');
  }

  const parsed: MappingResult[] = JSON.parse(jsonMatch[0]);

  const templateSet = new Set(templateColumns);
  const dataSet = new Set(dataColumns);

  return parsed.filter(
    m => templateSet.has(m.templateField) && dataSet.has(m.dataColumn)
  );
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
      mappings = attendanceAwareMapping(templateColumns, dataColumns, dataMetadata);

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

      if (geminiApiKey) {
        try {
          mappings = await aiMapping(
            geminiApiKey,
            templateColumns,
            dataColumns,
            templateSampleData,
            dataSampleData
          );

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
          console.error('AI mapping failed, falling back to rules:', error);
          mappings = fallbackRuleMapping(templateColumns, dataColumns);
        }
      } else {
        mappings = fallbackRuleMapping(templateColumns, dataColumns);
      }
    }

    return NextResponse.json({
      success: true,
      mappings,
      totalTemplate: templateColumns.length,
      totalData: dataColumns.length,
      mappedCount: mappings.length,
    });
  } catch (error) {
    console.error('AI mapping error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'AI 매핑 실패' },
      { status: 500 }
    );
  }
}
