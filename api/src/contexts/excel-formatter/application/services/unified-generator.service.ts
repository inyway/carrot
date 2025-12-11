import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { HwpxGeneratorService } from './hwpx-generator.service';
import { HeaderDetectionAgent } from '../agents';
import {
  getCellText,
  findSmartHeaderRow,
  extractExcelData as extractExcelDataUtil,
  extractCsvData as extractCsvDataUtil,
  extractJsonData as extractJsonDataUtil,
  escapeCsvValue,
  extractCellValue,
} from './utils/excel-utils';

// 인터페이스 정의
export interface MappingItem {
  templateField: string;
  dataColumn: string;
}

export interface CellMapping {
  excelColumn: string;
  hwpxRow: number;
  hwpxCol: number;
}

export interface FieldRelation {
  targetField: string;
  sourceFields: string[];
  mergeStrategy?: 'concat' | 'first' | 'all';
  description?: string;
}

export interface MappingContext {
  description?: string;
  fieldRelations?: FieldRelation[];
  synonyms?: Record<string, string[]>;
}

export interface UnifiedGenerateParams {
  templateBuffer: Buffer;
  templateFileName: string;
  dataBuffer: Buffer;
  dataFileName: string;
  sheetName?: string;
  dataSheet?: string;
  mappings: MappingItem[] | CellMapping[];
  fileNameColumn?: string;
  mappingContext?: MappingContext;
  onProgress?: ProgressCallback;
}

export interface GenerateResult {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

// 진행률 콜백 타입
export interface ProgressInfo {
  phase: 'init' | 'processing' | 'finalizing' | 'complete' | 'error';
  current: number;
  total: number;
  percentage: number;
  message: string;
  fileName?: string;
  successCount?: number;
  failureCount?: number;
}

export type ProgressCallback = (progress: ProgressInfo) => void;

// 에러 복구 관련 인터페이스
export interface RowError {
  rowIndex: number;
  rowData: Record<string, unknown>;
  error: string;
  retryCount: number;
}

export interface GenerationStats {
  totalRows: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  errors: RowError[];
}

// 재시도 설정
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelayMs: 100,
  retryableErrors: [
    'EBUSY',
    'ETIMEDOUT',
    'ECONNRESET',
    'memory',
    'heap',
  ],
};

@Injectable()
export class UnifiedGeneratorService {
  constructor(
    private readonly hwpxGeneratorService: HwpxGeneratorService,
    private readonly headerDetectionAgent: HeaderDetectionAgent,
  ) {}

