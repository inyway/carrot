/**
 * 템플릿 구조 Value Object
 * 엑셀 파일에서 추출한 논리적 템플릿 구조를 표현
 */

export enum BlockType {
  METRIC_BLOCK = 'METRIC_BLOCK',   // 숫자/지표 블록
  TABLE = 'TABLE',                   // 표/리스트 블록
  TEXT_AI = 'TEXT_AI',               // LLM이 생성하는 텍스트 블록
  TEXT_STATIC = 'TEXT_STATIC',       // 고정 텍스트
  CHART = 'CHART',                   // 차트 영역
  HEADER = 'HEADER',                 // 헤더 영역
}

export interface CellInfo {
  address: string;      // 예: "A1", "B3"
  value: string | number | boolean | Date | null;
  formula?: string;
  style?: CellStyle;
}

export interface CellStyle {
  font?: {
    bold?: boolean;
    size?: number;
    color?: string;
  };
  fill?: {
    type?: string;
    color?: string;
  };
  border?: boolean;
  alignment?: {
    horizontal?: string;
    vertical?: string;
  };
}

export interface TemplateBlockVO {
  blockId: string;           // 블록 식별자 (예: "kpi_block_1")
  type: BlockType;           // 블록 타입
  range: string;             // 셀 범위 (예: "B3:D8")
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  cells: CellInfo[];         // 블록 내 셀 정보
  config?: {
    headerRow?: number;      // 테이블의 헤더 행
    metrics?: string[];      // 메트릭 블록의 지표 키들
    placeholder?: string;    // TEXT_AI의 placeholder
  };
}

export interface TemplateSheetVO {
  name: string;              // 시트 이름
  index: number;             // 시트 순서
  blocks: TemplateBlockVO[]; // 감지된 블록들
  rowCount: number;
  colCount: number;
}

export interface TemplateStructureVO {
  fileName: string;
  sheets: TemplateSheetVO[];
  extractedAt: Date;
  version: string;
}

/**
 * 템플릿 구조 생성 팩토리
 */
export class TemplateStructureFactory {
  static create(
    fileName: string,
    sheets: TemplateSheetVO[],
  ): TemplateStructureVO {
    return {
      fileName,
      sheets,
      extractedAt: new Date(),
      version: '1.0.0',
    };
  }

  static createBlock(
    blockId: string,
    type: BlockType,
    range: string,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number,
    cells: CellInfo[],
    config?: TemplateBlockVO['config'],
  ): TemplateBlockVO {
    return {
      blockId,
      type,
      range,
      startRow,
      endRow,
      startCol,
      endCol,
      cells,
      config,
    };
  }
}
