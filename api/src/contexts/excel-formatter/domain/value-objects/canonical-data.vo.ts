/**
 * Canonical Data Value Objects
 * 다양한 데이터 소스를 표준화된 형식으로 변환
 */

// ============================================
// Canonical Metric Types
// ============================================

export enum MetricType {
  NUMBER = 'number',
  CURRENCY = 'currency',
  PERCENTAGE = 'percentage',
  RATE = 'rate',
  COUNT = 'count',
}

export enum MetricCategory {
  COST = 'cost',
  REVENUE = 'revenue',
  PERFORMANCE = 'performance',
  ENGAGEMENT = 'engagement',
  CONVERSION = 'conversion',
  TRAFFIC = 'traffic',
}

// ============================================
// Standard Canonical Metrics
// ============================================

export interface CanonicalMetricDefinition {
  key: string;
  name: string;
  nameKo: string;
  type: MetricType;
  category: MetricCategory;
  format?: string;
  description?: string;
}

// 표준 메트릭 정의
export const CANONICAL_METRICS: Record<string, CanonicalMetricDefinition> = {
  // Cost Metrics
  ad_spend: {
    key: 'ad_spend',
    name: 'Ad Spend',
    nameKo: '광고비',
    type: MetricType.CURRENCY,
    category: MetricCategory.COST,
    format: '₩#,##0',
  },
  cpc: {
    key: 'cpc',
    name: 'Cost Per Click',
    nameKo: 'CPC (클릭당 비용)',
    type: MetricType.CURRENCY,
    category: MetricCategory.COST,
    format: '₩#,##0',
  },
  cpm: {
    key: 'cpm',
    name: 'Cost Per Mille',
    nameKo: 'CPM (1000회 노출당 비용)',
    type: MetricType.CURRENCY,
    category: MetricCategory.COST,
    format: '₩#,##0',
  },
  cpa: {
    key: 'cpa',
    name: 'Cost Per Acquisition',
    nameKo: 'CPA (전환당 비용)',
    type: MetricType.CURRENCY,
    category: MetricCategory.COST,
    format: '₩#,##0',
  },

  // Revenue Metrics
  revenue: {
    key: 'revenue',
    name: 'Revenue',
    nameKo: '매출',
    type: MetricType.CURRENCY,
    category: MetricCategory.REVENUE,
    format: '₩#,##0',
  },
  roas: {
    key: 'roas',
    name: 'Return on Ad Spend',
    nameKo: 'ROAS (광고수익률)',
    type: MetricType.PERCENTAGE,
    category: MetricCategory.REVENUE,
    format: '0.00%',
  },
  conversion_value: {
    key: 'conversion_value',
    name: 'Conversion Value',
    nameKo: '전환 가치',
    type: MetricType.CURRENCY,
    category: MetricCategory.REVENUE,
    format: '₩#,##0',
  },

  // Performance Metrics
  impressions: {
    key: 'impressions',
    name: 'Impressions',
    nameKo: '노출수',
    type: MetricType.COUNT,
    category: MetricCategory.PERFORMANCE,
    format: '#,##0',
  },
  clicks: {
    key: 'clicks',
    name: 'Clicks',
    nameKo: '클릭수',
    type: MetricType.COUNT,
    category: MetricCategory.PERFORMANCE,
    format: '#,##0',
  },
  ctr: {
    key: 'ctr',
    name: 'Click-Through Rate',
    nameKo: 'CTR (클릭률)',
    type: MetricType.PERCENTAGE,
    category: MetricCategory.PERFORMANCE,
    format: '0.00%',
  },

  // Conversion Metrics
  conversions: {
    key: 'conversions',
    name: 'Conversions',
    nameKo: '전환수',
    type: MetricType.COUNT,
    category: MetricCategory.CONVERSION,
    format: '#,##0',
  },
  conversion_rate: {
    key: 'conversion_rate',
    name: 'Conversion Rate',
    nameKo: '전환율',
    type: MetricType.PERCENTAGE,
    category: MetricCategory.CONVERSION,
    format: '0.00%',
  },

  // Engagement Metrics
  sessions: {
    key: 'sessions',
    name: 'Sessions',
    nameKo: '세션수',
    type: MetricType.COUNT,
    category: MetricCategory.ENGAGEMENT,
    format: '#,##0',
  },
  users: {
    key: 'users',
    name: 'Users',
    nameKo: '사용자수',
    type: MetricType.COUNT,
    category: MetricCategory.ENGAGEMENT,
    format: '#,##0',
  },
  new_users: {
    key: 'new_users',
    name: 'New Users',
    nameKo: '신규 사용자',
    type: MetricType.COUNT,
    category: MetricCategory.ENGAGEMENT,
    format: '#,##0',
  },
  bounce_rate: {
    key: 'bounce_rate',
    name: 'Bounce Rate',
    nameKo: '이탈률',
    type: MetricType.PERCENTAGE,
    category: MetricCategory.ENGAGEMENT,
    format: '0.00%',
  },
  avg_session_duration: {
    key: 'avg_session_duration',
    name: 'Avg. Session Duration',
    nameKo: '평균 세션 시간',
    type: MetricType.NUMBER,
    category: MetricCategory.ENGAGEMENT,
    format: '#,##0',
  },
  pageviews: {
    key: 'pageviews',
    name: 'Pageviews',
    nameKo: '페이지뷰',
    type: MetricType.COUNT,
    category: MetricCategory.TRAFFIC,
    format: '#,##0',
  },
};

