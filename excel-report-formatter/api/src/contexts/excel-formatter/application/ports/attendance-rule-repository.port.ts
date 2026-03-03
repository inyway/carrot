export interface AttendanceRuleEntity {
  id: string;
  companyId: string;
  name: string;
  attendedSymbols: string[];
  excusedSymbols: string[];
  absentSymbols: string[];
  includeExcusedInAttendance: boolean;
  totalSessionsField: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAttendanceRuleInput {
  companyId: string;
  name?: string;
  attendedSymbols?: string[];
  excusedSymbols?: string[];
  absentSymbols?: string[];
  includeExcusedInAttendance?: boolean;
  totalSessionsField?: string | null;
}

export interface UpdateAttendanceRuleInput {
  name?: string;
  attendedSymbols?: string[];
  excusedSymbols?: string[];
  absentSymbols?: string[];
  includeExcusedInAttendance?: boolean;
  totalSessionsField?: string | null;
}

export interface AttendanceRuleRepositoryPort {
  findByCompanyId(companyId: string): Promise<AttendanceRuleEntity[]>;
  findById(id: string): Promise<AttendanceRuleEntity | null>;
  findByCompanyAndName(companyId: string, name: string): Promise<AttendanceRuleEntity | null>;
  create(input: CreateAttendanceRuleInput): Promise<AttendanceRuleEntity>;
  update(id: string, input: UpdateAttendanceRuleInput): Promise<AttendanceRuleEntity>;
  delete(id: string): Promise<void>;
}

export const ATTENDANCE_RULE_REPOSITORY_PORT = Symbol('ATTENDANCE_RULE_REPOSITORY_PORT');
