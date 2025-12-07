/**
 * Data Transform Port
 * Raw Data → Canonical Data 변환을 위한 포트 인터페이스
 */

import {
  CanonicalDataVO,
  FieldMapping,
  DataSourceMapping,
} from '../../domain/value-objects/canonical-data.vo';

export interface RawDataInput {
  source: string;              // 데이터 소스 식별자 (google_ads, meta_ads, ga4, unknown)
  periodStart: Date;
  periodEnd: Date;
  headers: string[];           // 원본 컬럼 헤더
  rows: Record<string, any>[]; // 원본 데이터 행
}

export interface TransformResult {
  success: boolean;
  canonicalData?: CanonicalDataVO;
  unmappedFields?: string[];   // 매핑되지 않은 필드들
  warnings?: string[];
  error?: string;
}

export interface DetectedSource {
  source: string;
  confidence: number;          // 0-1 사이 신뢰도
  matchedFields: string[];
}

export const DATA_TRANSFORM_PORT = Symbol('DATA_TRANSFORM_PORT');

export interface DataTransformPort {
  /**
   * 원본 데이터를 Canonical 형식으로 변환
   */
  transform(input: RawDataInput): Promise<TransformResult>;

  /**
   * 원본 헤더를 기반으로 데이터 소스 자동 감지
   */
  detectSource(headers: string[]): Promise<DetectedSource>;

  /**
   * AI를 사용하여 알 수 없는 필드 매핑 추론
   */
  inferFieldMappings(
    source: string,
    unmappedFields: string[],
  ): Promise<FieldMapping[]>;

  /**
   * 커스텀 매핑 저장
   */
  saveCustomMapping(mapping: DataSourceMapping): Promise<void>;

  /**
   * 저장된 커스텀 매핑 조회
   */
  getCustomMappings(source: string): Promise<DataSourceMapping | null>;
}
