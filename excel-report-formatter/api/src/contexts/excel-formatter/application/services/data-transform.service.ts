/**
 * Data Transform Service
 * Raw Data를 Canonical 형식으로 변환하는 서비스
 */

import { Injectable, Inject } from '@nestjs/common';
import {
  RawDataInput,
  TransformResult,
  DetectedSource,
} from '../ports/data-transform.port';
import type { AiMappingPort } from '../ports/ai-mapping.port';
import { AI_MAPPING_PORT } from '../ports/ai-mapping.port';
import {
  CanonicalDataVO,
  CanonicalDataRow,
  CanonicalDimension,
  CanonicalMetricValue,
  FieldMapping,
  DataSourceMapping,
  KNOWN_MAPPINGS,
  CANONICAL_METRICS,
} from '../../domain/value-objects/canonical-data.vo';

@Injectable()
export class DataTransformService {
  // 커스텀 매핑 캐시 (실제로는 DB에 저장)
  private customMappings: Map<string, DataSourceMapping> = new Map();

  constructor(
    @Inject(AI_MAPPING_PORT)
    private readonly aiMappingAdapter: AiMappingPort,
  ) {}

  /**
   * 원본 데이터를 Canonical 형식으로 변환
   */
  async transform(input: RawDataInput): Promise<TransformResult> {
    try {
      // 1. 데이터 소스 감지
      const detected = await this.detectSource(input.headers);
      const sourceMapping = this.getMapping(detected.source);

      if (!sourceMapping) {
        // 알려지지 않은 소스 - AI로 매핑 추론
        const inferredMappings = await this.inferFieldMappings(
          'unknown',
          input.headers,
        );

        if (inferredMappings.length === 0) {
          return {
            success: false,
            error: '데이터 소스를 인식할 수 없습니다.',
            unmappedFields: input.headers,
          };
        }

        // 임시 매핑 생성
        const tempMapping: DataSourceMapping = {
          sourceName: 'unknown',
          fieldMappings: inferredMappings,
        };

        return this.transformWithMapping(input, tempMapping);
      }

      return this.transformWithMapping(input, sourceMapping);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '변환 중 오류 발생',
      };
    }
  }

  /**
   * 매핑을 사용하여 실제 변환 수행
   */
  private transformWithMapping(
    input: RawDataInput,
    mapping: DataSourceMapping,
  ): TransformResult {
    const warnings: string[] = [];
    const unmappedFields: string[] = [];

    // 매핑되지 않은 필드 찾기
    for (const header of input.headers) {
      const hasMapping = mapping.fieldMappings.some(
        (m) => m.sourceField.toLowerCase() === header.toLowerCase(),
      ) || mapping.dimensionMappings?.some(
        (m) => m.sourceField.toLowerCase() === header.toLowerCase(),
      );

      if (!hasMapping) {
        unmappedFields.push(header);
      }
    }

    if (unmappedFields.length > 0) {
      warnings.push(`매핑되지 않은 필드: ${unmappedFields.join(', ')}`);
    }

    // 사용된 메트릭/디멘션 키 수집
    const usedMetrics = new Set<string>();
    const usedDimensions = new Set<string>();

    // 행 데이터 변환
    const rows: CanonicalDataRow[] = input.rows.map((row) => {
      const dimensions: CanonicalDimension[] = [];
      const metrics: CanonicalMetricValue[] = [];

      // 메트릭 매핑
      for (const fieldMapping of mapping.fieldMappings) {
        const value = this.findFieldValue(row, fieldMapping.sourceField);
        if (value !== undefined && value !== null) {
          const numValue = this.transformValue(value, fieldMapping.transform);
          if (!isNaN(numValue)) {
            usedMetrics.add(fieldMapping.canonicalKey);
            metrics.push({
              key: fieldMapping.canonicalKey,
              value: numValue,
              formattedValue: this.formatMetric(fieldMapping.canonicalKey, numValue),
            });
          }
        }
      }

      // 디멘션 매핑
      if (mapping.dimensionMappings) {
        for (const dimMapping of mapping.dimensionMappings) {
          const value = this.findFieldValue(row, dimMapping.sourceField);
          if (value !== undefined && value !== null) {
            usedDimensions.add(dimMapping.canonicalKey);
            dimensions.push({
              key: dimMapping.canonicalKey,
              value: String(value),
            });
          }
        }
      }

      return { dimensions, metrics };
    });

    // Summary 계산
    const summary: Record<string, number> = {};
    for (const metricKey of usedMetrics) {
      const metricDef = CANONICAL_METRICS[metricKey];
      if (metricDef) {
        const values = rows
          .map((r) => r.metrics.find((m) => m.key === metricKey)?.value)
          .filter((v): v is number => v !== undefined);

        if (values.length > 0) {
          // rate/percentage는 평균, 나머지는 합계
          if (metricDef.type === 'percentage' || metricDef.type === 'rate') {
            summary[metricKey] = values.reduce((a, b) => a + b, 0) / values.length;
          } else {
            summary[metricKey] = values.reduce((a, b) => a + b, 0);
          }
        }
      }
    }

    const canonicalData: CanonicalDataVO = {
      source: mapping.sourceName,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dimensions: Array.from(usedDimensions),
      metrics: Array.from(usedMetrics),
      rows,
      summary,
      metadata: {
        rawRowCount: input.rows.length,
        processedAt: new Date(),
        mappingVersion: '1.0.0',
      },
    };

    return {
      success: true,
      canonicalData,
      unmappedFields: unmappedFields.length > 0 ? unmappedFields : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * 원본 헤더를 기반으로 데이터 소스 자동 감지
   */
  async detectSource(headers: string[]): Promise<DetectedSource> {
    const lowerHeaders = headers.map((h) => h.toLowerCase());
    const scores: Record<string, { matches: string[]; score: number }> = {};

    for (const [sourceName, mapping] of Object.entries(KNOWN_MAPPINGS)) {
      const matchedFields: string[] = [];

      // 필드 매핑 확인
      for (const fm of mapping.fieldMappings) {
        if (lowerHeaders.includes(fm.sourceField.toLowerCase())) {
          matchedFields.push(fm.sourceField);
        }
      }

      // 디멘션 매핑 확인
      if (mapping.dimensionMappings) {
        for (const dm of mapping.dimensionMappings) {
          if (lowerHeaders.includes(dm.sourceField.toLowerCase())) {
            matchedFields.push(dm.sourceField);
          }
        }
      }

      scores[sourceName] = {
        matches: matchedFields,
        score: matchedFields.length / headers.length,
      };
    }

    // 가장 높은 점수의 소스 선택
    let bestSource = 'unknown';
    let bestScore = 0;
    let bestMatches: string[] = [];

    for (const [source, data] of Object.entries(scores)) {
      if (data.score > bestScore) {
        bestSource = source;
        bestScore = data.score;
        bestMatches = data.matches;
      }
    }

    // 최소 20% 이상 매칭되어야 인정
    if (bestScore < 0.2) {
      return {
        source: 'unknown',
        confidence: 0,
        matchedFields: [],
      };
    }

    return {
      source: bestSource,
      confidence: bestScore,
      matchedFields: bestMatches,
    };
  }

  /**
   * AI를 사용하여 알 수 없는 필드 매핑 추론
   */
  async inferFieldMappings(
    source: string,
    unmappedFields: string[],
  ): Promise<FieldMapping[]> {
    // AI Mapping Adapter를 사용하여 필드 매핑 추론
    try {
      const templateColumns = Object.values(CANONICAL_METRICS).map((m) => m.nameKo);

      const result = await this.aiMappingAdapter.generateMappings(
        templateColumns,
        unmappedFields,
        `다음 데이터 필드들을 표준 메트릭으로 매핑해주세요. 소스: ${source}`,
      );

      // AI 결과를 FieldMapping으로 변환
      const mappings: FieldMapping[] = [];
      for (const mapping of result) {
        // canonical key 찾기
        const canonicalEntry = Object.entries(CANONICAL_METRICS).find(
          ([, v]) => v.nameKo === mapping.templateColumn,
        );

        if (canonicalEntry && mapping.dataColumn) {
          mappings.push({
            sourceField: mapping.dataColumn,
            canonicalKey: canonicalEntry[0],
            transform: 'none',
          });
        }
      }

      return mappings;
    } catch (error) {
      console.error('AI 필드 매핑 추론 실패:', error);
      return [];
    }
  }

  /**
   * 커스텀 매핑 저장
   */
  async saveCustomMapping(mapping: DataSourceMapping): Promise<void> {
    this.customMappings.set(mapping.sourceName, mapping);
    // TODO: DB에 저장
  }

  /**
   * 저장된 커스텀 매핑 조회
   */
  async getCustomMappings(source: string): Promise<DataSourceMapping | null> {
    return this.customMappings.get(source) || null;
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private getMapping(source: string): DataSourceMapping | null {
    // 커스텀 매핑 우선
    const custom = this.customMappings.get(source);
    if (custom) return custom;

    // 기본 매핑
    return KNOWN_MAPPINGS[source] || null;
  }

  private findFieldValue(row: Record<string, any>, fieldName: string): any {
    // 정확한 매칭
    if (row[fieldName] !== undefined) return row[fieldName];

    // 대소문자 무시 매칭
    const lowerField = fieldName.toLowerCase();
    for (const [key, value] of Object.entries(row)) {
      if (key.toLowerCase() === lowerField) {
        return value;
      }
    }

    return undefined;
  }

  private transformValue(
    value: any,
    transform?: FieldMapping['transform'],
  ): number {
    let numValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));

    if (isNaN(numValue)) return NaN;

    switch (transform) {
      case 'multiply_100':
        return numValue * 100;
      case 'divide_100':
        return numValue / 100;
      default:
        return numValue;
    }
  }

  private formatMetric(key: string, value: number): string {
    const def = CANONICAL_METRICS[key];
    if (!def) return String(value);

    switch (def.type) {
      case 'currency':
        return `₩${value.toLocaleString()}`;
      case 'percentage':
        return `${(value * 100).toFixed(2)}%`;
      case 'count':
        return value.toLocaleString();
      default:
        return String(value);
    }
  }
}