// ============================================
// Canonical Data Structure
// ============================================

export interface CanonicalMetricValue {
  key: string;
  value: number;
  formattedValue?: string;
}

export interface CanonicalDimension {
  key: string;
  value: string;
}

export interface CanonicalDataRow {
  dimensions: CanonicalDimension[];
  metrics: CanonicalMetricValue[];
}

export interface CanonicalDataVO {
  source: string;           // 데이터 소스 (google_ads, meta_ads, ga4 등)
  periodStart: Date;
  periodEnd: Date;
  dimensions: string[];     // 사용된 dimension 키들
  metrics: string[];        // 사용된 metric 키들
  rows: CanonicalDataRow[];
  summary?: {               // 집계 데이터
    [metricKey: string]: number;
  };
  metadata?: {
    rawRowCount: number;
    processedAt: Date;
    mappingVersion: string;
  };
}

// ============================================
// Data Source Mapping Types
// ============================================

export interface FieldMapping {
  sourceField: string;      // 원본 필드명
  canonicalKey: string;     // canonical 키
  transform?: 'none' | 'multiply_100' | 'divide_100' | 'parse_date' | 'parse_number';
}

export interface DataSourceMapping {
  sourceName: string;
  fieldMappings: FieldMapping[];
  dimensionMappings?: FieldMapping[];
}

// ============================================
// Known Data Source Mappings
// ============================================

