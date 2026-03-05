/**
 * Attendance Report DTOs
 * 출결 보고서 API 요청/응답 DTO
 */
import { IsString, IsOptional, Allow } from 'class-validator';

export class GenerateAttendanceReportDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  sheetName?: string;

  @IsOptional()
  @IsString()
  ruleName?: string;

  // Frontend에서 같이 보내는 필드들 — 무시하되 validation 에러 방지
  @IsOptional()
  @Allow()
  dataSheet?: string;

  @IsOptional()
  @Allow()
  mappings?: string;

  @IsOptional()
  @Allow()
  fileNameColumn?: string;

  @IsOptional()
  @Allow()
  mappingContext?: string;
}

export class AttendanceReportProgressDto {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStep: string;
  message?: string;
}

export class AttendanceReportResultDto {
  jobId: string;
  status: 'completed' | 'failed';
  mappedCount?: number;
  studentCount?: number;
  error?: string;
}
