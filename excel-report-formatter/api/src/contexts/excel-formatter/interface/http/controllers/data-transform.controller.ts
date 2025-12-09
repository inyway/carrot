/**
 * Data Transform Controller
 * Raw Data → Canonical Data 변환 API
 */

import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DataTransformService } from '../../../application/services/data-transform.service';
import { RawDataInput } from '../../../application/ports/data-transform.port';
import { CANONICAL_METRICS, KNOWN_MAPPINGS } from '../../../domain/value-objects/canonical-data.vo';
import * as ExcelJS from 'exceljs';

// ============================================
// DTOs
// ============================================

interface TransformRequestDto {
  source?: string;
  periodStart: string;
  periodEnd: string;
  headers: string[];
  rows: Record<string, any>[];
}

interface DetectSourceRequestDto {
  headers: string[];
}

// ============================================
// Controller
// ============================================

@Controller('data-transform')
export class DataTransformController {
  constructor(private readonly dataTransformService: DataTransformService) {}

  /**
   * JSON 형태의 raw data를 canonical 형식으로 변환
   */
  @Post('transform')
  async transformData(@Body() dto: TransformRequestDto) {
    try {
      const input: RawDataInput = {
        source: dto.source || 'unknown',
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        headers: dto.headers,
        rows: dto.rows,
      };

      const result = await this.dataTransformService.transform(input);

      return {
        success: result.success,
        data: result.canonicalData,
        unmappedFields: result.unmappedFields,
        warnings: result.warnings,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '변환 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * Excel/CSV 파일을 업로드하여 canonical 형식으로 변환
   */
  @Post('transform-file')
  @UseInterceptors(FileInterceptor('file'))
  async transformFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('periodStart') periodStart: string,
    @Body('periodEnd') periodEnd: string,
    @Body('source') source?: string,
  ) {
    if (!file) {
      throw new BadRequestException('파일이 필요합니다.');
    }

    try {
      // Excel 파일 파싱
      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await workbook.xlsx.load(file.buffer as any);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return {
          success: false,
          error: '워크시트를 찾을 수 없습니다.',
        };
      }

      // 헤더 추출 (첫 번째 행)
      const headers: string[] = [];
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber - 1] = String(cell.value || '');
      });

      // 데이터 행 추출
      const rows: Record<string, any>[] = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // 헤더 스킵

        const rowData: Record<string, any> = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          if (header) {
            rowData[header] = cell.value;
          }
        });

        if (Object.keys(rowData).length > 0) {
          rows.push(rowData);
        }
      });

      // 변환 실행
      const input: RawDataInput = {
        source: source || 'unknown',
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        headers: headers.filter((h) => h),
        rows,
      };

      const result = await this.dataTransformService.transform(input);

      return {
        success: result.success,
        data: result.canonicalData,
        unmappedFields: result.unmappedFields,
        warnings: result.warnings,
        error: result.error,
        metadata: {
          fileName: file.originalname,
          rowCount: rows.length,
          headerCount: headers.filter((h) => h).length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '파일 처리 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 헤더를 기반으로 데이터 소스 자동 감지
   */
  @Post('detect-source')
  async detectSource(@Body() dto: DetectSourceRequestDto) {
    try {
      const result = await this.dataTransformService.detectSource(dto.headers);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '소스 감지 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 사용 가능한 canonical metrics 목록 조회
   */
  @Get('metrics')
  getCanonicalMetrics() {
    return {
      success: true,
      data: Object.values(CANONICAL_METRICS),
    };
  }

  /**
   * 알려진 데이터 소스 매핑 조회
   */
  @Get('known-sources')
  getKnownSources() {
    const sources = Object.entries(KNOWN_MAPPINGS).map(([key, mapping]) => ({
      key,
      name: mapping.sourceName,
      fieldCount: mapping.fieldMappings.length,
      dimensionCount: mapping.dimensionMappings?.length || 0,
      sampleFields: mapping.fieldMappings.slice(0, 5).map((f) => f.sourceField),
    }));

    return {
      success: true,
      data: sources,
    };
  }

  /**
   * 특정 소스의 상세 매핑 정보 조회
   */
  @Get('source-mapping')
  getSourceMapping(@Query('source') source: string) {
    const mapping = KNOWN_MAPPINGS[source];

    if (!mapping) {
      return {
        success: false,
        error: `알 수 없는 소스: ${source}`,
      };
    }

    return {
      success: true,
      data: mapping,
    };
  }
}
