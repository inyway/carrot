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

// ============================================
// Phase 1 확장: 고급 구조 분석 타입들
// ============================================

export enum ColumnType {
  STRING = 'string',
  NUMBER = 'number',
  DATE = 'date',
  PERCENTAGE = 'percentage',
  CURRENCY = 'currency',
  FORMULA = 'formula',
  UNKNOWN = 'unknown',
}

export enum TemplateFormatType {
  FLAT = 'flat',                     // 단일 헤더 행 (예: 네이버)
  MULTI_HEADER = 'multi_header',     // 다중 헤더 행 + merged cells (예: 쿠팡)
  MULTI_SHEET = 'multi_sheet',       // 다중 시트 + 다중 헤더 (예: KT&G)
}

export enum FormulaType {
  STANDARD = 'standard',
  SHARED = 'shared',
  ARRAY = 'array',
}

export interface MergedCellInfo {
  range: string;         // 예: "A1:D1"
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  value: string | number | boolean | Date | null;
}

export interface FormulaInfo {
  address: string;       // 셀 주소
  formula: string;       // 수식 내용
  formulaType: FormulaType;
  sharedRef?: string;    // shared formula의 범위
}

export interface ColumnDefinition {
  index: number;         // 1-based 컬럼 인덱스
  letter: string;        // 컬럼 문자 (예: "A", "AB")
  headerTexts: string[]; // 다중 헤더 행의 텍스트들 (위에서 아래로)
  fullName: string;      // 조합된 전체 컬럼명
  inferredType: ColumnType;
  formula?: string;      // 대표 수식 (있는 경우)
  isFixed: boolean;      // 모든 행이 동일 값인지
  sampleValues: (string | number | boolean | null)[];
  numFmt?: string;       // 셀 서식 (예: "0.00%", "#,##0")
}

export interface HeaderStructure {
  headerRows: number[];          // 헤더로 감지된 행 번호들
  dataStartRow: number;          // 데이터 시작 행
  columns: ColumnDefinition[];   // 컬럼 정의들
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
  header?: HeaderStructure;        // Phase 1: 헤더 구조
  mergedCells?: MergedCellInfo[];  // Phase 1: merged cell 정보
  formulas?: FormulaInfo[];        // Phase 1: 수식 정보
  titleRows?: number[];            // Phase 1: 타이틀 행 번호들
}

export interface TemplateStructureVO {
  fileName: string;
  sheets: TemplateSheetVO[];
  extractedAt: Date;
  version: string;
  formatType?: TemplateFormatType;   // Phase 1: 포맷 분류
}

/**
 * 템플릿 구조 생성 팩토리
 */
export class TemplateStructureFactory {
  static create(
    fileName: string,
    sheets: TemplateSheetVO[],
    formatType?: TemplateFormatType,
  ): TemplateStructureVO {
    return {
      fileName,
      sheets,
      extractedAt: new Date(),
      version: '2.0.0',
      formatType,
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
