/**
 * RAG Service
 * 클린 보고서 기반 유사 검색 및 인사이트 생성
 */

import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingPort } from '../ports/embedding.port';
import { EMBEDDING_PORT } from '../ports/embedding.port';
import type { CleanReportRepositoryPort, CleanReportEntity, SimilarReportResult } from '../ports/clean-report-repository.port';
import { CLEAN_REPORT_REPOSITORY_PORT } from '../ports/clean-report-repository.port';
import type { CanonicalDataVO } from '../../domain/value-objects/canonical-data.vo';
import { CANONICAL_METRICS } from '../../domain/value-objects/canonical-data.vo';

export interface SaveCleanReportInput {
  companyId: string;
  templateId: string;
  periodStart: Date;
  periodEnd: Date;
  canonicalData: CanonicalDataVO;
  finalText: string;
  fileUrl?: string;
}

export interface GenerateInsightInput {
  companyId: string;
  canonicalData: CanonicalDataVO;
  templateId?: string;
  topK?: number;
}

export interface GeneratedInsight {
  summary: string;
  keyFindings: string[];
  recommendations: string[];
  similarReports: SimilarReportResult[];
  confidence: number;
}

@Injectable()
export class RagService {
  private readonly geminiApiKey: string;

  constructor(
    @Inject(EMBEDDING_PORT)
    private readonly embeddingService: EmbeddingPort,
    @Inject(CLEAN_REPORT_REPOSITORY_PORT)
    private readonly cleanReportRepository: CleanReportRepositoryPort,
    private readonly configService: ConfigService,
  ) {
    this.geminiApiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
  }

  /**
   * 클린 보고서 저장 (임베딩 자동 생성)
   */
  async saveCleanReport(input: SaveCleanReportInput): Promise<CleanReportEntity> {
    // 텍스트에서 임베딩 생성
    const textToEmbed = this.buildEmbeddingText(input.canonicalData, input.finalText);
    const embeddingResult = await this.embeddingService.generateEmbedding(textToEmbed);

    return this.cleanReportRepository.create({
      companyId: input.companyId,
      templateId: input.templateId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      metricsJson: input.canonicalData,
      finalText: input.finalText,
      embedding: embeddingResult.embedding,
      fileUrl: input.fileUrl,
    });
  }

  /**
   * 유사 보고서 검색
   */
  async findSimilarReports(
    companyId: string,
    canonicalData: CanonicalDataVO,
    topK = 5,
  ): Promise<SimilarReportResult[]> {
    const textToEmbed = this.buildEmbeddingText(canonicalData);
    const embeddingResult = await this.embeddingService.generateEmbedding(textToEmbed);

    return this.cleanReportRepository.findSimilarByEmbedding(
      embeddingResult.embedding,
      companyId,
      topK,
    );
  }

  /**
   * RAG 기반 인사이트 생성
   */
  async generateInsight(input: GenerateInsightInput): Promise<GeneratedInsight> {
    // 1. 유사 보고서 검색
    const similarReports = await this.findSimilarReports(
      input.companyId,
      input.canonicalData,
      input.topK || 3,
    );

    // 2. 컨텍스트 구성
    const context = this.buildContext(similarReports, input.canonicalData);

    // 3. LLM으로 인사이트 생성
    const insight = await this.callGeminiForInsight(context, input.canonicalData);

    return {
      ...insight,
      similarReports,
      confidence: this.calculateConfidence(similarReports),
    };
  }

  /**
   * 회사별 클린 보고서 목록
   */
  async getCleanReportsByCompany(companyId: string): Promise<CleanReportEntity[]> {
    return this.cleanReportRepository.findByCompanyId(companyId);
  }

  /**
   * 템플릿별 클린 보고서 목록
   */
  async getCleanReportsByTemplate(templateId: string): Promise<CleanReportEntity[]> {
    return this.cleanReportRepository.findByTemplateId(templateId);
  }

  /**
   * 클린 보고서 삭제
   */
  async deleteCleanReport(id: string): Promise<void> {
    return this.cleanReportRepository.delete(id);
  }

  // ============================================
  // Private Helpers
  // ============================================

  private buildEmbeddingText(canonicalData: CanonicalDataVO, additionalText?: string): string {
    const parts: string[] = [];

    // 데이터 소스
    parts.push(`데이터 소스: ${canonicalData.source}`);

    // 기간
    const periodStart = new Date(canonicalData.periodStart).toISOString().split('T')[0];
    const periodEnd = new Date(canonicalData.periodEnd).toISOString().split('T')[0];
    parts.push(`기간: ${periodStart} ~ ${periodEnd}`);

    // 주요 메트릭 요약
    if (canonicalData.summary) {
      const summaryParts: string[] = [];
      for (const [key, value] of Object.entries(canonicalData.summary)) {
        const metricDef = CANONICAL_METRICS[key];
        const name = metricDef?.nameKo || key;
        summaryParts.push(`${name}: ${value}`);
      }
      parts.push(`주요 지표: ${summaryParts.join(', ')}`);
    }

    // 차원 정보
    if (canonicalData.dimensions.length > 0) {
      parts.push(`분석 차원: ${canonicalData.dimensions.join(', ')}`);
    }

    // 추가 텍스트 (인사이트 등)
    if (additionalText) {
      parts.push(`인사이트: ${additionalText}`);
    }

    return parts.join('\n');
  }

