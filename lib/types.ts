// 템플릿 분석 결과
export interface AnalysisResult {
  sheetName: string;
  headers: HeaderInfo[];
  dataStartRow: number;
  formulas: FormulaInfo[];
}

export interface HeaderInfo {
  column: number;
  letter: string;
  name: string;
}

export interface FormulaInfo {
  cell: string;
  formula: string;
}

// 컬럼 매핑 설정
export interface ColumnMapping {
  column: string;
  sourceField: string;
  type: 'data' | 'formula';
  formula?: string;
}

// 템플릿 설정
export interface TemplateConfig {
  templateId: string;
  name: string;
  fileName: string;
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  columns: ColumnMapping[];
  preserveRows: number[];
  createdAt: string;
}

// 템플릿 목록 아이템
export interface TemplateListItem {
  id: string;
  name: string;
  fileName: string;
  createdAt: string;
}

// API 응답 타입
export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

// 분석 요청 결과
export interface AnalyzeTemplateResponse {
  sheetName: string;
  headers: HeaderInfo[];
  dataStartRow: number;
  formulas: FormulaInfo[];
}

// 원본 데이터 행
export type DataRow = Record<string, string | number | boolean | null>;

// ============================================
// Mapping Profile Types
// ============================================

export type TransformType = 'none' | 'multiply_100' | 'divide_100' | 'parse_date' | 'parse_number';

export interface FieldMapping {
  sourceField: string;
  canonicalKey: string;
  transform?: TransformType;
}

export interface MappingProfile {
  id: string;
  templateId: string;
  name: string;
  sourceType: string;
  headerHash: string | null;
  headerCount: number;
  sampleHeaders: string[] | null;
  mappings: FieldMapping[];
  usageCount: number;
  lastUsedAt: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FindMatchingProfileResult {
  profile: MappingProfile | null;
  matchType: 'exact' | 'source_type' | 'recent' | 'none';
  confidence: number;
  hasMatch: boolean;
}