export const KNOWN_MAPPINGS: Record<string, DataSourceMapping> = {
  google_ads: {
    sourceName: 'google_ads',
    fieldMappings: [
      { sourceField: 'Cost', canonicalKey: 'ad_spend', transform: 'none' },
      { sourceField: 'cost', canonicalKey: 'ad_spend', transform: 'none' },
      { sourceField: 'Impressions', canonicalKey: 'impressions', transform: 'none' },
      { sourceField: 'impressions', canonicalKey: 'impressions', transform: 'none' },
      { sourceField: 'Clicks', canonicalKey: 'clicks', transform: 'none' },
      { sourceField: 'clicks', canonicalKey: 'clicks', transform: 'none' },
      { sourceField: 'CTR', canonicalKey: 'ctr', transform: 'divide_100' },
      { sourceField: 'ctr', canonicalKey: 'ctr', transform: 'divide_100' },
      { sourceField: 'Conversions', canonicalKey: 'conversions', transform: 'none' },
      { sourceField: 'conversions', canonicalKey: 'conversions', transform: 'none' },
      { sourceField: 'ConversionValue', canonicalKey: 'conversion_value', transform: 'none' },
      { sourceField: 'conversion_value', canonicalKey: 'conversion_value', transform: 'none' },
      { sourceField: 'CPC', canonicalKey: 'cpc', transform: 'none' },
      { sourceField: 'avg_cpc', canonicalKey: 'cpc', transform: 'none' },
    ],
    dimensionMappings: [
      { sourceField: 'Campaign', canonicalKey: 'campaign' },
      { sourceField: 'campaign_name', canonicalKey: 'campaign' },
      { sourceField: 'AdGroup', canonicalKey: 'ad_group' },
      { sourceField: 'ad_group_name', canonicalKey: 'ad_group' },
      { sourceField: 'Date', canonicalKey: 'date' },
      { sourceField: 'date', canonicalKey: 'date' },
    ],
  },
  meta_ads: {
    sourceName: 'meta_ads',
    fieldMappings: [
      { sourceField: 'spend', canonicalKey: 'ad_spend', transform: 'none' },
      { sourceField: 'Spend', canonicalKey: 'ad_spend', transform: 'none' },
      { sourceField: 'impressions', canonicalKey: 'impressions', transform: 'none' },
      { sourceField: 'Impressions', canonicalKey: 'impressions', transform: 'none' },
      { sourceField: 'clicks', canonicalKey: 'clicks', transform: 'none' },
      { sourceField: 'link_clicks', canonicalKey: 'clicks', transform: 'none' },
      { sourceField: 'ctr', canonicalKey: 'ctr', transform: 'divide_100' },
      { sourceField: 'CTR', canonicalKey: 'ctr', transform: 'divide_100' },
      { sourceField: 'conversions', canonicalKey: 'conversions', transform: 'none' },
      { sourceField: 'purchases', canonicalKey: 'conversions', transform: 'none' },
      { sourceField: 'purchase_value', canonicalKey: 'conversion_value', transform: 'none' },
      { sourceField: 'cpc', canonicalKey: 'cpc', transform: 'none' },
      { sourceField: 'cost_per_click', canonicalKey: 'cpc', transform: 'none' },
    ],
    dimensionMappings: [
      { sourceField: 'campaign_name', canonicalKey: 'campaign' },
      { sourceField: 'Campaign Name', canonicalKey: 'campaign' },
      { sourceField: 'adset_name', canonicalKey: 'ad_group' },
      { sourceField: 'Ad Set Name', canonicalKey: 'ad_group' },
      { sourceField: 'date_start', canonicalKey: 'date' },
    ],
  },
  ga4: {
    sourceName: 'ga4',
    fieldMappings: [
      { sourceField: 'sessions', canonicalKey: 'sessions', transform: 'none' },
      { sourceField: 'totalUsers', canonicalKey: 'users', transform: 'none' },
      { sourceField: 'newUsers', canonicalKey: 'new_users', transform: 'none' },
      { sourceField: 'bounceRate', canonicalKey: 'bounce_rate', transform: 'none' },
      { sourceField: 'screenPageViews', canonicalKey: 'pageviews', transform: 'none' },
      { sourceField: 'averageSessionDuration', canonicalKey: 'avg_session_duration', transform: 'none' },
      { sourceField: 'conversions', canonicalKey: 'conversions', transform: 'none' },
      { sourceField: 'totalRevenue', canonicalKey: 'revenue', transform: 'none' },
    ],
    dimensionMappings: [
      { sourceField: 'date', canonicalKey: 'date' },
      { sourceField: 'sessionSource', canonicalKey: 'source' },
      { sourceField: 'sessionMedium', canonicalKey: 'medium' },
      { sourceField: 'sessionCampaignName', canonicalKey: 'campaign' },
    ],
  },
};