  /**
   * 에러가 재시도 가능한지 확인
   */
  private isRetryableError(error: unknown): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return RETRY_CONFIG.retryableErrors.some(
      (retryable) => errorMessage.toLowerCase().includes(retryable.toLowerCase()),
    );
  }

  /**
   * 딜레이 함수
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 재시도 로직이 포함된 작업 실행
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    rowIndex: number,
    rowData: Record<string, unknown>,
  ): Promise<{ success: true; result: T } | { success: false; error: RowError }> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        const result = await operation();
        return { success: true, result };
      } catch (error) {
        lastError = error;

        // 재시도 가능한 에러가 아니면 즉시 실패 반환
        if (!this.isRetryableError(error)) {
          break;
        }

        // 마지막 시도가 아니면 대기 후 재시도
        if (attempt < RETRY_CONFIG.maxRetries) {
          console.log(
            `[UnifiedGenerator] Row ${rowIndex + 1} 재시도 ${attempt + 1}/${RETRY_CONFIG.maxRetries}`,
          );
          await this.delay(RETRY_CONFIG.retryDelayMs * (attempt + 1)); // 점진적 대기
        }
      }
    }

    return {
      success: false,
      error: {
        rowIndex,
        rowData,
        error: lastError instanceof Error ? lastError.message : String(lastError),
        retryCount: RETRY_CONFIG.maxRetries,
      },
    };
  }

  /**
   * 에러 로그 파일 생성
   */
  private generateErrorLog(stats: GenerationStats): string {
    const lines: string[] = [
      '========================================',
      '생성 결과 요약',
      '========================================',
      `총 행 수: ${stats.totalRows}`,
      `성공: ${stats.successCount}`,
      `실패: ${stats.failureCount}`,
      `건너뜀: ${stats.skippedCount}`,
      '',
    ];

    if (stats.errors.length > 0) {
      lines.push('========================================');
      lines.push('실패한 행 상세');
      lines.push('========================================');

      for (const err of stats.errors) {
        lines.push(`\n[행 ${err.rowIndex + 1}]`);
        lines.push(`에러: ${err.error}`);
        lines.push(`재시도 횟수: ${err.retryCount}`);
        lines.push('데이터:');
        for (const [key, value] of Object.entries(err.rowData)) {
          if (value !== undefined && value !== null && String(value).trim()) {
            lines.push(`  ${key}: ${String(value).substring(0, 100)}`);
          }
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * 템플릿 형식에 따라 적절한 생성기로 라우팅
   */
  async generate(params: UnifiedGenerateParams): Promise<GenerateResult> {
    const templateFormat = this.detectFormat(params.templateFileName);
    const dataFormat = this.detectFormat(params.dataFileName);

    console.log('[UnifiedGenerator] Template format:', templateFormat);
    console.log('[UnifiedGenerator] Data format:', dataFormat);
    console.log('[UnifiedGenerator] MappingContext:', params.mappingContext ? 'provided' : 'not provided');

    switch (templateFormat) {
      case 'hwpx':
        return this.generateHwpx(params, dataFormat);

      case 'xlsx':
      case 'xls':
        return this.generateExcel(params, dataFormat);

      case 'csv':
        return this.generateCsv(params, dataFormat);

      default:
        throw new BadRequestException(`지원하지 않는 템플릿 형식입니다: ${templateFormat}`);
    }
  }

  /**
   * HWPX 템플릿 처리 (기존 HwpxGeneratorService 사용)
   */
  private async generateHwpx(
    params: UnifiedGenerateParams,
    dataFormat: string,
  ): Promise<GenerateResult> {
    // CellMapping 형식으로 변환 (hwpxRow, hwpxCol 필요)
    const hwpxMappings = params.mappings as CellMapping[];

    const zipBuffer = await this.hwpxGeneratorService.generateBulk({
      templateBuffer: params.templateBuffer,
      dataBuffer: params.dataBuffer,
      sheetName: params.sheetName || '',
      mappings: hwpxMappings.map((m) => ({
        excelColumn: m.excelColumn,
        hwpxRow: m.hwpxRow,
        hwpxCol: m.hwpxCol,
      })),
      fileNameColumn: params.fileNameColumn,
      mappingContext: params.mappingContext,
    });

    return {
      buffer: zipBuffer,
      contentType: 'application/zip',
      fileName: `hwpx_output_${Date.now()}.zip`,
    };
  }

  /**
   * Excel 템플릿 처리 (메모리 최적화 버전)
   * - 템플릿 메타데이터는 한 번만 추출
   * - 각 행 생성 시 버퍼 복사만 수행
   */
  private async generateExcel(
    params: UnifiedGenerateParams,
    dataFormat: string,
  ): Promise<GenerateResult> {
    const mappings = params.mappings as MappingItem[];

    // ============================================
    // 1단계: 템플릿 메타데이터 추출 (한 번만 실행)
    // ============================================
    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.load(params.templateBuffer as unknown as ArrayBuffer);

    const targetTemplateSheet =
      params.sheetName || templateWorkbook.worksheets[0]?.name;
    const templateWs = templateWorkbook.getWorksheet(targetTemplateSheet);

    if (!templateWs) {
      throw new BadRequestException('템플릿 시트를 찾을 수 없습니다.');
    }

    // 헤더 행 위치 (한 번만 계산) - 유틸리티 함수 사용
    const { headerRowNum: templateHeaderRow } =
      await findSmartHeaderRow(templateWs);

    // 템플릿 컬럼 위치 매핑 (한 번만 계산)
    const templateColumnIndex = new Map<string, number>();
    const headerRow = templateWs.getRow(templateHeaderRow);

    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = getCellText(cell);
      if (text) {
        templateColumnIndex.set(text, colNumber);
      }
    });

    // 매핑 맵 생성 (한 번만 계산)
    const mappingMap = new Map<string, string>();
    for (const m of mappings) {
      if (m.templateField && m.dataColumn) {
        mappingMap.set(m.templateField, m.dataColumn);
      }
    }

    // 데이터 행 번호 (한 번만 계산)
    const dataRowNum = templateHeaderRow + 1;

    // 매핑 엔트리 배열 (한 번만 생성)
    const mappingEntries = Array.from(mappingMap.entries());

    // 템플릿 워크북 해제 (메모리 절약)
    // templateWorkbook은 더 이상 필요 없음

    // ============================================
    // 2단계: 데이터 추출 (한 번만 실행)
    // ============================================
    const dataRows = await this.extractData(
      params.dataBuffer,
      dataFormat,
      params.dataSheet,
    );

    if (dataRows.length === 0) {
      throw new BadRequestException('데이터가 없습니다.');
    }

    const totalRows = dataRows.length;
    console.log(`[UnifiedGenerator] Excel 생성 시작: ${totalRows}개 행 처리`);

    // 생성 통계 초기화
    const stats: GenerationStats = {
      totalRows,
      successCount: 0,
      failureCount: 0,
      skippedCount: 0,
      errors: [],
    };

    // 진행률 헬퍼 (성공/실패 카운트 포함)
    const reportProgress = (
      phase: ProgressInfo['phase'],
      current: number,
      message: string,
      fileName?: string,
    ) => {
      if (params.onProgress) {
        params.onProgress({
          phase,
          current,
          total: totalRows,
          percentage: Math.round((current / totalRows) * 100),
          message,
          fileName,
          successCount: stats.successCount,
          failureCount: stats.failureCount,
        });
      }
    };

    reportProgress('init', 0, '파일 생성 준비 중...');

    // ============================================
    // 3단계: 배치 처리로 파일 생성 (에러 복구 포함)
    // ============================================
    const zip = new JSZip();
    const BATCH_SIZE = 50; // 50개씩 배치 처리
    const totalBatches = Math.ceil(totalRows / BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const startIdx = batchIdx * BATCH_SIZE;
      const endIdx = Math.min(startIdx + BATCH_SIZE, totalRows);
      const batchRows = dataRows.slice(startIdx, endIdx);

      // 배치 내 병렬 처리 (개별 에러 처리 포함)
      const batchPromises = batchRows.map(async (row, localIdx) => {
        const rowIdx = startIdx + localIdx;
        const rowData = { ...row };

        // 데이터 유효성 검사 - 빈 행 스킵
        const hasValidData = Object.values(rowData).some(
          (v) => v !== undefined && v !== null && String(v).trim() !== '',
        );
        if (!hasValidData) {
          stats.skippedCount++;
          return { type: 'skipped' as const, rowIdx };
        }

        // 재시도 로직이 포함된 파일 생성
        const result = await this.executeWithRetry(
          async () => {
            // 머지 규칙 적용
            if (params.mappingContext?.fieldRelations) {
              this.applyMergeMappings(rowData, params.mappingContext.fieldRelations);
            }

            // 템플릿 버퍼에서 새 워크북 생성
            const newWorkbook = new ExcelJS.Workbook();
            await newWorkbook.xlsx.load(params.templateBuffer as unknown as ArrayBuffer);

            const newWs = newWorkbook.getWorksheet(targetTemplateSheet);
            if (!newWs) {
              throw new Error('템플릿 시트를 찾을 수 없습니다.');
            }

            // 데이터 행 채우기 (미리 계산된 메타데이터 사용)
            const targetRow = newWs.getRow(dataRowNum);

            for (const [templateField, dataColumn] of mappingEntries) {
              const colIndex = templateColumnIndex.get(templateField);
              if (colIndex && rowData[dataColumn] !== undefined) {
                const cell = targetRow.getCell(colIndex);
                const value = rowData[dataColumn];

                if (value instanceof Date) {
                  cell.value = value;
                } else if (typeof value === 'number') {
                  cell.value = value;
                } else {
                  cell.value = String(value ?? '');
                }
              }
            }

            targetRow.commit();

            // 파일명 결정
            let fileName: string;
            if (params.fileNameColumn && rowData[params.fileNameColumn]) {
              fileName = String(rowData[params.fileNameColumn])
                .replace(/[\/\\:*?"<>|]/g, '_')
                .trim();
            } else {
              fileName = `report_${rowIdx + 1}`;
            }

            const fileBuffer = await newWorkbook.xlsx.writeBuffer();
            return { fileName, fileBuffer };
          },
          rowIdx,
          rowData,
        );

        if (result.success) {
          stats.successCount++;
          return { type: 'success' as const, ...result.result };
        } else {
          stats.failureCount++;
          stats.errors.push(result.error);
          console.warn(
            `[UnifiedGenerator] Row ${rowIdx + 1} 생성 실패: ${result.error.error}`,
          );
          return { type: 'error' as const, rowIdx, error: result.error };
        }
      });

      // 배치 결과 수집
      const batchResults = await Promise.all(batchPromises);

      // ZIP에 성공한 파일만 추가
      for (const result of batchResults) {
        if (result.type === 'success') {
          zip.file(`${result.fileName}.xlsx`, result.fileBuffer);
        }
      }

      // 진행률 보고
      const lastSuccess = batchResults.filter((r) => r.type === 'success').pop();
      reportProgress(
        'processing',
        endIdx,
        `${endIdx}/${totalRows}개 처리 (성공: ${stats.successCount}, 실패: ${stats.failureCount})`,
        lastSuccess?.type === 'success' ? lastSuccess.fileName : undefined,
      );

      console.log(
        `[UnifiedGenerator] 배치 ${batchIdx + 1}/${totalBatches} 완료 ` +
          `(성공: ${stats.successCount}, 실패: ${stats.failureCount}, 스킵: ${stats.skippedCount})`,
      );
    }

    // 모두 실패한 경우 에러 발생
    if (stats.successCount === 0 && stats.failureCount > 0) {
      throw new BadRequestException(
        `모든 행 생성에 실패했습니다. (총 ${stats.failureCount}개 실패)`,
      );
    }

    reportProgress('finalizing', totalRows, 'ZIP 파일 생성 중...');

    // 에러가 있으면 에러 로그 파일 추가
    if (stats.errors.length > 0) {
      const errorLog = this.generateErrorLog(stats);
      zip.file('_error_log.txt', errorLog);
      console.log(
        `[UnifiedGenerator] ${stats.errors.length}개 에러 발생, 에러 로그 포함`,
      );
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    reportProgress('complete', totalRows, `완료! (성공: ${stats.successCount}, 실패: ${stats.failureCount})`);
    console.log(
      `[UnifiedGenerator] Excel ZIP 생성 완료 ` +
        `(성공: ${stats.successCount}, 실패: ${stats.failureCount}, 스킵: ${stats.skippedCount})`,
    );

    return {
      buffer: Buffer.from(zipBuffer),
      contentType: 'application/zip',
      fileName: `reports_${Date.now()}.zip`,
    };
  }

  /**
   * CSV 템플릿 처리
   */
  private async generateCsv(
    params: UnifiedGenerateParams,
    dataFormat: string,
  ): Promise<GenerateResult> {
    const mappings = params.mappings as MappingItem[];

    // 템플릿 헤더 추출
    const templateText = params.templateBuffer.toString('utf-8');
    const templateLines = templateText
      .split(/\r?\n/)
      .filter((line) => line.trim());

    if (templateLines.length === 0) {
      throw new BadRequestException('템플릿 CSV가 비어있습니다.');
    }

    const templateColumns = templateLines[0]
      .split(',')
      .map((col) => col.trim().replace(/^"|"$/g, ''));

    // 데이터 추출
    const dataRows = await this.extractData(
      params.dataBuffer,
      dataFormat,
      params.dataSheet,
    );

    // 매핑 맵 생성
    const mappingMap = new Map<string, string>();
    for (const m of mappings) {
      if (m.templateField && m.dataColumn) {
        mappingMap.set(m.templateField, m.dataColumn);
      }
    }

    // CSV 값 이스케이프
    const escapeValue = (val: unknown): string => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // 결과 CSV 생성
    const lines: string[] = [];
    lines.push(templateColumns.map(escapeValue).join(','));

    for (const row of dataRows) {
      const rowData = { ...row };

      // 머지 규칙 적용
      if (params.mappingContext?.fieldRelations) {
        this.applyMergeMappings(rowData, params.mappingContext.fieldRelations);
      }

      const values = templateColumns.map((templateCol) => {
        const dataCol = mappingMap.get(templateCol);
        if (dataCol && rowData[dataCol] !== undefined) {
          return escapeValue(rowData[dataCol]);
        }
        return '';
      });
      lines.push(values.join(','));
    }

    return {
      buffer: Buffer.from(lines.join('\n'), 'utf-8'),
      contentType: 'text/csv; charset=utf-8',
      fileName: `reports_${Date.now()}.csv`,
    };
  }

  /**
   * 파일 형식 감지
   */
  private detectFormat(fileName: string): string {
    const ext = fileName.toLowerCase().split('.').pop();
    switch (ext) {
      case 'hwpx':
        return 'hwpx';
      case 'xlsx':
        return 'xlsx';
      case 'xls':
        return 'xls';
      case 'csv':
        return 'csv';
      case 'json':
        return 'json';
      default:
        return 'unknown';
    }
  }

  /**
   * 데이터 추출 (형식에 따라 분기) - HeaderDetectionAgent 사용
   */
  private async extractData(
    buffer: Buffer,
    format: string,
    sheetName?: string,
  ): Promise<Record<string, unknown>[]> {
    switch (format) {
      case 'xlsx':
      case 'xls': {
        // HeaderDetectionAgent로 스마트 헤더 감지
        const headerResult = await this.headerDetectionAgent.analyze(buffer, sheetName);
        console.log('[UnifiedGenerator] Header analysis:', {
          headerRows: headerResult.headerRows,
          dataStartRow: headerResult.dataStartRow,
          columnsCount: headerResult.columns.length,
        });

        // Excel 워크북 로드
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

        const sheets = workbook.worksheets.map((ws) => ws.name);
        const targetSheet = sheetName || sheets[0];
        const worksheet = workbook.getWorksheet(targetSheet);

        if (!worksheet) {
          throw new Error(`시트 "${targetSheet}"를 찾을 수 없습니다.`);
        }

        // 계층적 컬럼명 사용
        const columns = headerResult.columns;
        const columnMap = new Map(columns.map(c => [c.colIndex, c.name]));

        const data: Record<string, unknown>[] = [];

        // dataStartRow부터 데이터 추출
        worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
          if (rowNum < headerResult.dataStartRow) return;

          const rowData: Record<string, unknown> = {};
          let hasData = false;

          row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            const columnName = columnMap.get(colNumber);
            if (columnName) {
              const value = extractCellValue(cell);
              if (value !== null && value !== undefined && value !== '') {
                hasData = true;
              }
              rowData[columnName] = value;
            }
          });

          if (hasData) {
            data.push(rowData);
          }
        });

        console.log('[UnifiedGenerator] Extracted data rows:', data.length);
        return data;
      }
      case 'csv': {
        const result = extractCsvDataUtil(buffer);
        return result.data;
      }
      case 'json': {
        const result = extractJsonDataUtil(buffer);
        return result.data;
      }
      default:
        throw new BadRequestException('지원하지 않는 데이터 형식입니다.');
    }
  }

  /**
   * 필드 머지 규칙 적용
   */
  private applyMergeMappings(
    row: Record<string, unknown>,
    fieldRelations: FieldRelation[],
  ): void {
    for (const relation of fieldRelations) {
      const values: string[] = [];

      for (const sourceField of relation.sourceFields) {
        let value = row[sourceField];

        // 유사 필드명으로 찾기
        if (value === undefined || value === null || value === '') {
          const normalizedSource = sourceField.toLowerCase().replace(/\s+/g, '');
          for (const [key, val] of Object.entries(row)) {
            const normalizedKey = key.toLowerCase().replace(/\s+/g, '');
            if (
              normalizedKey.includes(normalizedSource) ||
              normalizedSource.includes(normalizedKey)
            ) {
              value = val;
              break;
            }
          }
        }

        if (value !== undefined && value !== null && String(value).trim()) {
          const strValue = String(value).trim();
          if (relation.mergeStrategy === 'first') {
            if (values.length === 0) {
              values.push(strValue);
            }
          } else {
            values.push(strValue);
          }
        }
      }

      if (values.length > 0) {
        const separator = relation.mergeStrategy === 'concat' ? '' : ' / ';
        row[relation.targetField] = values.join(separator);
        console.log(
          `[UnifiedGenerator] Merged "${relation.targetField}" = "${row[relation.targetField]}" from ${relation.sourceFields.join(', ')}`,
        );
      }
    }
  }
}
