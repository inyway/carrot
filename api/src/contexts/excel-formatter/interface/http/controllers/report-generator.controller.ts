/**
 * Report Generator Controller
 * 보고서 생성 및 다운로드 API
 */

import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  Res,
  Header,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportGeneratorService } from '../../../application/services/report-generator.service';
import { DataTransformService } from '../../../application/services/data-transform.service';
import { TemplateService } from '../../../application/services/template.service';
import { RawDataInput } from '../../../application/ports/data-transform.port';
import {
  TemplateStructureVO,
  TemplateSheetVO,
  BlockType,
  TemplateStructureFactory,
} from '../../../domain/value-objects/template-structure.vo';

// ============================================
// DTOs
// ============================================

interface GenerateReportDto {
  templateId?: string;
  source?: string;
  periodStart: string;
  periodEnd: string;
  headers: string[];
  rows: Record<string, any>[];
  options?: {
    includeCharts?: boolean;
    sheetName?: string;
  };
}

interface PreviewReportDto {
  source?: string;
  periodStart: string;
  periodEnd: string;
  headers: string[];
  rows: Record<string, any>[];
}

// ============================================
// Controller
// ============================================

@Controller('report')
export class ReportGeneratorController {
  constructor(
    private readonly reportGeneratorService: ReportGeneratorService,
    private readonly dataTransformService: DataTransformService,
    private readonly templateService: TemplateService,
  ) {}

  /**
   * Raw data를 받아서 보고서 생성 후 다운로드
   */
  @Post('generate')
  async generateReport(
    @Body() dto: GenerateReportDto,
    @Res() res: Response,
  ) {
    try {
      // 1. Raw data → Canonical data 변환
      const input: RawDataInput = {
        source: dto.source || 'unknown',
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        headers: dto.headers,
        rows: dto.rows,
      };

      const transformResult = await this.dataTransformService.transform(input);

      if (!transformResult.success || !transformResult.canonicalData) {
        return res.status(400).json({
          success: false,
          error: transformResult.error || '데이터 변환에 실패했습니다.',
        });
      }

      // 2. 템플릿 구조 생성 (기본 템플릿 또는 지정된 템플릿)
      let templateStructure: TemplateStructureVO;

      if (dto.templateId) {
        const template = await this.templateService.getTemplate(dto.templateId);
        if (template && template.structure) {
          templateStructure = template.structure;
        } else {
          templateStructure = this.createDefaultTemplate(transformResult.canonicalData);
        }
      } else {
        templateStructure = this.createDefaultTemplate(transformResult.canonicalData);
      }

      // 3. 보고서 생성
      const reportResult = await this.reportGeneratorService.generateReport({
        templateId: dto.templateId || 'default',
        templateStructure,
        canonicalData: transformResult.canonicalData,
        options: dto.options,
      });

      if (!reportResult.success || !reportResult.buffer) {
        return res.status(500).json({
          success: false,
          error: reportResult.error || '보고서 생성에 실패했습니다.',
        });
      }

      // 4. 파일 다운로드 응답
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(reportResult.fileName || 'report.xlsx')}"`,
      );
      res.setHeader('Content-Length', reportResult.buffer.length);

      return res.send(reportResult.buffer);
    } catch (error) {
      console.error('Report generation error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '보고서 생성 중 오류가 발생했습니다.',
      });
    }
  }

  /**
   * JSON 형태로 보고서 데이터 미리보기
   */
  @Post('preview')
  async previewReport(@Body() dto: PreviewReportDto) {
    try {
      // Raw data → Canonical data 변환
      const input: RawDataInput = {
        source: dto.source || 'unknown',
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        headers: dto.headers,
        rows: dto.rows,
      };

      const transformResult = await this.dataTransformService.transform(input);

      if (!transformResult.success || !transformResult.canonicalData) {
        return {
          success: false,
          error: transformResult.error || '데이터 변환에 실패했습니다.',
        };
      }

      return {
        success: true,
        data: {
          canonicalData: transformResult.canonicalData,
          warnings: transformResult.warnings,
          unmappedFields: transformResult.unmappedFields,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '미리보기 생성 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * HTML 형태로 보고서 미리보기 생성
   */
  @Post('preview-html')
  @Header('Content-Type', 'text/html')
  async previewReportHtml(@Body() dto: PreviewReportDto, @Res() res: Response) {
    try {
      // Raw data → Canonical data 변환
      const input: RawDataInput = {
        source: dto.source || 'unknown',
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        headers: dto.headers,
        rows: dto.rows,
      };

      const transformResult = await this.dataTransformService.transform(input);

      if (!transformResult.success || !transformResult.canonicalData) {
        return res.send(`<html><body><h1>오류</h1><p>${transformResult.error}</p></body></html>`);
      }

      const templateStructure = this.createDefaultTemplate(transformResult.canonicalData);
      const html = await this.reportGeneratorService.generatePreviewHtml(
        templateStructure,
        transformResult.canonicalData,
      );

      return res.send(html);
    } catch (error) {
      return res.send(
        `<html><body><h1>오류</h1><p>${error instanceof Error ? error.message : '미리보기 생성 실패'}</p></body></html>`,
      );
    }
  }

  /**
   * 지원되는 데이터 소스 목록
   */
  @Get('supported-sources')
  getSupportedSources() {
    return {
      success: true,
      data: [
        { key: 'google_ads', name: 'Google Ads', description: 'Google 광고 데이터' },
        { key: 'meta_ads', name: 'Meta Ads', description: 'Facebook/Instagram 광고 데이터' },
        { key: 'ga4', name: 'Google Analytics 4', description: 'GA4 분석 데이터' },
        { key: 'unknown', name: '기타', description: 'AI 자동 매핑' },
      ],
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * 기본 템플릿 구조 생성
   */
  private createDefaultTemplate(canonicalData: any): TemplateStructureVO {
    const headerBlock = TemplateStructureFactory.createBlock(
      'header_block',
      BlockType.HEADER,
      'A1:D2',
      1, 2, 1, 4,
      [],
    );

    const summaryBlock = TemplateStructureFactory.createBlock(
      'summary_block',
      BlockType.METRIC_BLOCK,
      'A4:B10',
      4, 10, 1, 2,
      [],
      { metrics: canonicalData.metrics },
    );

    const tableBlock = TemplateStructureFactory.createBlock(
      'data_table',
      BlockType.TABLE,
      'A12:Z100',
      12, 100, 1, 26,
      [],
      { headerRow: 12 },
    );

    const sheet: TemplateSheetVO = {
      name: '보고서',
      index: 0,
      blocks: [headerBlock, summaryBlock, tableBlock],
      rowCount: 100,
      colCount: 26,
    };

    return TemplateStructureFactory.create('default_report.xlsx', [sheet]);
  }
}
