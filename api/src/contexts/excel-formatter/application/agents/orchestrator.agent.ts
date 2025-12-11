import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeaderDetectionAgent, type HeaderAnalysisResult, type HierarchicalColumn } from './header-detection.agent';

/**
 * Agent 실행 결과
 */
export interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;  // ms
}

/**
 * 매핑 후보
 */
export interface MappingCandidate {
  excelColumn: string;
  hwpxRow: number;
  hwpxCol: number;
  labelText?: string;
  confidence: number;
  source: 'rule' | 'ai_template' | 'ai_excel' | 'context';
  reason?: string;
}

/**
 * 최종 매핑 결과
 */
export interface FinalMapping {
  excelColumn: string;
  hwpxRow: number;
  hwpxCol: number;
}

/**
 * 슬림 HWPX 셀
 */
export interface SlimCell {
  r: number;      // rowIndex
  c: number;      // colIndex
  t: string;      // text
  h: boolean;     // isHeader
  cs?: number;    // colSpan
  rs?: number;    // rowSpan
}

/**
 * 슬림 HWPX 테이블
 */
export interface SlimTable {
  rows: number;
  cols: number;
  cells: SlimCell[];
}

/**
 * 파이프라인 상태
 */
export interface PipelineState {
  // 입력
  table: SlimTable;
  columns: string[];
  hierarchicalColumns?: HierarchicalColumn[];
  headerAnalysis?: HeaderAnalysisResult;

  // 각 Agent 결과
  ruleMappings: MappingCandidate[];
  aiTemplateMappings: MappingCandidate[];
  aiExcelMappings: MappingCandidate[];

  // 최종 결과
  mergedCandidates: MappingCandidate[];
  finalMappings: FinalMapping[];
  validationIssues: string[];
}

/**
 * Agent 정의
 */
interface AgentDefinition<TInput, TOutput> {
  name: string;
  execute: (input: TInput) => Promise<TOutput>;
  priority: number;
  parallel?: boolean;  // 다른 Agent와 병렬 실행 가능 여부
}

/**
 * Orchestrator Agent
 *
 * 여러 Agent를 조율하여 전체 매핑 파이프라인을 관리합니다.
 *
 * 파이프라인 구조:
 * 1. [Parallel] Header Detection Agent (Excel 분석)
 * 2. [Parallel] Rule-Based Agent, AI Template Agent, AI Excel Agent
 * 3. [Sequential] Merge Agent
 * 4. [Sequential] Validation Agent
 */
