/**
 * Report Generator Port
 * Canonical Data + Template → Excel Report 생성을 위한 포트 인터페이스
 */

import { CanonicalDataVO } from '../../domain/value-objects/canonical-data.vo';
import { TemplateStructureVO } from '../../domain/value-objects/template-structure.vo';

export interface GenerateReportInput {
  templateId: string;
  templateStructure: TemplateStructureVO;
  canonicalData: CanonicalDataVO;
  options?: {
    includeCharts?: boolean;
    sheetName?: string;
    dateFormat?: string;
    currencyFormat?: string;
  };
}

export interface GenerateReportResult {
  success: boolean;
  buffer?: Buffer;             // 생성된 엑셀 파일 버퍼
  fileName?: string;
  error?: string;
  metadata?: {
    rowsPopulated: number;
    blocksProcessed: number;
    generatedAt: Date;
  };
}

export interface BlockFillResult {
  blockId: string;
  success: boolean;
  rowsFilled: number;
  error?: string;
}

export const REPORT_GENERATOR_PORT = Symbol('REPORT_GENERATOR_PORT');

export interface ReportGeneratorPort {
  /**
   * Canonical Data를 사용하여 템플릿 기반 보고서 생성
   */
  generateReport(input: GenerateReportInput): Promise<GenerateReportResult>;

  /**
   * 특정 블록만 데이터로 채우기
   */
  fillBlock(
    workbook: any,
    blockId: string,
    data: CanonicalDataVO,
  ): Promise<BlockFillResult>;

  /**
   * 미리보기용 HTML 테이블 생성
   */
  generatePreviewHtml(
    templateStructure: TemplateStructureVO,
    canonicalData: CanonicalDataVO,
  ): Promise<string>;
}
