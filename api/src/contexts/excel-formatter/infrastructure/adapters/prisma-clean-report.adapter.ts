/**
 * Prisma Clean Report Adapter
 * pgvector를 사용한 클린 보고서 저장 및 유사 검색
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type {
  CleanReportRepositoryPort,
  CleanReportEntity,
  CreateCleanReportInput,
  SimilarReportResult,
} from '../../application/ports/clean-report-repository.port';
import type { CanonicalDataVO } from '../../domain/value-objects/canonical-data.vo';

@Injectable()
export class PrismaCleanReportAdapter implements CleanReportRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateCleanReportInput): Promise<CleanReportEntity> {
    // 임베딩이 있는 경우 raw SQL로 처리 (Prisma는 vector 타입 직접 지원 안함)
    if (input.embedding && input.embedding.length > 0) {
      const embeddingStr = `[${input.embedding.join(',')}]`;

      const result = await this.prisma.$queryRaw<any[]>`
        INSERT INTO clean_reports (
          id, "companyId", "templateId", "periodStart", "periodEnd",
          "metricsJson", "finalText", embedding, "fileUrl", "createdAt"
        ) VALUES (
          gen_random_uuid()::text,
          ${input.companyId},
          ${input.templateId},
          ${input.periodStart},
          ${input.periodEnd},
          ${JSON.stringify(input.metricsJson)}::jsonb,
          ${input.finalText},
          ${embeddingStr}::vector,
          ${input.fileUrl || null},
          NOW()
        )
        RETURNING *
      `;

      return this.mapToEntity(result[0]);
    }

    // 임베딩 없는 경우 일반 Prisma 사용
    const report = await this.prisma.cleanReport.create({
      data: {
        companyId: input.companyId,
        templateId: input.templateId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        metricsJson: input.metricsJson as any,
        finalText: input.finalText,
        fileUrl: input.fileUrl,
      },
    });

    return this.mapToEntity(report);
  }

  async findById(id: string): Promise<CleanReportEntity | null> {
    const report = await this.prisma.cleanReport.findUnique({
      where: { id },
    });

    return report ? this.mapToEntity(report) : null;
  }

  async findByCompanyId(companyId: string): Promise<CleanReportEntity[]> {
    const reports = await this.prisma.cleanReport.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    return reports.map(r => this.mapToEntity(r));
  }

  async findByTemplateId(templateId: string): Promise<CleanReportEntity[]> {
    const reports = await this.prisma.cleanReport.findMany({
      where: { templateId },
      orderBy: { createdAt: 'desc' },
    });

    return reports.map(r => this.mapToEntity(r));
  }

  async findSimilarByEmbedding(
    embedding: number[],
    companyId: string,
    limit = 5,
  ): Promise<SimilarReportResult[]> {
    const embeddingStr = `[${embedding.join(',')}]`;

    // pgvector 코사인 유사도 검색
    const results = await this.prisma.$queryRaw<any[]>`
      SELECT
        cr.*,
        1 - (cr.embedding <=> ${embeddingStr}::vector) AS similarity
      FROM clean_reports cr
      WHERE cr."companyId" = ${companyId}
        AND cr.embedding IS NOT NULL
      ORDER BY cr.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `;

    return results.map(r => ({
      report: this.mapToEntity(r),
      similarity: Number(r.similarity),
    }));
  }

  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    const embeddingStr = `[${embedding.join(',')}]`;

    await this.prisma.$executeRaw`
      UPDATE clean_reports
      SET embedding = ${embeddingStr}::vector
      WHERE id = ${id}
    `;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.cleanReport.delete({
      where: { id },
    });
  }

  private mapToEntity(data: any): CleanReportEntity {
    return {
      id: data.id,
      companyId: data.companyId,
      templateId: data.templateId,
      periodStart: new Date(data.periodStart),
      periodEnd: new Date(data.periodEnd),
      metricsJson: data.metricsJson as CanonicalDataVO,
      finalText: data.finalText,
      embedding: data.embedding ? this.parseEmbedding(data.embedding) : undefined,
      fileUrl: data.fileUrl || undefined,
      createdAt: new Date(data.createdAt),
    };
  }

  private parseEmbedding(embedding: any): number[] | undefined {
    if (!embedding) return undefined;
    if (Array.isArray(embedding)) return embedding;
    if (typeof embedding === 'string') {
      // "[0.1,0.2,...]" 형태 파싱
      return JSON.parse(embedding.replace(/^\[/, '[').replace(/\]$/, ']'));
    }
    return undefined;
  }
}
