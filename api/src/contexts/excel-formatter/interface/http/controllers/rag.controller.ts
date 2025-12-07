/**
 * RAG Controller
 * 클린 보고서 관리 및 RAG 기반 인사이트 생성 API
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { RagService } from '../../../application/services/rag.service';
import type { CanonicalDataVO } from '../../../domain/value-objects/canonical-data.vo';

// ============================================
// DTOs
// ============================================

interface CreateCleanReportDto {
  companyId: string;
  templateId: string;
  periodStart: string;
  periodEnd: string;
  canonicalData: CanonicalDataVO;
  finalText: string;
  fileUrl?: string;
}

interface GenerateInsightDto {
  companyId: string;
  canonicalData: CanonicalDataVO;
  templateId?: string;
  topK?: number;
}

interface FindSimilarDto {
  companyId: string;
  canonicalData: CanonicalDataVO;
  topK?: number;
}

// ============================================
// Controller
// ============================================

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  /**
   * 클린 보고서 등록 (학습 데이터)
   */
  @Post('clean-reports')
  async createCleanReport(@Body() dto: CreateCleanReportDto) {
    try {
      const report = await this.ragService.saveCleanReport({
        companyId: dto.companyId,
        templateId: dto.templateId,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        canonicalData: dto.canonicalData,
        finalText: dto.finalText,
        fileUrl: dto.fileUrl,
      });

      return {
        success: true,
        data: report,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '클린 보고서 등록 실패',
      };
    }
  }

  /**
   * 클린 보고서 목록 (회사별 또는 템플릿별)
   */
  @Get('clean-reports')
  async getCleanReports(
    @Query('companyId') companyId?: string,
    @Query('templateId') templateId?: string,
  ) {
    try {
      if (!companyId && !templateId) {
        return {
          success: false,
          error: 'companyId 또는 templateId가 필요합니다.',
        };
      }

      let reports;
      if (templateId) {
        reports = await this.ragService.getCleanReportsByTemplate(templateId);
      } else {
        reports = await this.ragService.getCleanReportsByCompany(companyId!);
      }

      return {
        success: true,
        data: reports.map(r => ({
          id: r.id,
          companyId: r.companyId,
          templateId: r.templateId,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          finalText: r.finalText.substring(0, 200) + (r.finalText.length > 200 ? '...' : ''),
          hasEmbedding: !!r.embedding,
          createdAt: r.createdAt,
        })),
        count: reports.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '목록 조회 실패',
      };
    }
  }

  /**
   * 클린 보고서 삭제
   */
  @Delete('clean-reports/:id')
  async deleteCleanReport(@Param('id') id: string) {
    try {
      await this.ragService.deleteCleanReport(id);

      return {
        success: true,
        message: '삭제되었습니다.',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '삭제 실패',
      };
    }
  }

  /**
   * 유사 보고서 검색
   */
  @Post('similar')
  async findSimilarReports(@Body() dto: FindSimilarDto) {
    try {
      const results = await this.ragService.findSimilarReports(
        dto.companyId,
        dto.canonicalData,
        dto.topK || 5,
      );

      return {
        success: true,
        data: results.map(r => ({
          report: {
            id: r.report.id,
            periodStart: r.report.periodStart,
            periodEnd: r.report.periodEnd,
            finalText: r.report.finalText,
            summary: r.report.metricsJson.summary,
          },
          similarity: r.similarity,
          similarityPercent: `${(r.similarity * 100).toFixed(1)}%`,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '유사 검색 실패',
      };
    }
  }

  /**
   * RAG 기반 인사이트 생성
   */
  @Post('insight')
  async generateInsight(@Body() dto: GenerateInsightDto) {
    try {
      const insight = await this.ragService.generateInsight({
        companyId: dto.companyId,
        canonicalData: dto.canonicalData,
        templateId: dto.templateId,
        topK: dto.topK,
      });

      return {
        success: true,
        data: {
          summary: insight.summary,
          keyFindings: insight.keyFindings,
          recommendations: insight.recommendations,
          confidence: insight.confidence,
          confidencePercent: `${(insight.confidence * 100).toFixed(1)}%`,
          similarReportsCount: insight.similarReports.length,
          similarReports: insight.similarReports.slice(0, 3).map(r => ({
            id: r.report.id,
            periodStart: r.report.periodStart,
            periodEnd: r.report.periodEnd,
            similarity: `${(r.similarity * 100).toFixed(1)}%`,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '인사이트 생성 실패',
      };
    }
  }

  /**
   * 헬스체크
   */
  @Get('health')
  async healthCheck() {
    return {
      success: true,
      message: 'RAG service is running',
      features: {
        embedding: 'OpenAI text-embedding-3-small',
        vectorDb: 'pgvector',
        llm: 'Gemini 2.0 Flash',
      },
    };
  }
}
