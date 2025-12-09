/**
 * Clean Report Repository Port
 * 클린 보고서 저장 및 유사 검색을 위한 포트 인터페이스
 */

import type { CanonicalDataVO } from '../../domain/value-objects/canonical-data.vo';

export interface CleanReportEntity {
  id: string;
  companyId: string;
  templateId: string;
  periodStart: Date;
  periodEnd: Date;
  metricsJson: CanonicalDataVO;
  finalText: string;
  embedding?: number[];
  fileUrl?: string;
  createdAt: Date;
}

export interface CreateCleanReportInput {
  companyId: string;
  templateId: string;
  periodStart: Date;
  periodEnd: Date;
  metricsJson: CanonicalDataVO;
  finalText: string;
  embedding?: number[];
  fileUrl?: string;
}

export interface SimilarReportResult {
  report: CleanReportEntity;
  similarity: number;
}

export interface CleanReportRepositoryPort {
  /**
   * 클린 보고서 생성
   */
  create(input: CreateCleanReportInput): Promise<CleanReportEntity>;

  /**
   * ID로 클린 보고서 조회
   */
  findById(id: string): Promise<CleanReportEntity | null>;

  /**
   * 회사별 클린 보고서 목록
   */
  findByCompanyId(companyId: string): Promise<CleanReportEntity[]>;

  /**
   * 템플릿별 클린 보고서 목록
   */
  findByTemplateId(templateId: string): Promise<CleanReportEntity[]>;

  /**
   * 임베딩 기반 유사 보고서 검색 (pgvector)
   */
  findSimilarByEmbedding(
    embedding: number[],
    companyId: string,
    limit?: number,
  ): Promise<SimilarReportResult[]>;

  /**
   * 임베딩 업데이트
   */
  updateEmbedding(id: string, embedding: number[]): Promise<void>;

  /**
   * 클린 보고서 삭제
   */
  delete(id: string): Promise<void>;
}

export const CLEAN_REPORT_REPOSITORY_PORT = Symbol('CLEAN_REPORT_REPOSITORY_PORT');
