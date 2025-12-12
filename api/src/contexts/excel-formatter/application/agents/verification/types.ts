/**
 * 3-Way Diff Verification Types
 * Template ↔ Excel ↔ Generated 비교를 위한 타입 정의
 */

/** 통합 셀 모델 - 3개 소스의 값을 하나로 */
export interface UnifiedCell {
  hwpxRow: number;
  hwpxCol: number;
  fieldName: string;              // "4분기_담당직무"
  excelColumn: string;            // 원본 Excel 컬럼명

  // 3개 소스의 값
  templateValue: string;          // 템플릿 원본값 ("포워딩" - 샘플 데이터)
  excelValue: string;             // Excel 원본값 ("MD" 또는 빈값)
  generatedValue: string;         // 생성된 HWPX값

  // 비교 결과
  status: CellStatus;
}

export type CellStatus =
  | 'match'           // Excel값 = Generated값 (정상)
  | 'mismatch'        // Excel값 ≠ Generated값
  | 'template_leak'   // Excel 빈값인데 Template값이 Generated에 남음
  | 'missing'         // Excel값 있는데 Generated 비어있음
  | 'empty_ok';       // 둘 다 비어있음 (정상)

/** 검증 이슈 */
export interface VerificationIssue {
  personName: string;             // 대상자 이름
  personIndex: number;            // 행 번호
  cell: UnifiedCell;              // 문제가 된 셀
  severity: 'critical' | 'warning' | 'info';
  message: string;                // "템플릿 값 '포워딩'이 그대로 남아있습니다"
  agentName: string;              // 발견한 Agent 이름
}

/** 단일 Agent 검증 결과 */
export interface VerificationAgentResult {
  agentName: string;
  description: string;
  status: 'pass' | 'warning' | 'fail';
  issueCount: number;
  issues: VerificationIssue[];
  executionTimeMs: number;
}

/** 전체 검증 결과 */
export interface VerificationResult {
  status: 'pass' | 'warning' | 'fail';

  // 샘플링 정보
  sampledCount: number;
  totalCount: number;
  sampledNames: string[];

  // 정확도
  accuracy: number;               // 0-100%

  // Agent별 결과
  agentResults: VerificationAgentResult[];

  // 전체 이슈 (중복 제거)
  allIssues: VerificationIssue[];

  // AI 요약
  aiSummary: string;

  // 실행 시간
  totalExecutionTimeMs: number;
}

/** 검증 입력 */
export interface VerificationInput {
  templateBuffer: Buffer;
  excelBuffer: Buffer;
  generatedZipBuffer: Buffer;
  mappings: Array<{
    excelColumn: string;
    hwpxRow: number;
    hwpxCol: number;
  }>;
  sheetName?: string;

  options?: VerificationOptions;
}

/** 검증 옵션 */
export interface VerificationOptions {
  sampleStrategy: 'all' | 'random' | 'first_n';
  sampleSize?: number;            // random/first_n일 때 사용
  enabledAgents?: string[];       // 특정 Agent만 실행
  skipAiSummary?: boolean;        // AI 요약 생성 스킵
}

/** 파싱된 HWPX 데이터 */
export interface ParsedHwpxData {
  fileName: string;
  personName: string;
  cells: Map<string, string>;     // "row-col" -> value
}

/** 파싱된 Excel 행 */
export interface ParsedExcelRow {
  rowIndex: number;
  personName: string;
  data: Record<string, string>;   // columnName -> value
}

/** 검증 그래프 상태 */
export interface VerificationGraphState {
  // 입력
  input: VerificationInput;

  // 파싱된 데이터
  templateCells: Map<string, string>;
  excelRows: ParsedExcelRow[];
  generatedFiles: ParsedHwpxData[];

  // 샘플링된 데이터
  sampledIndices: number[];
  unifiedCells: Map<number, UnifiedCell[]>;  // personIndex -> cells

  // 결과
  agentResults: VerificationAgentResult[];
  finalResult?: VerificationResult;
}
