/**
 * AttendanceMappingService
 * 출결 보고서 컬럼 매핑 서비스
 * Next.js route.ts의 매핑 로직을 NestJS 서비스로 포팅
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttendanceMappingResult } from './types';
import { SYNONYM_GROUPS, METADATA_FIELD_MAP } from './attendance-constants';

// --- Column normalization helpers ---

function normalizeColName(name: string): string {
  return name.replace(/\n/g, ' ').replace(/\.+$/, '').trim();
}

function stripCompositePrefix(name: string): string {
  return name.replace(/^[^_]+_/g, '').trim();
}

function isAttendanceColumn(colName: string): boolean {
  const normalized = normalizeColName(colName);
  // Exclude summary/aggregate columns first
  if (/출결|출석률|결석|합계|비고|미참석|출석\s*\(|공결/i.test(normalized)) return false;
  if (/(?<!\d)회차\s*$/i.test(normalized)) return false;

  // Pattern 1: "N week/월/회차" — original pattern
  if (/\d+\s*(week|월|회차)/i.test(normalized)) return true;

  // Pattern 2: Bare date "02(Tu)" or "15(Wed)" — RAW2 날짜 컬럼
  if (/^\d{1,2}\s*\([A-Za-z]{2,3}\)$/.test(normalized)) return true;

  // Pattern 3: Hierarchical date "출결현황_1월_02(Tu)" — 멀티로우 헤더에서 병합된 이름
  if (/\d{1,2}\s*\([A-Za-z]{2,3}\)$/.test(normalized)) return true;

  // Pattern 4: Pure numeric day index (1-40 range) — 숫자만 있는 날짜 인덱스
  if (/^\d{1,2}$/.test(normalized)) {
    const num = parseInt(normalized, 10);
    if (num >= 1 && num <= 40) return true;
  }

  // Pattern 5: "M월D일" date format — "1월02일", "12월15일"
  if (/^\d{1,2}월\d{1,2}일$/.test(normalized)) return true;

  return false;
}

function isSummaryColumn(colName: string): boolean {
  const normalized = normalizeColName(colName);
  if (/출석\s*\(|결석\s*\(|지각\s*\(|출석률|실\s*출석률|BZ|공결|미참석|업무/i.test(normalized)) return true;
  if (/(?<!\d)회차\s*$/i.test(normalized)) return true;
  return false;
}

function normalizeSummaryCol(name: string): string {
  return name
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^출결\s*현황[_\s]*/i, '')
    .replace(/[_\s]+/g, ' ')
    .trim();
}

function summaryBaseKeyword(normalized: string): string {
  return normalized.replace(/\s*\(.*?\)\s*/g, '').trim();
}

function extractParenCodes(s: string): string[] {
  const match = s.match(/\(([^)]+)\)/);
  if (!match) return [];
  return match[1].split(/[,/]/).map(c => c.trim().toLowerCase()).filter(c => c.length > 0);
}

// --- Date extraction helpers ---

interface ParsedDate {
  month?: number;
  day?: number;
}

function extractDatesFromTemplateCol(colName: string): ParsedDate[] {
  const dates: ParsedDate[] = [];
  const regex = /(\d{1,2})월\s*(\d{1,2})일/g;
  let match;
  while ((match = regex.exec(colName)) !== null) {
    dates.push({ month: parseInt(match[1], 10), day: parseInt(match[2], 10) });
  }
  return dates;
}

function extractMonthFromDataCol(colName: string): number | null {
  const match = colName.match(/(\d{1,2})월/);
  return match ? parseInt(match[1], 10) : null;
}

function extractDayFromSampleValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2})\s*\(/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * 클래스명에서 필드 추출
 *
 * 5-part format: 학기_프로그램_요일교시_레벨_강사명
 *   parts[0] "쿠팡 25-4학기" → 법인: "쿠팡" (학기 suffix 제거)
 *   parts[1] "프리토킹 영어"  → 프로그램
 *   parts[2] "금6교시~7교시"  → 요일: "금" (첫 한글 요일문자)
 *   parts[3] "M6"            → 레벨
 *   parts[4] "Sarah Kim(김사라)" → 강사명: "Sarah Kim" (괄호 제거)
 *
 * 3-part format (legacy): 법인_프로그램_레벨
 */
function extractFromClassName(className: string, fieldKey: string): string | null {
  const parts = className.split('_');
  if (parts.length < 3) return null;

  const key = fieldKey.toLowerCase();
  const is5Part = parts.length >= 5;

  // 법인 / 회사 — always parts[0], remove semester suffix
  if (key === '법인' || key === '회사' || key === 'company') {
    const companyPart = parts[0].replace(/\s*\d{2,4}[-–]?\d*학기.*$/, '').trim();
    return companyPart.length > 0 ? companyPart : null;
  }

  // 프로그램 / 교재 — parts[1]
  if (key === '프로그램' || key === 'program' || key === '교재') {
    return parts.length >= 2 ? parts[1].trim() : null;
  }

  // 요일 — 5-part: parts[2]에서 첫 한글 요일 문자 추출
  if (key === '요일' || key === 'day' || key === 'class day') {
    if (is5Part) {
      const dayMatch = parts[2].match(/([월화수목금토일])/);
      return dayMatch ? dayMatch[1] : parts[2].trim();
    }
    return null;
  }

  // 진행시간 — 5-part: parts[2] 전체 (요일+교시)
  if (key === '진행시간' || key === 'class time' || key === '시간') {
    if (is5Part) {
      return parts[2].trim();
    }
    return null;
  }

  // 레벨 — 5-part: parts[3], 3-part: parts[2] or level-like part
  if (key === '레벨' || key === 'level') {
    if (is5Part) {
      return parts[3].trim();
    }
    // Legacy: scan for level-like values first
    for (const part of parts) {
      if (/^(beginner|elementary|pre.?intermediate|intermediate|upper.?intermediate|advanced)/i.test(part.trim())) {
        return part.trim();
      }
    }
    return parts.length >= 3 ? parts[2].trim() : null;
  }

  // 강사 / 강사명 — 5-part: parts[4], remove parenthetical Korean name
  if (key === '강사' || key === '강사명' || key === 'teacher' || key === 'teacher name') {
    if (is5Part) {
      return parts[4].replace(/\s*\([^)]*\)\s*$/, '').trim() || null;
    }
    return null;
  }

  return null;
}

// --- Synonym matching ---

