import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFiles,
  Body,
  Res,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Observable, Subject, merge, interval } from 'rxjs';
import { map, takeUntil, filter } from 'rxjs/operators';
import {
  UnifiedGeneratorService,
  MappingContext,
  ProgressInfo,
} from '../../../application/services/unified-generator.service';

// 작업 상태 저장소 (실제 운영 시 Redis 등 사용 권장)
interface JobState {
  status: 'pending' | 'processing' | 'complete' | 'error';
  progress: ProgressInfo | null;
  result: {
    buffer: Buffer;
    contentType: string;
    fileName: string;
  } | null;
  error: string | null;
  createdAt: Date;
}

const jobs = new Map<string, JobState>();
const progressSubjects = new Map<string, Subject<ProgressInfo>>();

// 오래된 작업 정리 (30분 후 삭제)
const JOB_EXPIRY_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (now - job.createdAt.getTime() > JOB_EXPIRY_MS) {
      jobs.delete(jobId);
      progressSubjects.get(jobId)?.complete();
      progressSubjects.delete(jobId);
    }
  }
}, 60000);

@Controller('generate')
export class UnifiedGenerateController {
  constructor(
    private readonly unifiedGeneratorService: UnifiedGeneratorService,
  ) {}

  /**
   * 통합 보고서 생성 엔드포인트
   * POST /api/generate
   *
   * 템플릿 형식(hwpx, xlsx, csv)에 따라 자동으로 적절한 생성기로 라우팅
   *
   * @param template - 템플릿 파일 (hwpx, xlsx, csv)
   * @param data - 데이터 파일 (xlsx, csv, json)
   * @param sheetName - 템플릿 시트명 (선택)
   * @param dataSheet - 데이터 시트명 (선택)
   * @param mappings - 매핑 정보 JSON
   * @param fileNameColumn - 출력 파일명에 사용할 컬럼 (선택)
   * @param mappingContext - 필드 머지 규칙 등 컨텍스트 (선택)
   */
  @Post()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'template', maxCount: 1 },
      { name: 'data', maxCount: 1 },
    ]),
  )
  async generate(
    @UploadedFiles()
    files: { template?: Express.Multer.File[]; data?: Express.Multer.File[] },
    @Body('sheetName') sheetName: string | undefined,
    @Body('dataSheet') dataSheet: string | undefined,
    @Body('mappings') mappingsRaw: string,
    @Body('fileNameColumn') fileNameColumn: string | undefined,
    @Body('mappingContext') mappingContextRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    console.log('[UnifiedGenerateController] Request received');

    // 파일 검증
    if (!files.template || files.template.length === 0) {
      throw new BadRequestException('템플릿 파일이 필요합니다.');
    }

    if (!files.data || files.data.length === 0) {
      throw new BadRequestException('데이터 파일이 필요합니다.');
    }

    // 매핑 파싱
    let mappings: unknown[];
    try {
      mappings = JSON.parse(mappingsRaw || '[]');
    } catch {
      throw new BadRequestException('mappings 형식이 올바르지 않습니다.');
    }

    if (!Array.isArray(mappings) || mappings.length === 0) {
      throw new BadRequestException('유효한 매핑이 없습니다.');
    }

    // mappingContext 파싱 (선택)
    let mappingContext: MappingContext | undefined;
    if (mappingContextRaw) {
      try {
        mappingContext = JSON.parse(mappingContextRaw);
        console.log('[UnifiedGenerateController] MappingContext provided:', {
          hasDescription: !!mappingContext?.description,
          fieldRelationsCount: mappingContext?.fieldRelations?.length || 0,
          synonymsCount: Object.keys(mappingContext?.synonyms || {}).length,
        });
      } catch {
        console.warn('[UnifiedGenerateController] Failed to parse mappingContext, ignoring');
      }
    }

    const templateFile = files.template[0];
    const dataFile = files.data[0];

    console.log('[UnifiedGenerateController] Template:', templateFile.originalname);
    console.log('[UnifiedGenerateController] Data:', dataFile.originalname);

    try {
      const result = await this.unifiedGeneratorService.generate({
        templateBuffer: templateFile.buffer,
        templateFileName: templateFile.originalname,
        dataBuffer: dataFile.buffer,
        dataFileName: dataFile.originalname,
        sheetName,
        dataSheet,
        mappings: mappings as any,
        fileNameColumn,
        mappingContext,
      });

      console.log('[UnifiedGenerateController] Generation complete:', result.fileName);

      // 응답 전송
      res.setHeader('Content-Type', result.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(result.fileName)}"`,
      );
      res.status(HttpStatus.OK).send(result.buffer);
    } catch (error) {
      console.error('[UnifiedGenerateController] Error:', error);
      throw error;
    }
  }

  /**
   * 템플릿 분석 엔드포인트
   * POST /api/generate/analyze
   *
   * 템플릿 형식에 따라 컬럼/필드 정보 추출
   */
  @Post('analyze')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'template', maxCount: 1 }]),
  )
  async analyzeTemplate(
    @UploadedFiles() files: { template?: Express.Multer.File[] },
    @Body('sheetName') sheetName: string | undefined,
  ): Promise<{
    format: string;
    sheets?: string[];
    columns?: string[];
    cells?: Array<{ row: number; col: number; text: string }>;
  }> {
    if (!files.template || files.template.length === 0) {
      throw new BadRequestException('템플릿 파일이 필요합니다.');
    }

    const templateFile = files.template[0];
    const fileName = templateFile.originalname.toLowerCase();
    const ext = fileName.split('.').pop();

    console.log('[UnifiedGenerateController] Analyze template:', fileName);

    // 형식별 분석 (간단한 구현)
    if (ext === 'hwpx') {
      // HWPX는 기존 HwpxController의 analyze 엔드포인트 사용 권장
      return {
        format: 'hwpx',
        columns: [],
      };
    }

    if (ext === 'xlsx' || ext === 'xls') {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(templateFile.buffer as unknown as ArrayBuffer);

      const sheets = workbook.worksheets.map((ws) => ws.name);
      const targetSheet = sheetName || sheets[0];
      const worksheet = workbook.getWorksheet(targetSheet);

      if (!worksheet) {
        throw new BadRequestException(`시트 "${targetSheet}"를 찾을 수 없습니다.`);
      }

      // 헤더 행 찾기
      const columns: string[] = [];
      for (let rowNum = 1; rowNum <= 5; rowNum++) {
        const row = worksheet.getRow(rowNum);
        let hasData = false;

        row.eachCell({ includeEmpty: false }, (cell) => {
          const value = cell.value;
          if (value !== null && value !== undefined) {
            hasData = true;
            const text =
              typeof value === 'object' && 'richText' in (value as object)
                ? (value as { richText: Array<{ text: string }> }).richText
                    .map((t) => t.text)
                    .join('')
                : String(value);
            const trimmed = text.trim();
            if (trimmed && trimmed !== 'undefined') {
              columns.push(trimmed);
            }
          }
        });

        if (hasData && columns.length > 0) {
          break;
        }
      }

      return {
        format: 'excel',
        sheets,
        columns,
      };
    }

    if (ext === 'csv') {
      const text = templateFile.buffer.toString('utf-8');
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      const columns =
        lines.length > 0
          ? lines[0].split(',').map((col) => col.trim().replace(/^"|"$/g, ''))
          : [];

      return {
        format: 'csv',
        columns,
      };
    }

    return {
      format: 'unknown',
    };
  }

  /**
   * 스트리밍 생성 시작 엔드포인트
   * POST /api/generate/stream
   *
   * 작업을 시작하고 jobId를 반환. 클라이언트는 이 jobId로 진행률을 구독하고 결과를 다운로드
   */
  @Post('stream')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'template', maxCount: 1 },
      { name: 'data', maxCount: 1 },
    ]),
  )
  async generateStream(
    @UploadedFiles()
    files: { template?: Express.Multer.File[]; data?: Express.Multer.File[] },
    @Body('sheetName') sheetName: string | undefined,
    @Body('dataSheet') dataSheet: string | undefined,
    @Body('mappings') mappingsRaw: string,
    @Body('fileNameColumn') fileNameColumn: string | undefined,
    @Body('mappingContext') mappingContextRaw: string | undefined,
  ): Promise<{ jobId: string }> {
    console.log('[UnifiedGenerateController] Stream request received');

    // 파일 검증
    if (!files.template || files.template.length === 0) {
      throw new BadRequestException('템플릿 파일이 필요합니다.');
    }

    if (!files.data || files.data.length === 0) {
      throw new BadRequestException('데이터 파일이 필요합니다.');
    }

    // 매핑 파싱
    let mappings: unknown[];
    try {
      mappings = JSON.parse(mappingsRaw || '[]');
    } catch {
      throw new BadRequestException('mappings 형식이 올바르지 않습니다.');
    }

    if (!Array.isArray(mappings) || mappings.length === 0) {
      throw new BadRequestException('유효한 매핑이 없습니다.');
    }

    // mappingContext 파싱 (선택)
    let mappingContext: MappingContext | undefined;
    if (mappingContextRaw) {
      try {
        mappingContext = JSON.parse(mappingContextRaw);
      } catch {
        console.warn('[UnifiedGenerateController] Failed to parse mappingContext');
      }
    }

    const templateFile = files.template[0];
    const dataFile = files.data[0];

    // 고유 jobId 생성
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 작업 상태 초기화
    jobs.set(jobId, {
      status: 'pending',
      progress: null,
      result: null,
      error: null,
      createdAt: new Date(),
    });

    // 진행률 Subject 생성
    const progressSubject = new Subject<ProgressInfo>();
    progressSubjects.set(jobId, progressSubject);

    // 비동기로 작업 실행 (즉시 응답 반환)
    this.executeJob(jobId, {
      templateBuffer: templateFile.buffer,
      templateFileName: templateFile.originalname,
      dataBuffer: dataFile.buffer,
      dataFileName: dataFile.originalname,
      sheetName,
      dataSheet,
      mappings: mappings as any,
      fileNameColumn,
      mappingContext,
    });

    console.log(`[UnifiedGenerateController] Job started: ${jobId}`);
    return { jobId };
  }

  /**
   * 작업 실행 (내부 메서드)
   */
  private async executeJob(jobId: string, params: any): Promise<void> {
    const job = jobs.get(jobId);
    const progressSubject = progressSubjects.get(jobId);

    if (!job) return;

    try {
      job.status = 'processing';

      const result = await this.unifiedGeneratorService.generate({
        ...params,
        onProgress: (progress: ProgressInfo) => {
          job.progress = progress;
          progressSubject?.next(progress);

          if (progress.phase === 'complete') {
            progressSubject?.complete();
          }
        },
      });

      job.status = 'complete';
      job.result = result;
      console.log(`[UnifiedGenerateController] Job complete: ${jobId}`);
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
      job.progress = {
        phase: 'error',
        current: 0,
        total: 0,
        percentage: 0,
        message: job.error,
      };
      progressSubject?.next(job.progress);
      progressSubject?.error(error);
      console.error(`[UnifiedGenerateController] Job error: ${jobId}`, error);
    }
  }

  /**
   * SSE 진행률 스트림 엔드포인트
   * GET /api/generate/progress/:jobId
   *
   * Server-Sent Events로 실시간 진행률 전송
   * 하트비트를 주기적으로 보내 연결 유지
   */
  @Sse('progress/:jobId')
  streamProgress(@Param('jobId') jobId: string): Observable<MessageEvent> {
    const job = jobs.get(jobId);

    if (!job) {
      throw new NotFoundException(`작업을 찾을 수 없습니다: ${jobId}`);
    }

    const progressSubject = progressSubjects.get(jobId);

    // 이미 완료된 작업이면 즉시 완료 상태 반환
    if (job.status === 'complete' || job.status === 'error') {
      return new Observable<MessageEvent>((subscriber) => {
        subscriber.next({
          data: job.progress || {
            phase: job.status,
            current: 0,
            total: 0,
            percentage: job.status === 'complete' ? 100 : 0,
            message: job.status === 'complete' ? '완료!' : job.error || '오류 발생',
          },
        });
        // 완료 후 바로 종료하지 않고 클라이언트가 연결을 닫을 때까지 대기
        setTimeout(() => subscriber.complete(), 1000);
      });
    }

    // 완료 신호를 위한 Subject
    const done$ = new Subject<void>();

    // 하트비트: 10초마다 ping 전송하여 연결 유지
    const heartbeat$ = interval(10000).pipe(
      takeUntil(done$),
      map(() => ({ data: { type: 'heartbeat', timestamp: Date.now() } })),
    );

    // 진행 중인 작업이면 Subject 구독
    if (progressSubject) {
      return new Observable<MessageEvent>((subscriber) => {
        // 현재 진행 상황이 있으면 먼저 전송
        if (job.progress) {
          subscriber.next({ data: job.progress });
        }

        // 하트비트 시작
        const heartbeatSub = heartbeat$.subscribe((msg) => {
          try {
            subscriber.next(msg);
          } catch {
            // 연결이 끊어진 경우 무시
          }
        });

        const progressSub = progressSubject.asObservable().subscribe({
          next: (progress) => {
            subscriber.next({ data: progress });
            // 완료/에러 시 done 신호
            if (progress.phase === 'complete' || progress.phase === 'error') {
              done$.next();
              done$.complete();
            }
          },
          error: (err) => {
            subscriber.next({
              data: {
                phase: 'error',
                current: 0,
                total: 0,
                percentage: 0,
                message: err?.message || '오류 발생',
              },
            });
            done$.next();
            done$.complete();
            setTimeout(() => subscriber.complete(), 500);
          },
          complete: () => {
            // 완료 시 최종 상태 한 번 더 전송
            if (job.progress) {
              subscriber.next({ data: job.progress });
            }
            done$.next();
            done$.complete();
            setTimeout(() => subscriber.complete(), 500);
          },
        });

        // 연결 해제 시 정리
        return () => {
          heartbeatSub.unsubscribe();
          progressSub.unsubscribe();
          done$.next();
          done$.complete();
        };
      });
    }

    // Subject가 없지만 pending 상태면 폴링 대기 (하트비트 포함)
    if (job.status === 'pending' || job.status === 'processing') {
      return new Observable<MessageEvent>((subscriber) => {
        let lastProgress: ProgressInfo | null = null;

        // 하트비트 시작
        const heartbeatSub = heartbeat$.subscribe((msg) => {
          try {
            subscriber.next(msg);
          } catch {
            // 연결이 끊어진 경우 무시
          }
        });

        const checkInterval = setInterval(() => {
          const currentJob = jobs.get(jobId);
          if (!currentJob) {
            clearInterval(checkInterval);
            done$.next();
            done$.complete();
            subscriber.complete();
            return;
          }

          // 진행률이 변경되었을 때만 전송
          if (currentJob.progress && currentJob.progress !== lastProgress) {
            lastProgress = currentJob.progress;
            subscriber.next({ data: currentJob.progress });
          }

          if (currentJob.status === 'complete' || currentJob.status === 'error') {
            clearInterval(checkInterval);
            if (currentJob.progress) {
              subscriber.next({ data: currentJob.progress });
            }
            done$.next();
            done$.complete();
            setTimeout(() => subscriber.complete(), 500);
          }
        }, 500);

        return () => {
          clearInterval(checkInterval);
          heartbeatSub.unsubscribe();
          done$.next();
          done$.complete();
        };
      });
    }

    throw new NotFoundException(`진행률 스트림을 찾을 수 없습니다: ${jobId}`);
  }

  /**
   * 작업 상태 조회 엔드포인트
   * GET /api/generate/status/:jobId
   */
  @Get('status/:jobId')
  getJobStatus(@Param('jobId') jobId: string): {
    status: string;
    progress: ProgressInfo | null;
    error: string | null;
  } {
    const job = jobs.get(jobId);

    if (!job) {
      throw new NotFoundException(`작업을 찾을 수 없습니다: ${jobId}`);
    }

    return {
      status: job.status,
      progress: job.progress,
      error: job.error,
    };
  }

  /**
   * 결과 다운로드 엔드포인트
   * GET /api/generate/download/:jobId
   */
  @Get('download/:jobId')
  downloadResult(
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ): void {
    const job = jobs.get(jobId);

    if (!job) {
      throw new NotFoundException(`작업을 찾을 수 없습니다: ${jobId}`);
    }

    if (job.status !== 'complete' || !job.result) {
      throw new BadRequestException(`작업이 아직 완료되지 않았습니다. 현재 상태: ${job.status}`);
    }

    res.setHeader('Content-Type', job.result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(job.result.fileName)}"`,
    );
    res.status(HttpStatus.OK).send(job.result.buffer);

    // 다운로드 후 작업 데이터 정리 (선택적)
    // jobs.delete(jobId);
    // progressSubjects.delete(jobId);
  }
}
