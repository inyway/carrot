/**
 * Attendance Report DTOs
 * 출결 보고서 API 요청/응답 DTO
 */
import { IsString, IsOptional } from 'class-validator';

export class GenerateAttendanceReportDto {
  @IsString()
  companyId: string;

  @IsOptional()
  @IsString()
  sheetName?: string;

  @IsOptional()
  @IsString()
  ruleName?: string;
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
