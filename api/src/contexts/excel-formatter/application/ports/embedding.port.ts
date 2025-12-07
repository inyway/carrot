/**
 * Embedding Port
 * 텍스트 임베딩 생성을 위한 포트 인터페이스
 */

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokenCount: number;
}

export interface EmbeddingPort {
  /**
   * 텍스트를 임베딩 벡터로 변환
   */
  generateEmbedding(text: string): Promise<EmbeddingResult>;

  /**
   * 여러 텍스트를 임베딩 벡터로 변환
   */
  generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]>;
}

export const EMBEDDING_PORT = Symbol('EMBEDDING_PORT');
