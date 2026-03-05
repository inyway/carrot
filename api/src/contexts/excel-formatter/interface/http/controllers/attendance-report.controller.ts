/**
 * AttendanceReportController
 * 출결 보고서 생성 API 엔드포인트
 */
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Subject } from 'rxjs';
import { GenerateAttendanceReportDto } from '../dto/attendance-report.dto';
import { AttendanceReportGraphService } from '../../../application/services/attendance-report/attendance-report-graph.service';
import type { ProgressInfo, AttendanceJobResult } from '../../../application/services/attendance-report/types';

// In-memory job store (can be replaced with Redis later)
const jobStore = new Map<string, AttendanceJobResult>();
const progressSubjects = new Map<string, Subject<ProgressInfo>>();

@Controller('attendance')
export class AttendanceReportController {
  constructor(
    private readonly graphService: AttendanceReportGraphService,
  ) {}

  /**
   * POST /api/attendance/generate
   * 출결 보고서 생성 (multipart: template + data + companyId)
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'template', maxCount: 1 },
      { name: 'data', maxCount: 1 },
    ]),
  )
  async generate(
    @UploadedFiles()
    files: {
      template?: Express.Multer.File[];
      data?: Express.Multer.File[];
    },
    @Body() dto: GenerateAttendanceReportDto,
    @Res() res: Response,
  ) {
    if (!files.template?.[0] || !files.data?.[0]) {
      throw new BadRequestException('template과 data 파일이 모두 필요합니다.');
    }

    const templateBuffer = files.template[0].buffer;
    const dataBuffer = files.data[0].buffer;
    const companyId = dto.companyId || 'default';

    // Parse precomputed mappings from frontend (JSON string)
    let precomputedMappings: Array<{ templateField: string; dataColumn: string }> = [];
    if (dto.mappings) {
      try {
        const parsed = JSON.parse(dto.mappings);
        if (Array.isArray(parsed)) {
          precomputedMappings = parsed.filter(
            (m: any) => m.templateField && m.dataColumn,
          );
        }
      } catch {
        console.warn('[AttendanceReport] Failed to parse mappings, will use AI mapping');
      }
    }

    console.log('[AttendanceReport] Generating report synchronously...',
      { companyId, sheetName: dto.sheetName, dataSheet: dto.dataSheet, precomputedMappings: precomputedMappings.length });

    try {
      const result = await this.graphService.execute(
        templateBuffer,
        dataBuffer,
        companyId,
        dto.sheetName,
        undefined, // onProgress
        {
          dataSheetName: dto.dataSheet,
          precomputedMappings,
        },
      );

      console.log(`[AttendanceReport] Done: ${result.studentCount} students, ${result.mappedCount} mappings`);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${Date.now()}.xlsx"`);
      res.status(HttpStatus.OK).send(result.outputBuffer);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[AttendanceReport] Pipeline error:', msg);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: `출결 보고서 생성 실패: ${msg}`,
      });
    }
  }

  /**
   * GET /api/attendance/progress/:jobId
   * SSE 진행률 스트리밍
   */
  @Get('progress/:jobId')
  async progress(@Param('jobId') jobId: string, @Res() res: Response) {
    const job = jobStore.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }

    // SSE 헤더 설정
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 현재 상태 전송
    res.write(`data: ${JSON.stringify({ step: job.status, progress: job.progress, message: '연결됨' })}\n\n`);

    // 이미 완료된 경우
    if (job.status === 'completed' || job.status === 'failed') {
      res.write(`data: ${JSON.stringify({ step: job.status, progress: 100, message: job.status === 'completed' ? '완료' : job.error })}\n\n`);
      res.end();
      return;
    }

    // 진행률 구독
    const subject = progressSubjects.get(jobId);
    if (subject) {
      const subscription = subject.subscribe({
        next: (info) => {
          res.write(`data: ${JSON.stringify(info)}\n\n`);
        },
        complete: () => {
          const finalJob = jobStore.get(jobId);
          res.write(`data: ${JSON.stringify({ step: finalJob?.status || 'completed', progress: 100, message: '완료' })}\n\n`);
          res.end();
        },
        error: (err) => {
          res.write(`data: ${JSON.stringify({ step: 'error', progress: -1, message: String(err) })}\n\n`);
          res.end();
        },
      });

      // 클라이언트 연결 종료 시 구독 해제
      res.on('close', () => {
        subscription.unsubscribe();
      });
    } else {
      res.end();
    }
  }

  /**
   * GET /api/attendance/download/:jobId
   * 결과 다운로드
   */
  @Get('download/:jobId')
  async download(@Param('jobId') jobId: string, @Res() res: Response) {
    const job = jobStore.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job not found: ${jobId}`);
    }

    if (job.status !== 'completed' || !job.outputBuffer) {
      throw new BadRequestException(
        job.status === 'failed'
          ? `생성 실패: ${job.error}`
          : `아직 생성 중입니다. 현재 상태: ${job.status}`,
      );
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${jobId}.xlsx"`);
    res.status(HttpStatus.OK).send(job.outputBuffer);

    // 다운로드 후 정리 (5분 후)
    setTimeout(() => {
      jobStore.delete(jobId);
      progressSubjects.delete(jobId);
    }, 5 * 60 * 1000);
  }

  private async executePipeline(
    jobId: string,
    templateBuffer: Buffer,
    dataBuffer: Buffer,
    dto: GenerateAttendanceReportDto,
    progressSubject: Subject<ProgressInfo>,
  ): Promise<void> {
    const job = jobStore.get(jobId)!;
    job.status = 'processing';

    const onProgress = (info: ProgressInfo) => {
      job.progress = info.progress;
      progressSubject.next(info);
    };

    const result = await this.graphService.execute(
      templateBuffer,
      dataBuffer,
      dto.companyId || 'default',
      dto.sheetName,
      onProgress,
    );

    job.status = 'completed';
    job.progress = 100;
    job.outputBuffer = result.outputBuffer;
    job.completedAt = new Date();

    progressSubject.next({
      step: 'completed',
      progress: 100,
      message: `보고서 생성 완료 (학생 ${result.studentCount}명, 매핑 ${result.mappedCount}개)`,
      timestamp: new Date(),
    });
    progressSubject.complete();
  }
}