function findSynonymMatch(
  templateCol: string,
  dataColumns: string[],
): { dataColumn: string; confidence: number; reason: string } | null {
  const templateNorm = normalizeColName(templateCol).toLowerCase();

  for (const group of SYNONYM_GROUPS) {
    const templateInGroup = group.some(
      syn =>
        syn.toLowerCase() === templateNorm ||
        templateNorm.includes(syn.toLowerCase()) ||
        syn.toLowerCase().includes(templateNorm),
    );

    if (templateInGroup) {
      for (const dataCol of dataColumns) {
        const dataNorm = normalizeColName(dataCol).toLowerCase();
        const dataInGroup = group.some(
          syn =>
            syn.toLowerCase() === dataNorm ||
            dataNorm.includes(syn.toLowerCase()) ||
            syn.toLowerCase().includes(dataNorm),
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

@Injectable()
export class AttendanceMappingService {
  private readonly geminiApiKey: string | undefined;
  private readonly geminiApiUrl =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  constructor(private readonly configService: ConfigService) {
    this.geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');
  }

  /**
   * 출결 보고서 여부 감지
   */
  isAttendanceReport(templateColumns: string[], dataColumns: string[]): boolean {
    const templateAttendance = templateColumns.filter(isAttendanceColumn);
    const dataAttendance = dataColumns.filter(isAttendanceColumn);
    return templateAttendance.length >= 3 && dataAttendance.length >= 3;
  }

  /**
   * 메인 매핑 실행
   */
  async generateMappings(
    templateColumns: string[],
    dataColumns: string[],
    metadata?: Record<string, string>,
    dataSampleData?: Record<string, unknown>[],
    templateSampleData?: Record<string, unknown>[],
  ): Promise<{ mappings: AttendanceMappingResult[]; unmappedColumns: string[] }> {
    let mappings: AttendanceMappingResult[];

    if (this.isAttendanceReport(templateColumns, dataColumns)) {
      mappings = this.attendanceAwareMapping(templateColumns, dataColumns, metadata, dataSampleData);

      // Gemini fallback for unmapped non-attendance columns
      const mappedTemplates = new Set(mappings.map(m => m.templateField));
      const unmappedTemplates = templateColumns.filter(
        t => !mappedTemplates.has(t) && !isAttendanceColumn(t) && !isSummaryColumn(t),
      );

      if (unmappedTemplates.length > 0 && this.geminiApiKey) {
        try {
          const mappedDataCols = new Set(mappings.map(m => m.dataColumn));
          const remainingDataCols = dataColumns.filter(d => !mappedDataCols.has(d));
          const aiResults = await this.aiMapping(
            unmappedTemplates,
            remainingDataCols,
            templateSampleData,
            dataSampleData,
          );
          mappings = [...mappings, ...aiResults];
        } catch (error) {
          console.error('[AttendanceMappingService] Gemini supplementary mapping failed:', error);
        }
      }
    } else {
      // Non-attendance: Gemini + fallback
      if (this.geminiApiKey) {
        try {
          mappings = await this.aiMapping(templateColumns, dataColumns, templateSampleData, dataSampleData);

          const aiMappedTemplates = new Set(mappings.map(m => m.templateField));
          const unmappedTemplates = templateColumns.filter(t => !aiMappedTemplates.has(t));

          if (unmappedTemplates.length > 0) {
            const aiMappedDataCols = new Set(mappings.map(m => m.dataColumn));
            const remainingDataCols = dataColumns.filter(d => !aiMappedDataCols.has(d));
            const supplementary = this.fallbackRuleMapping(unmappedTemplates, remainingDataCols);
            mappings = [...mappings, ...supplementary];
          }
        } catch (error) {
          console.error('[AttendanceMappingService] AI mapping failed, falling back:', error);
          mappings = this.fallbackRuleMapping(templateColumns, dataColumns);
        }
      } else {
        mappings = this.fallbackRuleMapping(templateColumns, dataColumns);
      }
    }

    const mappedTemplates = new Set(mappings.map(m => m.templateField));
    const unmappedColumns = templateColumns.filter(t => !mappedTemplates.has(t));

    return { mappings, unmappedColumns };
  }

  // --- Static helpers exposed for testing ---

  static isAttendanceColumn = isAttendanceColumn;
  static isSummaryColumn = isSummaryColumn;
  static normalizeColName = normalizeColName;

  // --- Private methods ---

  private attendanceAwareMapping(
    templateColumns: string[],
    dataColumns: string[],
    metadata?: Record<string, string>,
    dataSampleData?: Record<string, unknown>[],
  ): AttendanceMappingResult[] {
    const results: AttendanceMappingResult[] = [];
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
        const normalizedCol = normalizeColName(col);
        const metaFieldEntry = Object.entries(METADATA_FIELD_MAP).find(
          ([key]) => normalizedCol === key || normalizedCol.includes(key) || key.includes(normalizedCol),
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

    // Step 1: Identity column matching
    for (const templateCol of templateIdentityCols) {
      const templateNorm = normalizeColName(templateCol).toLowerCase();

      // 1a. Exact match
      const exactMatch = dataIdentityCols.find(
        dc => normalizeColName(dc).toLowerCase() === templateNorm && !usedDataColumns.has(dc),
      );
      if (exactMatch) {
        results.push({ templateField: templateCol, dataColumn: exactMatch, confidence: 1.0, reason: '정확 일치' });
        usedDataColumns.add(exactMatch);
        mappedTemplateFields.add(templateCol);
        continue;
      }

      // 1b. Partial match
      const partialMatch = dataIdentityCols.find(
        dc =>
          !usedDataColumns.has(dc) &&
          (normalizeColName(dc).toLowerCase().includes(templateNorm) ||
            templateNorm.includes(normalizeColName(dc).toLowerCase())),
      );
      if (partialMatch) {
        results.push({ templateField: templateCol, dataColumn: partialMatch, confidence: 0.7, reason: '부분 일치' });
        usedDataColumns.add(partialMatch);
        mappedTemplateFields.add(templateCol);
        continue;
      }

      // 1c. Prefix-stripped partial match
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
      const metaFieldEntry =
        templateNorm.length <= 8
          ? Object.entries(METADATA_FIELD_MAP).find(([key]) => key === templateNorm || templateNorm === key)
          : null;
      if (metaFieldEntry) {
        const [, aliases] = metaFieldEntry;
        const metaMatch = dataIdentityCols.find(dc => {
          if (usedDataColumns.has(dc)) return false;
          const dataNorm = normalizeColName(dc).toLowerCase();
          const dataStripped = stripCompositePrefix(dataNorm).toLowerCase();
          return aliases.some(alias => {
            const aliasLower = alias.toLowerCase();
            return (
              dataNorm === aliasLower ||
              dataStripped === aliasLower ||
              dataNorm.includes(aliasLower) ||
              dataStripped.includes(aliasLower)
            );
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

    // Step 2: Attendance date columns
    if (hasAttendancePattern) {
      const dateMatched = this.dateBasedAttendanceMapping(templateAttendanceCols, dataAttendanceCols, dataSampleData);

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

    // Step 3: Summary columns
    for (const templateCol of templateSummaryCols) {
      const templateSummaryNorm = normalizeSummaryCol(templateCol).toLowerCase();

      let matched = false;

      // 3a. Exact normalized match
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

      // 3b. Partial normalized match
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

      // 3c. Base keyword match
      const templateBase = summaryBaseKeyword(templateSummaryNorm);
      if (templateBase.length > 0) {
        for (const dataCol of dataSummaryCols) {
          if (usedDataColumns.has(dataCol)) continue;
          const dataSummaryNorm2 = normalizeSummaryCol(dataCol).toLowerCase();
          const dataBase = summaryBaseKeyword(dataSummaryNorm2);
          if (
            templateBase === dataBase ||
            templateBase.includes(dataBase) ||
            dataBase.includes(templateBase)
          ) {
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

      // 3d. Parenthetical code matching
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

      // 3e. Expanded match against all remaining data
      const allRemainingData = dataColumns.filter(dc => !usedDataColumns.has(dc));
      for (const dataCol of allRemainingData) {
        const dataSummaryNorm2 = normalizeSummaryCol(dataCol).toLowerCase();
        if (
          templateSummaryNorm === dataSummaryNorm2 ||
          templateSummaryNorm.includes(dataSummaryNorm2) ||
          dataSummaryNorm2.includes(templateSummaryNorm)
        ) {
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

    // Step 4: Metadata columns
    if (metadata && Object.keys(metadata).length > 0) {
      for (const templateCol of templateMetadataCols) {
        if (mappedTemplateFields.has(templateCol)) continue;

        const normalizedCol = normalizeColName(templateCol);
        const metaFieldEntry = Object.entries(METADATA_FIELD_MAP).find(
          ([key]) => normalizedCol === key || normalizedCol.includes(key) || key.includes(normalizedCol),
        );
        if (!metaFieldEntry) continue;

        const [, metadataKeys] = metaFieldEntry;
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

    // Step 5: Extract embedded fields from class name
    const classNameCol = dataColumns.find(dc => {
      const lower = normalizeColName(dc).toLowerCase();
      return (
        lower.includes('class name') ||
        lower.includes('클래스명') ||
        lower.includes('class_name') ||
        stripCompositePrefix(lower).includes('class name')
      );
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
            ([key]) => normalizedCol === key || normalizedCol.includes(key) || key.includes(normalizedCol),
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

  private dateBasedAttendanceMapping(
    templateAttendanceCols: string[],
    dataAttendanceCols: string[],
    dataSampleData?: Record<string, unknown>[],
  ): AttendanceMappingResult[] {
    const results: AttendanceMappingResult[] = [];

    const templateDateMap = new Map<string, string>();
    for (const col of templateAttendanceCols) {
      const dates = extractDatesFromTemplateCol(col);
      for (const date of dates) {
        if (date.month && date.day) {
          templateDateMap.set(`${date.month}-${date.day}`, col);
        }
      }
    }

    if (templateDateMap.size === 0) return [];

    const usedTemplateCols = new Set<string>();
    for (const dataCol of dataAttendanceCols) {
      const month = extractMonthFromDataCol(dataCol);
      if (!month) continue;

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

  private fallbackRuleMapping(templateColumns: string[], dataColumns: string[]): AttendanceMappingResult[] {
    const results: AttendanceMappingResult[] = [];
    const usedDataColumns = new Set<string>();

    for (const templateCol of templateColumns) {
      const templateNorm = normalizeColName(templateCol).toLowerCase();

      const exactMatch = dataColumns.find(
        dc => normalizeColName(dc).toLowerCase() === templateNorm && !usedDataColumns.has(dc),
      );
      if (exactMatch) {
        results.push({ templateField: templateCol, dataColumn: exactMatch, confidence: 1.0, reason: '정확 일치' });
        usedDataColumns.add(exactMatch);
        continue;
      }

      const partialMatch = dataColumns.find(
        dc =>
          !usedDataColumns.has(dc) &&
          (normalizeColName(dc).toLowerCase().includes(templateNorm) ||
            templateNorm.includes(normalizeColName(dc).toLowerCase())),
      );
      if (partialMatch) {
        results.push({ templateField: templateCol, dataColumn: partialMatch, confidence: 0.7, reason: '부분 일치' });
        usedDataColumns.add(partialMatch);
        continue;
      }

      const synonymMatch = findSynonymMatch(templateCol, dataColumns.filter(dc => !usedDataColumns.has(dc)));
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

  private async aiMapping(
    templateColumns: string[],
    dataColumns: string[],
    templateSampleData?: Record<string, unknown>[],
    dataSampleData?: Record<string, unknown>[],
  ): Promise<AttendanceMappingResult[]> {
    if (!this.geminiApiKey) return [];

    const templateSampleStr =
      templateSampleData && templateSampleData.length > 0
        ? '\n\n템플릿 샘플 데이터 (첫 2행):\n' +
          templateSampleData
            .slice(0, 2)
            .map((row, i) => `행 ${i + 1}: ${Object.entries(row).map(([k, v]) => `${k}="${v}"`).join(', ')}`)
            .join('\n')
        : '';

    const dataSampleStr =
      dataSampleData && dataSampleData.length > 0
        ? '\n\n데이터 파일 샘플 (첫 3행):\n' +
          dataSampleData
            .slice(0, 3)
            .map((row, i) => `행 ${i + 1}: ${Object.entries(row).map(([k, v]) => `${k}="${v}"`).join(', ')}`)
            .join('\n')
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
2. 의미가 같은 한국어/영어 컬럼명 매칭
3. 약어, 줄임말 인식
4. 날짜/기간 패턴 인식
5. 비즈니스 도메인 유사성
6. 샘플 데이터의 값 패턴으로 유추
7. 매칭할 수 없는 컬럼은 포함하지 마세요
8. 하나의 데이터 컬럼은 하나의 템플릿 필드에만 매칭하세요

## 응답 형식 (반드시 JSON 배열만 출력):
[
  {"templateField": "템플릿필드명", "dataColumn": "데이터컬럼명", "confidence": 0.9, "reason": "매칭 이유"}
]`;

    const response = await fetch(`${this.geminiApiUrl}?key=${this.geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, topK: 40, topP: 0.95, maxOutputTokens: 4096 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini API returned empty response');

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Failed to parse Gemini response as JSON array');

    const parsed: AttendanceMappingResult[] = JSON.parse(jsonMatch[0]);
    const templateSet = new Set(templateColumns);
    const dataSet = new Set(dataColumns);

    return parsed.filter(m => templateSet.has(m.templateField) && dataSet.has(m.dataColumn));
  }
}
