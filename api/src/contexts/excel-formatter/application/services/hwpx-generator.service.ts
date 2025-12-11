import { Injectable, Inject } from '@nestjs/common';
import {
  HwpxParserAdapter,
  type HwpxTemplateInfo,
  type CellMapping,
} from '../../infrastructure/adapters/hwpx-parser.adapter';
import { HwpxMappingGraphService, type MappingContext } from './hwpx-mapping-graph.service';
import { EXCEL_PARSER_PORT, type ExcelParserPort } from '../ports';
import { HeaderDetectionAgent, type HeaderAnalysisResult, type HierarchicalColumn } from '../agents';

export interface HwpxGenerateOptions {
  templateBuffer: Buffer;
  dataBuffer: Buffer;
  sheetName: string;
  mappings: CellMapping[];
  fileNameColumn?: string;
  mappingContext?: MappingContext;
}

export interface HwpxAnalyzeResult {
  template: HwpxTemplateInfo;
  suggestedMappings: CellMapping[];
}

export interface HwpxAiMappingValidationResult {
  isValid: boolean;
  totalFields: number;
  mappedFields: number;
  missingFields: number;
  issues: Array<{
    type: 'missing' | 'warning' | 'info';
    field: string;
    message: string;
    hwpxRow?: number;
    hwpxCol?: number;
    suggestedExcelColumn?: string;
  }>;
  suggestions: Array<{
    excelColumn: string;
    hwpxRow: number;
    hwpxCol: number;
    labelText: string;
    reason: string;
  }>;
}

export interface HwpxAiMappingResult {
  mappings: CellMapping[];
  validationIssues: string[];
  validationResult: HwpxAiMappingValidationResult;
}

export interface MappingValidationIssue {
  type: 'missing' | 'warning' | 'info';
  field: string;
  message: string;
  hwpxRow?: number;
  hwpxCol?: number;
  suggestedExcelColumn?: string;
}

export interface MappingValidationResult {
  isValid: boolean;
  totalFields: number;
  mappedFields: number;
  missingFields: number;
  issues: MappingValidationIssue[];
  suggestions: CellMapping[];
}

export interface ExcelColumnsResult {
  columns: string[];
  hierarchicalColumns: HierarchicalColumn[];
  headerAnalysis: HeaderAnalysisResult;
}

@Injectable()
export class HwpxGeneratorService {
  constructor(
    private readonly hwpxParser: HwpxParserAdapter,
    private readonly mappingGraphService: HwpxMappingGraphService,
    private readonly headerDetectionAgent: HeaderDetectionAgent,
    @Inject(EXCEL_PARSER_PORT)
    private readonly excelParser: ExcelParserPort,
  ) {}

  /**
   * HWPX 템플릿 분석 및 매핑 제안
   */
  async analyzeTemplate(
    templateBuffer: Buffer,
    fileName: string,
  ): Promise<HwpxAnalyzeResult> {
    // HWPX 유효성 검사
    if (!this.hwpxParser.isValidHwpx(templateBuffer)) {
      throw new Error('유효하지 않은 HWPX 파일입니다.');
    }

    const template = await this.hwpxParser.analyzeTemplate(templateBuffer, fileName);

    // 기본 매핑 제안 (표의 셀 정보 기반)
    const suggestedMappings = this.generateSuggestedMappings(template);

    return {
      template,
      suggestedMappings,
    };
  }

  /**
   * Excel 데이터로 HWPX 일괄 생성
   */
  async generateBulk(options: HwpxGenerateOptions): Promise<Buffer> {
    const { templateBuffer, dataBuffer, sheetName, mappings, fileNameColumn, mappingContext } = options;

    // HWPX 유효성 검사
    if (!this.hwpxParser.isValidHwpx(templateBuffer)) {
      throw new Error('유효하지 않은 HWPX 파일입니다.');
    }

    // 스마트 헤더 감지를 사용하여 Excel 데이터 추출
    const excelData = await this.extractSmartSheetData(dataBuffer, sheetName);

    console.log('[HwpxGeneratorService] Extracted', excelData.length, 'rows with smart header detection');
    if (excelData.length > 0) {
      console.log('[HwpxGeneratorService] First row keys:', Object.keys(excelData[0]).slice(0, 10));
    }

    // Record<string, unknown>을 Record<string, string>으로 변환 + 머지 매핑 적용
    const stringData = excelData.map((row) => {
      const stringRow: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        stringRow[key] = this.convertToString(value);
      }

      // 머지 매핑 규칙 적용: 두 컬럼을 합쳐서 새 컬럼 생성
      // mappingContext가 있으면 동적으로, 없으면 기본 규칙 사용
      this.applyMergeMappings(stringRow, mappingContext?.fieldRelations);

      return stringRow;
    });

