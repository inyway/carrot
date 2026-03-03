/**
 * Attendance Report Pipeline Types
 * 출결 보고서 파이프라인 타입 정의
 */

/** 출결 규칙 (DB에서 로드) */
export interface AttendanceRule {
  id: string;
  companyId: string;
  name: string;
  attendedSymbols: string[];    // e.g. ['Y', 'L']
  excusedSymbols: string[];     // e.g. ['BZ', 'VA']
  absentSymbols: string[];      // e.g. ['N', 'C']
  includeExcusedInAttendance: boolean;
  totalSessionsField: string | null;
}

/** 매핑 결과 */
export interface AttendanceMappingResult {
  templateField: string;
  dataColumn: string;
  confidence: number;
  reason: string;
  isMetadata?: boolean;
  metadataValue?: string;
}

/** 학생 행 (변환 후) */
export interface StudentRow {
  /** 학생 식별 정보 (이름, 번호 등) */
  identity: Record<string, string>;
  /** 날짜별 출결 기호 { '2024-09-29': 'Y', '2024-10-01': 'N' } */
  attendance: Record<string, string>;
  /** 메타데이터 (강사, 클래스명, 법인 등) */
  metadata: Record<string, string>;
  /** 원본 요약 컬럼 (출석률, 결석 등) - 참고용 */
  rawSummary: Record<string, string>;
}

/** 계산된 출결 통계 */
export interface CalculatedAttendance {
  /** 출석 횟수 (Y + L, optionally + BZ + VA) */
  attended: number;
  /** 결석 횟수 (N + C) */
  absent: number;
  /** 공결 횟수 (BZ + VA) */
  excused: number;
  /** 미참석 = 총회차 - 출석 */
  notAttended: number;
  /** 출석률 (출석/총회차 * 100) */
  attendanceRate: number;
  /** 실출석률 (순수 출석/총회차 * 100, 공결 제외) */
  realAttendanceRate: number;
  /** 총 회차 */
  totalSessions: number;
}

/** 엑셀 수식 문자열 모음 */
export interface AttendanceFormulas {
  attended: string;       // =COUNTIF(D5:AQ5,"Y")+COUNTIF(D5:AQ5,"L")
  absent: string;         // =COUNTIF(D5:AQ5,"N")+COUNTIF(D5:AQ5,"C")
  excused: string;        // =COUNTIF(D5:AQ5,"BZ")+COUNTIF(D5:AQ5,"VA")
  notAttended: string;    // =총회차-출석
  attendanceRate: string; // =출석/총회차*100
  realAttendanceRate: string;
  totalSessions: string;
}

/** 렌더링할 학생 데이터 (계산 + 수식 포함) */
export interface StudentRenderData {
  identity: Record<string, string>;
  attendance: Record<string, string>;
  metadata: Record<string, string>;
  calculated: CalculatedAttendance;
  formulas: AttendanceFormulas;
}

/** LangGraph 파이프라인 상태 */
export interface AttendanceGraphState {
  // 입력
  rawDataBuffer: Buffer;
  templateBuffer: Buffer;
  companyId: string;
  sheetName?: string;

  // Parse 노드 출력
  templateColumns: string[];
  dataColumns: string[];
  templateSampleData: Record<string, unknown>[];
  dataSampleData: Record<string, unknown>[];
  dataMetadata: Record<string, string>;

  // Map 노드 출력
  mappings: AttendanceMappingResult[];
  unmappedColumns: string[];

  // Transform 노드 출력
  students: StudentRow[];

  // Calculate 노드 출력
  rule: AttendanceRule | null;
  renderedStudents: StudentRenderData[];

  // Render 노드 출력
  outputBuffer: Buffer | null;

  // 진행률
  progress: number;
  currentStep: string;
  errors: string[];
}

/** 파이프라인 진행률 정보 */
export interface ProgressInfo {
  step: string;
  progress: number;     // 0-100
  message: string;
  timestamp: Date;
}

/** 파이프라인 작업 결과 */
export interface AttendanceJobResult {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  outputUrl?: string;
  outputBuffer?: Buffer;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}
