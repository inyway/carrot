import type { TemplateStructureVO } from '../../domain/value-objects';

/**
 * 엑셀 파서 Port (의존성 역전)
 */
export interface ExcelParserPort {
  /**
   * 엑셀 파일을 파싱하여 템플릿 구조를 추출
   */
  parseTemplate(buffer: Buffer, fileName: string): Promise<TemplateStructureVO>;

  /**
   * 특정 시트의 데이터만 추출
   */
  extractSheetData(
    buffer: Buffer,
    sheetName: string,
  ): Promise<Array<Record<string, unknown>>>;

  /**
   * 엑셀 파일의 시트 목록 조회
   */
  getSheetNames(buffer: Buffer): Promise<string[]>;
}

export const EXCEL_PARSER_PORT = Symbol('EXCEL_PARSER_PORT');