    // HWPX 일괄 생성
    return this.hwpxParser.generateBulk(
      templateBuffer,
      stringData,
      mappings,
      fileNameColumn,
    );
  }

  /**
   * 단일 데이터로 단일 HWPX 생성
   */
  async generateSingle(
    templateBuffer: Buffer,
    data: Record<string, string>,
    mappings: CellMapping[],
  ): Promise<Buffer> {
    if (!this.hwpxParser.isValidHwpx(templateBuffer)) {
      throw new Error('유효하지 않은 HWPX 파일입니다.');
    }

    return this.hwpxParser.fillTemplate(templateBuffer, data, mappings);
  }

  /**
   * Excel 시트 목록 조회
   */
  async getExcelSheets(dataBuffer: Buffer): Promise<string[]> {
    return this.excelParser.getSheetNames(dataBuffer);
  }

  /**
   * Excel 컬럼 목록 조회 (스마트 헤더 감지 사용)
   */
  async getExcelColumns(dataBuffer: Buffer, sheetName: string): Promise<string[]> {
    const result = await this.getExcelColumnsWithAnalysis(dataBuffer, sheetName);
    return result.columns;
  }

  /**
   * Excel 컬럼 상세 분석 (HeaderDetectionAgent 사용)
   */
  async getExcelColumnsWithAnalysis(
    dataBuffer: Buffer,
    sheetName: string,
  ): Promise<ExcelColumnsResult> {
    console.log('[HwpxGeneratorService] Analyzing Excel columns with HeaderDetectionAgent...');

    const headerAnalysis = await this.headerDetectionAgent.analyze(dataBuffer, sheetName);

    console.log('[HwpxGeneratorService] Header analysis result:', {
      headerRows: headerAnalysis.headerRows,
      dataStartRow: headerAnalysis.dataStartRow,
      columnsCount: headerAnalysis.columns.length,
      metaInfo: headerAnalysis.metaInfo,
    });

    // 계층적 컬럼 이름 추출
    const columns = headerAnalysis.columns.map(c => c.name);

    console.log('[HwpxGeneratorService] Detected columns (first 10):', columns.slice(0, 10));

    return {
      columns,
      hierarchicalColumns: headerAnalysis.columns,
      headerAnalysis,
    };
  }

  /**
   * AI 기반 HWPX 자동 매핑 생성
   * LangGraph 스타일 병렬 파이프라인 사용
   */
  async generateAiMappings(
    templateBuffer: Buffer,
    dataBuffer: Buffer,
    sheetName: string,
    context?: MappingContext,
  ): Promise<HwpxAiMappingResult> {
    try {
      console.log('[HwpxGeneratorService] Starting AI mapping generation (LangGraph pipeline)...');
      console.log('[HwpxGeneratorService] Sheet name:', sheetName);
      if (context) {
        console.log('[HwpxGeneratorService] Context provided:', {
          hasDescription: !!context.description,
          fieldRelationsCount: context.fieldRelations?.length || 0,
          synonymsCount: Object.keys(context.synonyms || {}).length,
          specialRulesCount: context.specialRules?.length || 0,
        });
      }

      // HWPX 유효성 검사
      if (!this.hwpxParser.isValidHwpx(templateBuffer)) {
        throw new Error('유효하지 않은 HWPX 파일입니다.');
      }
      console.log('[HwpxGeneratorService] HWPX validation passed');

      // LangGraph 병렬 파이프라인 실행 (컨텍스트 전달)
      const result = await this.mappingGraphService.execute(
        templateBuffer,
        dataBuffer,
        sheetName,
        context,
      );

      console.log('[HwpxGeneratorService] Graph pipeline completed:', result.mappings.length, 'mappings');
      return result;
    } catch (error) {
      console.error('[HwpxGeneratorService] Error in generateAiMappings:', error);
      throw error;
    }
  }

  /**
   * 매핑 검증 - 누락된 필드 찾기 및 추가 매핑 제안
   */
  async validateMappings(
    templateBuffer: Buffer,
    dataBuffer: Buffer,
    sheetName: string,
    currentMappings: CellMapping[],
  ): Promise<MappingValidationResult> {
    console.log('[HwpxGeneratorService] Validating mappings...');
    console.log('[HwpxGeneratorService] Current mappings count:', currentMappings.length);

    // HWPX 템플릿 분석
    const template = await this.hwpxParser.analyzeTemplate(templateBuffer, 'template.hwpx');
    if (template.tables.length === 0) {
      throw new Error('HWPX 파일에 테이블이 없습니다.');
    }

    const table = template.tables[0];

    // Excel 컬럼 추출
    const excelColumns = await this.extractSmartColumns(dataBuffer, sheetName);
    console.log('[HwpxGeneratorService] Excel columns:', excelColumns.length);

    // 필수 필드 목록 정의 (개인이력카드 기준)
    const requiredFields = [
      '성명', '연락처', '생년월일', '이메일', '성별', '거주지',
      '참여분야', '수행기관', '사업명', '참여기간', '국가', '직무',
      '희망직종', '희망직무',
    ];

    // 현재 매핑된 셀 위치 Set
    const mappedCells = new Set(currentMappings.map(m => `${m.hwpxRow}-${m.hwpxCol}`));
    const mappedColumns = new Set(currentMappings.map(m => m.excelColumn));

    const issues: MappingValidationIssue[] = [];
    const suggestions: CellMapping[] = [];

    // 셀 맵 생성
    const cellMap = new Map<string, { rowIndex: number; colIndex: number; text: string; isHeader: boolean; colSpan?: number; rowSpan?: number }>();
    for (const cell of table.cells) {
      cellMap.set(`${cell.rowIndex}-${cell.colIndex}`, cell);
    }

    // 정규화 함수
    const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase();

    // 라벨 셀 필터링 (헤더이고, 텍스트가 있고, 섹션 마커가 아닌 것)
    const labelCells = table.cells.filter(cell =>
      cell.isHeader &&
      cell.text &&
      cell.text.trim().length >= 2 &&
      !/^\d+\./.test(cell.text.trim()) &&
      cell.text.trim() !== '개인이력카드'
    );

    console.log('[HwpxGeneratorService] Label cells found:', labelCells.length);

    // 1. 필수 필드 체크 - Excel 컬럼에 있지만 매핑되지 않은 필드 찾기
    for (const reqField of requiredFields) {
      const normalizedReq = normalize(reqField);

      // Excel 컬럼에서 매칭되는 것 찾기
      const matchingExcelCol = excelColumns.find(col => {
        const normalizedCol = normalize(col);
        return normalizedCol === normalizedReq ||
               normalizedCol.includes(normalizedReq) ||
               normalizedReq.includes(normalizedCol);
      });

      if (matchingExcelCol && !mappedColumns.has(matchingExcelCol)) {
        // Excel에는 있지만 매핑되지 않은 경우 - 대응하는 HWPX 셀 찾기
        for (const labelCell of labelCells) {
          const normalizedLabel = normalize(labelCell.text || '');

          if (normalizedLabel === normalizedReq ||
              normalizedLabel.includes(normalizedReq) ||
              normalizedReq.includes(normalizedLabel)) {
            // 데이터 셀 찾기 (오른쪽)
            const rightCol = labelCell.colIndex + (labelCell.colSpan || 1);
            const rightCell = cellMap.get(`${labelCell.rowIndex}-${rightCol}`);

            if (rightCell && !rightCell.isHeader) {
              const cellKey = `${rightCell.rowIndex}-${rightCell.colIndex}`;
              if (!mappedCells.has(cellKey)) {
                issues.push({
                  type: 'missing',
                  field: reqField,
                  message: `필수 필드 "${reqField}"가 매핑되지 않았습니다.`,
                  hwpxRow: rightCell.rowIndex,
                  hwpxCol: rightCell.colIndex,
                  suggestedExcelColumn: matchingExcelCol,
                });

                suggestions.push({
                  excelColumn: matchingExcelCol,
                  hwpxRow: rightCell.rowIndex,
                  hwpxCol: rightCell.colIndex,
                });
                break;
              }
            }

            // 아래 셀 시도
            const belowRow = labelCell.rowIndex + (labelCell.rowSpan || 1);
            const belowCell = cellMap.get(`${belowRow}-${labelCell.colIndex}`);

            if (belowCell && !belowCell.isHeader) {
              const cellKey = `${belowCell.rowIndex}-${belowCell.colIndex}`;
              if (!mappedCells.has(cellKey)) {
                issues.push({
                  type: 'missing',
                  field: reqField,
                  message: `필수 필드 "${reqField}"가 매핑되지 않았습니다.`,
                  hwpxRow: belowCell.rowIndex,
                  hwpxCol: belowCell.colIndex,
                  suggestedExcelColumn: matchingExcelCol,
                });

                suggestions.push({
                  excelColumn: matchingExcelCol,
                  hwpxRow: belowCell.rowIndex,
                  hwpxCol: belowCell.colIndex,
                });
                break;
              }
            }
          }
        }
      }
    }

    // 2. 매핑되지 않은 Excel 컬럼 경고
    for (const excelCol of excelColumns) {
      if (!mappedColumns.has(excelCol) && !suggestions.some(s => s.excelColumn === excelCol)) {
        // 이미 제안에 없는 경우만 경고
        const isRequired = requiredFields.some(rf => {
          const norm = normalize(rf);
          const normCol = normalize(excelCol);
          return normCol === norm || normCol.includes(norm) || norm.includes(normCol);
        });

        if (isRequired) {
          issues.push({
            type: 'warning',
            field: excelCol,
            message: `Excel 컬럼 "${excelCol}"이 매핑되지 않았습니다.`,
          });
        }
      }
    }

    // 3. 매핑 요약 정보
    const totalFields = labelCells.length;
    const mappedFields = currentMappings.length;
    const missingFields = issues.filter(i => i.type === 'missing').length;
    const isValid = missingFields === 0;

    console.log('[HwpxGeneratorService] Validation result:', {
      isValid,
      totalFields,
      mappedFields,
      missingFields,
      issuesCount: issues.length,
      suggestionsCount: suggestions.length,
    });

    return {
      isValid,
      totalFields,
      mappedFields,
      missingFields,
      issues,
      suggestions,
    };
  }

  /**
   * 템플릿 기반 매핑 제안 생성
   */
  private generateSuggestedMappings(template: HwpxTemplateInfo): CellMapping[] {
    const suggestions: CellMapping[] = [];

    // 표의 데이터 셀(헤더가 아닌 셀) 기반으로 매핑 제안
    for (const table of template.tables) {
      for (const cell of table.cells) {
        // 헤더 바로 아래 행의 데이터 셀
        if (!cell.isHeader && cell.text) {
          // 해당 컬럼의 헤더 텍스트 찾기
          const headerCell = table.cells.find(
            (c) => c.isHeader && c.colIndex === cell.colIndex && c.rowIndex < cell.rowIndex,
          );

          if (headerCell && headerCell.text) {
            suggestions.push({
              excelColumn: headerCell.text.trim(),
              hwpxRow: cell.rowIndex,
              hwpxCol: cell.colIndex,
            });
          }
        }
      }
    }

    return suggestions;
  }

  /**
   * 값을 문자열로 변환
   */
  private convertToString(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      // 날짜 포맷팅 (YYYY-MM-DD)
      return value.toISOString().split('T')[0];
    }

    if (typeof value === 'object') {
      // ExcelJS의 richText 등 복잡한 객체 처리
      if ('richText' in (value as Record<string, unknown>)) {
        const richText = (value as { richText: Array<{ text: string }> }).richText;
        return richText.map((t) => t.text).join('');
      }
      if ('result' in (value as Record<string, unknown>)) {
        return String((value as { result: unknown }).result);
      }
      return JSON.stringify(value);
    }

    return String(value);
  }

  /**
   * 스마트 Excel 컬럼 추출
   * - 섹션 헤더(예: "1. 신상정보")가 있는 행은 건너뛰고
   * - 실제 필드명(예: "성명", "연락처")이 있는 행을 헤더로 사용
   */
  private async extractSmartColumns(
    buffer: Buffer,
    sheetName: string,
  ): Promise<string[]> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    // sheetName이 빈 문자열이면 첫 번째 시트 사용
    const targetSheetName = sheetName && sheetName.trim() !== ''
      ? sheetName
      : workbook.worksheets[0]?.name;

    const worksheet = workbook.getWorksheet(targetSheetName);
    if (!worksheet) {
      throw new Error(`Sheet "${targetSheetName}" not found`);
    }

    const headerInfo = await this.findSmartHeaderRow(worksheet);
    return headerInfo.columns;
  }

  /**
   * 스마트 헤더 행 찾기 (헤더 행 번호와 컬럼명 반환)
   */
  private async findSmartHeaderRow(
    worksheet: import('exceljs').Worksheet,
  ): Promise<{ headerRowNum: number; columns: string[] }> {
    // 처음 10행까지 스캔하여 실제 헤더 행 찾기
    const rows: Array<{ rowNum: number; values: string[]; score: number }> = [];

    for (let rowNum = 1; rowNum <= 10; rowNum++) {
      const row = worksheet.getRow(rowNum);
      const values: string[] = [];
      let nonEmptyCount = 0;
      let hasShortLabels = 0;  // 짧은 텍스트(필드명처럼 보이는) 개수
      let hasSectionMarkers = 0;  // "1.", "2." 등 섹션 마커

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const value = cell.value;
        let text = '';

        if (value !== null && value !== undefined) {
          const valueObj = value as unknown;
          if (typeof valueObj === 'object' && valueObj !== null && 'richText' in (valueObj as object)) {
            const richTextVal = valueObj as { richText: Array<{ text: string }> };
            text = (richTextVal.richText || []).map((t) => t.text).join('');
          } else if (typeof valueObj === 'object' && valueObj !== null && 'result' in (valueObj as object)) {
            const resultVal = valueObj as { result: unknown };
            text = String(resultVal.result);
          } else {
            text = String(value);
          }
        }

        const trimmed = text.trim();
        values[colNumber - 1] = trimmed;

        if (trimmed.length > 0) {
          nonEmptyCount++;

          // 짧은 텍스트 (2-10자)는 필드명일 가능성 높음
          if (trimmed.length >= 2 && trimmed.length <= 10) {
            hasShortLabels++;
          }

          // "1.", "2." 등으로 시작하면 섹션 헤더
          if (/^\d+\./.test(trimmed)) {
            hasSectionMarkers++;
          }
        }
      });

      // 스코어 계산: 짧은 라벨이 많고, 섹션 마커가 없으며, 비어있지 않은 셀이 많을수록 높음
      const score = nonEmptyCount * 2 + hasShortLabels * 3 - hasSectionMarkers * 10;

      if (nonEmptyCount >= 3) {  // 최소 3개 이상의 값이 있어야 헤더로 간주
        rows.push({ rowNum, values, score });
      }
    }

    // 가장 높은 점수의 행을 헤더로 선택
    rows.sort((a, b) => b.score - a.score);

    if (rows.length === 0) {
      console.log('[SmartColumns] No suitable header row found, using row 1');
      return { headerRowNum: 1, columns: [] };
    }

    const headerRow = rows[0];
    console.log('[SmartColumns] Selected header row:', headerRow.rowNum, 'Score:', headerRow.score);
    console.log('[SmartColumns] Header values:', headerRow.values.filter(v => v).slice(0, 20));

    // 빈 값 제거하고 유효한 컬럼명만 반환
    const columns = headerRow.values.filter(v => v && v.length > 0 && v !== 'undefined');

    return { headerRowNum: headerRow.rowNum, columns };
  }

  /**
   * 스마트 헤더 감지를 사용하여 Excel 데이터 추출
   * HeaderDetectionAgent 사용하여 복잡한 다중 레벨 헤더 지원
   */
  private async extractSmartSheetData(
    buffer: Buffer,
    sheetName: string,
  ): Promise<Array<Record<string, unknown>>> {
    // HeaderDetectionAgent를 사용하여 헤더 분석
    console.log('[SmartSheetData] Using HeaderDetectionAgent for header analysis...');
    const headerAnalysis = await this.headerDetectionAgent.analyze(buffer, sheetName);

    console.log('[SmartSheetData] HeaderDetectionAgent result:', {
      headerRows: headerAnalysis.headerRows,
      dataStartRow: headerAnalysis.dataStartRow,
      columnsCount: headerAnalysis.columns.length,
      metaInfo: headerAnalysis.metaInfo,
    });

    if (headerAnalysis.columns.length === 0) {
      console.log('[SmartSheetData] No columns detected, falling back to legacy parser');
      return this.excelParser.extractSheetData(buffer, sheetName);
    }

    // ExcelJS로 데이터 추출
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    // sheetName이 빈 문자열이면 첫 번째 시트 사용
    const targetSheetName = sheetName && sheetName.trim() !== ''
      ? sheetName
      : workbook.worksheets[0]?.name;

    const worksheet = workbook.getWorksheet(targetSheetName);
    if (!worksheet) {
      throw new Error(`Sheet "${targetSheetName}" not found`);
    }

    // 컬럼 인덱스 매핑 생성 (HeaderDetectionAgent 결과 사용)
    // HeaderDetectionAgent는 이미 ExcelJS의 1-based colIndex를 반환하므로 그대로 사용
    const columnIndexToName: Array<{ colIndex: number; name: string }> = headerAnalysis.columns.map(col => ({
      colIndex: col.colIndex, // 이미 1-based임
      name: col.name,
    }));

    console.log('[SmartSheetData] Column count:', columnIndexToName.length);
    console.log('[SmartSheetData] Column mapping (first 5):',
      columnIndexToName.slice(0, 5).map(c => `${c.name}@${c.colIndex}`).join(', '));

    // 데이터 추출 - dataStartRow부터 시작
    const data: Array<Record<string, unknown>> = [];
    const dataStartRow = headerAnalysis.dataStartRow;

    console.log('[SmartSheetData] Extracting data from row', dataStartRow);

    // 메타 행 패턴 (반복되는 클래스 헤더 필터링용)
    const metaPatterns = [
      /^Class Name\s*:/i,
      /^Book Name\s*:/i,
      /^Class Time\s*:/i,
      /^Class Day\s*:/i,
      /^Teacher Name\s*:/i,
      /^Manager Name\s*:/i,
      /^Progress Rate\s*:/i,
      /^No\.$/,
      /^한글이름$/,
      /^영문이름$/,
      /^이메일$/,
      /쿠팡.*학기/i,  // 쿠팡 25-3학기... 패턴
    ];

    const isMetaRow = (firstCellValue: unknown): boolean => {
      const text = String(firstCellValue || '').trim();
      // 빈 문자열이면 메타 아님
      if (!text) return false;
      // 숫자만 있으면 데이터 행 (No. 컬럼의 데이터)
      if (/^\d+$/.test(text)) return false;
      // 메타 패턴 체크
      return metaPatterns.some(pattern => pattern.test(text));
    };

    worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
      // dataStartRow 이전은 건너뛰기
      if (rowNum < dataStartRow) {
        return;
      }

      // 첫 번째 셀의 값으로 메타 행 여부 확인
      const firstCell = row.getCell(1);
      const firstValue = this.extractCellValue(firstCell.value);

      // 메타 행 패턴이면 건너뛰기 (반복되는 클래스 헤더)
      if (isMetaRow(firstValue)) {
        return;
      }

      const rowData: Record<string, unknown> = {};
      let hasData = false;

      // 각 컬럼에 대해 값 추출
      for (const { colIndex, name } of columnIndexToName) {
        const cell = row.getCell(colIndex);
        const value = cell.value;

        if (value !== null && value !== undefined) {
          hasData = true;
          rowData[name] = this.extractCellValue(value);
        }
      }

      if (hasData) {
        data.push(rowData);
      }
    });

    console.log('[SmartSheetData] Extracted rows:', data.length);
    if (data.length > 0) {
      // 첫 행의 한글이름, 영문이름 값 확인
      const firstRow = data[0];
      console.log('[SmartSheetData] First row - 한글이름:', firstRow['한글이름'], ', 영문이름:', firstRow['영문이름']);
    }

    return data;
  }

  /**
   * 머지 매핑 규칙 적용
   * 여러 Excel 컬럼을 하나로 합쳐서 HWPX 필드에 매핑할 때 사용
   * 예: "전문가 강연" + "해외 경력자 멘토링" → "핵심 세미나"
   *
   * @param row - Excel 데이터 행
   * @param fieldRelations - UI에서 주입된 필드 관계 (없으면 기본 규칙 사용)
   */
  private applyMergeMappings(
    row: Record<string, string>,
    fieldRelations?: Array<{
      targetField: string;
      sourceFields: string[];
      mergeStrategy?: 'concat' | 'first' | 'all';
      description?: string;
    }>,
  ): void {
    // fieldRelations가 제공되면 동적 규칙 사용, 없으면 기본 규칙 사용
    const mergeRules = fieldRelations?.length
      ? fieldRelations.map((fr) => ({
          targetColumn: fr.targetField,
          sourceColumns: fr.sourceFields,
          separator: fr.mergeStrategy === 'concat' ? '' : ' / ',
          strategy: fr.mergeStrategy || 'all',
        }))
      : [
          // 기본 규칙 (레거시 호환)
          {
            targetColumn: '핵심 세미나',
            sourceColumns: ['전문가 강연', '해외 경력자 멘토링'],
            separator: ' / ',
            strategy: 'all' as const,
          },
        ];

    for (const rule of mergeRules) {
      const values: string[] = [];

      for (const sourceCol of rule.sourceColumns) {
        // 정확한 컬럼명으로 찾기
        let value = row[sourceCol];

        // 정확히 매칭되지 않으면 유사 컬럼명 검색
        if (!value) {
          const normalizedSource = sourceCol.replace(/\s+/g, '');
          for (const [key, val] of Object.entries(row)) {
            const normalizedKey = key.replace(/\s+/g, '');
            if (normalizedKey.includes(normalizedSource) || normalizedSource.includes(normalizedKey)) {
              value = val;
              break;
            }
          }
        }

        if (value && value.trim()) {
          // strategy에 따른 처리
          if (rule.strategy === 'first') {
            // 첫 번째 값만 사용
            if (values.length === 0) {
              values.push(value.trim());
            }
          } else {
            // 'all' 또는 'concat': 모든 값 수집
            values.push(value.trim());
          }
        }
      }

      // 값이 하나라도 있으면 머지된 값 생성
      if (values.length > 0) {
        const mergedValue = values.join(rule.separator);
        row[rule.targetColumn] = mergedValue;
        console.log(`[MergeMapping] Created "${rule.targetColumn}" = "${mergedValue}" from ${rule.sourceColumns.join(', ')}`);
      }
    }
  }

  /**
   * 셀 값을 안전하게 추출 (메모리 효율적)
   */
  private extractCellValue(value: unknown): string | number | boolean | Date {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;

      // richText 처리
      if ('richText' in obj && Array.isArray(obj.richText)) {
        return (obj.richText as Array<{ text: string }>).map((t) => t.text).join('');
      }

      // formula result 처리
      if ('result' in obj) {
        return this.extractCellValue(obj.result);
      }

      // hyperlink 처리
      if ('text' in obj) {
        return String(obj.text);
      }

      return JSON.stringify(value);
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    return String(value);
  }
}