  private buildContext(
    similarReports: SimilarReportResult[],
    currentData: CanonicalDataVO,
  ): string {
    const contextParts: string[] = [];

    contextParts.push('=== 과거 유사 보고서 ===');

    for (let i = 0; i < similarReports.length; i++) {
      const { report, similarity } = similarReports[i];
      contextParts.push(`\n[보고서 ${i + 1}] (유사도: ${(similarity * 100).toFixed(1)}%)`);
      contextParts.push(`기간: ${new Date(report.periodStart).toISOString().split('T')[0]} ~ ${new Date(report.periodEnd).toISOString().split('T')[0]}`);

      // 메트릭 요약
      if (report.metricsJson.summary) {
        const summaryParts: string[] = [];
        for (const [key, value] of Object.entries(report.metricsJson.summary)) {
          const metricDef = CANONICAL_METRICS[key];
          const name = metricDef?.nameKo || key;
          summaryParts.push(`${name}: ${value}`);
        }
        contextParts.push(`지표: ${summaryParts.join(', ')}`);
      }

      contextParts.push(`작성된 인사이트: ${report.finalText}`);
    }

    contextParts.push('\n=== 현재 분석할 데이터 ===');
    contextParts.push(this.buildEmbeddingText(currentData));

    return contextParts.join('\n');
  }

  private async callGeminiForInsight(
    context: string,
    currentData: CanonicalDataVO,
  ): Promise<{ summary: string; keyFindings: string[]; recommendations: string[] }> {
    if (!this.geminiApiKey) {
      // API 키가 없으면 기본 인사이트 생성
      return this.generateDefaultInsight(currentData);
    }

    const prompt = `당신은 마케팅 데이터 분석 전문가입니다.
과거 유사한 보고서들을 참고하여, 현재 데이터에 대한 인사이트를 생성해주세요.

${context}

다음 JSON 형식으로 응답해주세요:
{
  "summary": "전체 요약 (1-2문장)",
  "keyFindings": ["주요 발견 1", "주요 발견 2", "주요 발견 3"],
  "recommendations": ["권장 사항 1", "권장 사항 2"]
}

한국어로 작성해주세요. 비즈니스 관점에서 실행 가능한 인사이트를 제공해주세요.`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
            },
          }),
        },
      );

      if (!response.ok) {
        console.error('Gemini API error:', await response.text());
        return this.generateDefaultInsight(currentData);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // JSON 파싱
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || '',
          keyFindings: parsed.keyFindings || [],
          recommendations: parsed.recommendations || [],
        };
      }

      return this.generateDefaultInsight(currentData);
    } catch (error) {
      console.error('Gemini insight generation error:', error);
      return this.generateDefaultInsight(currentData);
    }
  }

  private generateDefaultInsight(data: CanonicalDataVO): {
    summary: string;
    keyFindings: string[];
    recommendations: string[];
  } {
    const summary = `${data.source} 데이터 분석 결과입니다.`;

    const keyFindings: string[] = [];
    if (data.summary) {
      if (data.summary.ad_spend) {
        keyFindings.push(`총 광고비: ₩${Number(data.summary.ad_spend).toLocaleString()}`);
      }
      if (data.summary.roas) {
        keyFindings.push(`ROAS: ${Number(data.summary.roas).toFixed(2)}`);
      }
      if (data.summary.ctr) {
        keyFindings.push(`CTR: ${(Number(data.summary.ctr) * 100).toFixed(2)}%`);
      }
    }

    return {
      summary,
      keyFindings: keyFindings.length > 0 ? keyFindings : ['데이터 분석이 필요합니다.'],
      recommendations: ['과거 보고서를 등록하여 더 정확한 인사이트를 받아보세요.'],
    };
  }

  private calculateConfidence(similarReports: SimilarReportResult[]): number {
    if (similarReports.length === 0) return 0;

    // 상위 3개 보고서의 평균 유사도
    const topSimilarities = similarReports.slice(0, 3).map(r => r.similarity);
    const avgSimilarity = topSimilarities.reduce((a, b) => a + b, 0) / topSimilarities.length;

    return Math.min(avgSimilarity, 1);
  }
}