@Injectable()
export class OrchestratorAgent {
  private readonly apiKey: string | undefined;
  private readonly apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  constructor(
    private readonly configService: ConfigService,
    private readonly headerAgent: HeaderDetectionAgent,
  ) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY');
  }

  /**
   * 전체 파이프라인 실행
   */
  async execute(
    table: SlimTable,
    excelBuffer: Buffer,
    sheetName: string,
  ): Promise<{
    mappings: FinalMapping[];
    validationIssues: string[];
    pipelineStats: {
      headerDetection: number;
      ruleBasedMapping: number;
      aiTemplateMapping: number;
      aiExcelMapping: number;
      merging: number;
      validation: number;
      total: number;
    };
  }> {
    const startTime = Date.now();
    const stats = {
      headerDetection: 0,
      ruleBasedMapping: 0,
      aiTemplateMapping: 0,
      aiExcelMapping: 0,
      merging: 0,
      validation: 0,
      total: 0,
    };

    console.log('[Orchestrator] Starting pipeline...');

    // Step 1: Header Detection (이미 완료된 경우 스킵)
    const headerStart = Date.now();
    const headerResult = await this.headerAgent.analyze(excelBuffer, sheetName);
    stats.headerDetection = Date.now() - headerStart;
    console.log('[Orchestrator] Header detection:', stats.headerDetection, 'ms');

    // 초기 상태 구성
    const state: PipelineState = {
      table,
      columns: headerResult.columns.map(c => c.name),
      hierarchicalColumns: headerResult.columns,
      headerAnalysis: headerResult,
      ruleMappings: [],
      aiTemplateMappings: [],
      aiExcelMappings: [],
      mergedCandidates: [],
      finalMappings: [],
      validationIssues: [],
    };

    // Step 2: 병렬 매핑 Agent 실행
    console.log('[Orchestrator] Running parallel mapping agents...');
    const [ruleResult, aiTemplateResult, aiExcelResult] = await Promise.allSettled([
      this.runWithTiming(() => this.runRuleBasedAgent(state), 'Rule'),
      this.runWithTiming(() => this.runAiTemplateAgent(state), 'AITemplate'),
      this.runWithTiming(() => this.runAiExcelAgent(state), 'AIExcel'),
    ]);

    // 결과 수집
    if (ruleResult.status === 'fulfilled') {
      state.ruleMappings = ruleResult.value.data || [];
      stats.ruleBasedMapping = ruleResult.value.duration;
    }
    if (aiTemplateResult.status === 'fulfilled') {
      state.aiTemplateMappings = aiTemplateResult.value.data || [];
      stats.aiTemplateMapping = aiTemplateResult.value.duration;
    }
    if (aiExcelResult.status === 'fulfilled') {
      state.aiExcelMappings = aiExcelResult.value.data || [];
      stats.aiExcelMapping = aiExcelResult.value.duration;
    }

    console.log('[Orchestrator] Mapping results:', {
      rule: state.ruleMappings.length,
      aiTemplate: state.aiTemplateMappings.length,
      aiExcel: state.aiExcelMappings.length,
    });

    // Step 3: Merge Agent
    const mergeStart = Date.now();
    state.mergedCandidates = this.mergeResults(state);
    stats.merging = Date.now() - mergeStart;
    console.log('[Orchestrator] Merged candidates:', state.mergedCandidates.length);

    // Step 4: Validation Agent
    const validationStart = Date.now();
    const { finalMappings, issues } = this.validateAndFinalize(state);
    state.finalMappings = finalMappings;
    state.validationIssues = issues;
    stats.validation = Date.now() - validationStart;

    stats.total = Date.now() - startTime;
    console.log('[Orchestrator] Pipeline completed:', stats.total, 'ms');

    return {
      mappings: state.finalMappings,
      validationIssues: state.validationIssues,
      pipelineStats: stats,
    };
  }

  /**
   * 타이밍 측정 래퍼
   */
  private async runWithTiming<T>(
    fn: () => Promise<T>,
    name: string,
  ): Promise<AgentResult<T>> {
    const start = Date.now();
    try {
      const data = await fn();
      const duration = Date.now() - start;
      console.log(`[Orchestrator:${name}] Completed in ${duration}ms`);
      return { success: true, data, duration };
    } catch (error) {
      const duration = Date.now() - start;
      console.error(`[Orchestrator:${name}] Failed:`, error);
      return { success: false, error: String(error), duration };
    }
  }

  /**
   * Rule-Based Agent 실행
   */
  private async runRuleBasedAgent(state: PipelineState): Promise<MappingCandidate[]> {
    const candidates: MappingCandidate[] = [];
    const { table, columns } = state;

    // 셀 맵 생성
    const cellMap = new Map<string, SlimCell>();
    for (const cell of table.cells) {
      cellMap.set(`${cell.r}-${cell.c}`, cell);
    }

    const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase();
    const usedExcelCols = new Set<string>();
    const usedCellKeys = new Set<string>();

    // 라벨 셀 필터링
    const labelCells = table.cells.filter(cell => {
      if (cell.t.length < 2) return false;
      if (cell.t.length > 20) return false;
      return cell.h || (cell.t.length >= 2 && cell.t.length <= 15);
    });

    // 데이터 셀 찾기
    const findDataCell = (labelCell: SlimCell): SlimCell | null => {
      // 오른쪽 셀
      const rightCol = labelCell.c + (labelCell.cs || 1);
      const rightCell = cellMap.get(`${labelCell.r}-${rightCol}`);
      if (rightCell && !rightCell.h) return rightCell;

      // 아래 셀
      const belowRow = labelCell.r + (labelCell.rs || 1);
      const belowCell = cellMap.get(`${belowRow}-${labelCell.c}`);
      if (belowCell && !belowCell.h) return belowCell;

      return null;
    };

    // 매칭 수행
    for (const excelCol of columns) {
      const normalizedExcel = normalize(excelCol);
      if (normalizedExcel.length < 2 || usedExcelCols.has(excelCol)) continue;

      for (const labelCell of labelCells) {
        const normalizedLabel = normalize(labelCell.t);

        const exactMatch = normalizedLabel === normalizedExcel;
        const partialMatch =
          (normalizedLabel.length >= 2 && normalizedExcel.includes(normalizedLabel)) ||
          (normalizedExcel.length >= 2 && normalizedLabel.includes(normalizedExcel));

        if (!exactMatch && !partialMatch) continue;

        const dataCell = findDataCell(labelCell);
        if (dataCell) {
          const cellKey = `${dataCell.r}-${dataCell.c}`;
          if (!usedCellKeys.has(cellKey)) {
            candidates.push({
              excelColumn: excelCol,
              hwpxRow: dataCell.r,
              hwpxCol: dataCell.c,
              labelText: labelCell.t,
              confidence: exactMatch ? 0.95 : 0.85,
              source: 'rule',
              reason: `라벨 "${labelCell.t}" → 데이터 셀`,
            });
            usedExcelCols.add(excelCol);
            usedCellKeys.add(cellKey);
            break;
          }
        }
      }
    }

    return candidates;
  }

  /**
   * AI Template Agent 실행
   */
  private async runAiTemplateAgent(state: PipelineState): Promise<MappingCandidate[]> {
    if (!this.apiKey) return [];

    const tableDesc = this.buildTableDescription(state.table);

    const prompt = `HWPX 문서 템플릿의 표 구조를 분석합니다.

## 표 구조
${tableDesc}

## 분석 규칙
- [라벨] = 필드명 (예: "성명", "연락처")
- 라벨 오른쪽/아래에 데이터 셀 위치

## 작업
입력 슬롯(데이터를 넣을 위치) 찾기

## 응답 (JSON만)
{
  "slots": [
    {"labelText": "성명", "dataRow": 3, "dataCol": 5},
    ...
  ]
}`;

    try {
      const response = await this.callGemini(prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const slots = parsed.slots || [];

      const candidates: MappingCandidate[] = [];
      const normalize = (t: string) => t.replace(/\s+/g, '').toLowerCase();

      for (const slot of slots) {
        const normalizedLabel = normalize(slot.labelText || '');

        for (const excelCol of state.columns) {
          const normalizedExcel = normalize(excelCol);

          if (normalizedLabel === normalizedExcel ||
              normalizedLabel.includes(normalizedExcel) ||
              normalizedExcel.includes(normalizedLabel)) {
            candidates.push({
              excelColumn: excelCol,
              hwpxRow: slot.dataRow,
              hwpxCol: slot.dataCol,
              labelText: slot.labelText,
              confidence: 0.8,
              source: 'ai_template',
              reason: 'AI 템플릿 분석',
            });
            break;
          }
        }
      }

      return candidates;
    } catch (error) {
      console.error('[AITemplate] Error:', error);
      return [];
    }
  }

  /**
   * AI Excel Agent 실행
   */
  private async runAiExcelAgent(state: PipelineState): Promise<MappingCandidate[]> {
    if (!this.apiKey) return [];

    const labels = state.table.cells
      .filter(c => c.h && c.t.length >= 2)
      .map(c => ({ text: c.t, row: c.r, col: c.c }))
      .filter(l => !/^\d+\./.test(l.text));

    const prompt = `Excel 컬럼과 HWPX 라벨을 시맨틱 매칭합니다.

## Excel 컬럼
${state.columns.map((c, i) => `${i + 1}. "${c}"`).join('\n')}

## HWPX 라벨
${labels.map((l, i) => `${i + 1}. "${l.text}" (위치: ${l.row}, ${l.col})`).join('\n')}

## 작업
같은 의미의 컬럼-라벨 쌍 찾기
예: "핸드폰" = "연락처", "이름" = "성명"

## 응답 (JSON만)
{
  "matches": [
    {"excelColumn": "이름", "labelText": "성명", "labelRow": 3, "labelCol": 2, "confidence": 0.9}
  ]
}`;

    try {
      const response = await this.callGemini(prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const matches = parsed.matches || [];

      const candidates: MappingCandidate[] = [];
      const cellMap = new Map<string, SlimCell>();
      for (const cell of state.table.cells) {
        cellMap.set(`${cell.r}-${cell.c}`, cell);
      }

      for (const match of matches) {
        const labelCell = cellMap.get(`${match.labelRow}-${match.labelCol}`);
        if (!labelCell) continue;

        const rightCol = match.labelCol + (labelCell.cs || 1);
        const rightCell = cellMap.get(`${match.labelRow}-${rightCol}`);

        if (rightCell && !rightCell.h) {
          candidates.push({
            excelColumn: match.excelColumn,
            hwpxRow: rightCell.r,
            hwpxCol: rightCell.c,
            labelText: match.labelText,
            confidence: match.confidence || 0.7,
            source: 'ai_excel',
            reason: `AI 시맨틱 매칭: "${match.excelColumn}" ≈ "${match.labelText}"`,
          });
        }
      }

      return candidates;
    } catch (error) {
      console.error('[AIExcel] Error:', error);
      return [];
    }
  }

  /**
   * 결과 병합
   */
  private mergeResults(state: PipelineState): MappingCandidate[] {
    const all = [
      ...state.ruleMappings,
      ...state.aiTemplateMappings,
      ...state.aiExcelMappings,
    ];

    // excelColumn 기준으로 그룹화
    const grouped = new Map<string, MappingCandidate[]>();
    for (const c of all) {
      if (!grouped.has(c.excelColumn)) {
        grouped.set(c.excelColumn, []);
      }
      grouped.get(c.excelColumn)!.push(c);
    }

    // 각 그룹에서 가장 신뢰도 높은 것 선택
    const merged: MappingCandidate[] = [];
    for (const [excelCol, candidates] of grouped) {
      candidates.sort((a, b) => b.confidence - a.confidence);
      merged.push(candidates[0]);
    }

    return merged.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 검증 및 최종화
   */
  private validateAndFinalize(state: PipelineState): {
    finalMappings: FinalMapping[];
    issues: string[];
  } {
    const issues: string[] = [];
    const finalMappings: FinalMapping[] = [];
    const usedCells = new Set<string>();
    const usedColumns = new Set<string>();

    for (const candidate of state.mergedCandidates) {
      const cellKey = `${candidate.hwpxRow}-${candidate.hwpxCol}`;

      // 중복 검사
      if (usedCells.has(cellKey)) {
        issues.push(`셀 중복: ${cellKey} - "${candidate.excelColumn}" 스킵`);
        continue;
      }
      if (usedColumns.has(candidate.excelColumn)) {
        issues.push(`컬럼 중복: "${candidate.excelColumn}" 스킵`);
        continue;
      }

      // 범위 검사
      if (candidate.hwpxRow < 0 || candidate.hwpxRow >= state.table.rows ||
          candidate.hwpxCol < 0 || candidate.hwpxCol >= state.table.cols) {
        issues.push(`범위 초과: [${candidate.hwpxRow},${candidate.hwpxCol}]`);
        continue;
      }

      // 신뢰도 검사
      if (candidate.confidence < 0.5) {
        issues.push(`낮은 신뢰도: "${candidate.excelColumn}" (${candidate.confidence})`);
        continue;
      }

      finalMappings.push({
        excelColumn: candidate.excelColumn,
        hwpxRow: candidate.hwpxRow,
        hwpxCol: candidate.hwpxCol,
      });

      usedCells.add(cellKey);
      usedColumns.add(candidate.excelColumn);
    }

    return { finalMappings, issues };
  }

  /**
   * 테이블 구조 설명 생성
   */
  private buildTableDescription(table: SlimTable): string {
    const lines: string[] = [];
    lines.push(`크기: ${table.rows}행 x ${table.cols}열\n`);

    const rowMap = new Map<number, SlimCell[]>();
    for (const cell of table.cells) {
      if (!rowMap.has(cell.r)) rowMap.set(cell.r, []);
      rowMap.get(cell.r)!.push(cell);
    }

    const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b).slice(0, 20);
    for (const rowIdx of sortedRows) {
      const cells = rowMap.get(rowIdx)!.sort((a, b) => a.c - b.c);
      for (const cell of cells) {
        const text = cell.t || '(빈셀)';
        const label = cell.h ? ' [라벨]' : '';
        lines.push(`(${cell.r},${cell.c}): "${text}"${label}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Gemini API 호출
   */
  private async callGemini(prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error('No API key');

    const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}
