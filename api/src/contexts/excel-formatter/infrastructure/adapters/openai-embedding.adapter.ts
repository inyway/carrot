/**
 * OpenAI Embedding Adapter
 * text-embedding-3-small 모델 사용
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingPort, EmbeddingResult } from '../../application/ports/embedding.port';

@Injectable()
export class OpenAiEmbeddingAdapter implements EmbeddingPort {
  private readonly apiKey: string;
  private readonly model = 'text-embedding-3-small';
  private readonly dimensions = 1536;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY') || '';
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const results = await this.generateEmbeddings([text]);
    return results[0];
  }

  async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as OpenAIEmbeddingResponse;

    return data.data.map((item, index) => ({
      embedding: item.embedding,
      model: data.model,
      tokenCount: data.usage?.total_tokens || 0,
    }));
  }
}

interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
