import { Injectable } from '@nestjs/common';
import AdmZip from 'adm-zip';
import {
  VerificationInput,
  VerificationResult,
  VerificationGraphState,
  UnifiedCell,
  ParsedHwpxData,
  ParsedExcelRow,
  VerificationAgentResult,
  VerificationIssue,
  CellStatus,
} from '../agents/verification/types';
import { ValueMatchAgent } from '../agents/verification/value-match.agent';
import { TemplateLeakAgent } from '../agents/verification/template-leak.agent';
import { PatternAgent } from '../agents/verification/pattern.agent';
import { BaseVerificationAgent } from '../agents/verification/base-verification.agent';
import { HeaderDetectionAgent } from '../agents';

/**
 * 3-Way Diff Verification Graph Service
 *
 * LangGraph 스타일 파이프라인:
 * 1. parseTemplate (병렬)
 * 2. parseExcel (병렬)
 * 3. parseGenerated (병렬)
 * 4. buildUnifiedModel
 * 5. runAgents (병렬: ValueMatch, TemplateLeak, Pattern)
 * 6. mergeResults
 */
@Injectable()
export class VerificationGraphService {
  private readonly agents: BaseVerificationAgent[];

  constructor(
    private readonly valueMatchAgent: ValueMatchAgent,
    private readonly templateLeakAgent: TemplateLeakAgent,
    private readonly patternAgent: PatternAgent,
    private readonly headerDetectionAgent: HeaderDetectionAgent,
  ) {
    this.agents = [
      this.valueMatchAgent,
      this.templateLeakAgent,
      this.patternAgent,
    ];
  }

  /**
   * 검증 실행 (메인 엔트리포인트)
   */
  async execute(input: VerificationInput): Promise<VerificationResult> {
    const startTime = Date.now();
    console.log('[VerificationGraph] Starting 3-Way verification...');

    // 초기 상태
    const state: VerificationGraphState = {
      input,
      templateCells: new Map(),
      excelRows: [],
      generatedFiles: [],
      sampledIndices: [],
      unifiedCells: new Map(),
      agentResults: [],
    };

    // Step 1-3: 병렬 파싱
    console.log('[VerificationGraph] Step 1-3: Parsing inputs in parallel...');
    const [templateCells, excelRows, generatedFiles] = await Promise.all([
      this.nodeParseTemplate(input.templateBuffer),
      this.nodeParseExcel(input.excelBuffer, input.sheetName || ''),
      this.nodeParseGenerated(input.generatedZipBuffer),
    ]);

    state.templateCells = templateCells;
    state.excelRows = excelRows;
    state.generatedFiles = generatedFiles;

    console.log('[VerificationGraph] Parsed:', {
      templateCells: templateCells.size,
      excelRows: excelRows.length,
      generatedFiles: generatedFiles.length,
    });

    // Step 4: 샘플링 및 Unified Model 생성
    console.log('[VerificationGraph] Step 4: Building unified model...');
    const { sampledIndices, unifiedCells } = this.nodeBuildUnifiedModel(state);
    state.sampledIndices = sampledIndices;
    state.unifiedCells = unifiedCells;

    console.log('[VerificationGraph] Sampled:', sampledIndices.length, 'people');

    // Step 5: Agent 병렬 실행
    console.log('[VerificationGraph] Step 5: Running verification agents in parallel...');
    const agentResults = await this.nodeRunAgents(state);
    state.agentResults = agentResults;

    // Step 6: 결과 병합
    console.log('[VerificationGraph] Step 6: Merging results...');
    const finalResult = await this.nodeMergeResults(state, startTime);

    console.log('[VerificationGraph] Verification complete:', {
      status: finalResult.status,
      accuracy: finalResult.accuracy.toFixed(1) + '%',
      issues: finalResult.allIssues.length,
    });

    return finalResult;
  }

  /**
   * Node: 템플릿 파싱
   */
  private async nodeParseTemplate(buffer: Buffer): Promise<Map<string, string>> {
    const cells = new Map<string, string>();

    try {
      const zip = new AdmZip(buffer);
      const sectionEntry = zip.getEntry('Contents/section0.xml');

      if (!sectionEntry) {
        console.warn('[VerificationGraph] Template section0.xml not found');
        return cells;
      }

      const xmlContent = sectionEntry.getData().toString('utf-8');
      this.extractCellsFromXml(xmlContent, cells);
    } catch (error) {
      console.error('[VerificationGraph] Error parsing template:', error);
    }

    return cells;
  }

  /**
   * Node: Excel 파싱
   */
  private async nodeParseExcel(buffer: Buffer, sheetName: string): Promise<ParsedExcelRow[]> {
    const rows: ParsedExcelRow[] = [];

    try {
      // HeaderDetectionAgent 사용
      const headerAnalysis = await this.headerDetectionAgent.analyze(buffer, sheetName);

      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.default.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

      const targetSheetName = sheetName && sheetName.trim() !== ''
        ? sheetName
        : workbook.worksheets[0]?.name;

      const worksheet = workbook.getWorksheet(targetSheetName);
      if (!worksheet) return rows;

      const columnMap = headerAnalysis.columns.map((c) => ({
        colIndex: c.colIndex,
        name: c.name,
      }));

      worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
        if (rowNum < headerAnalysis.dataStartRow) return;

        const data: Record<string, string> = {};
        let hasData = false;

        for (const { colIndex, name } of columnMap) {
          const cell = row.getCell(colIndex);
          const value = this.extractCellValue(cell.value);
          if (value) {
            hasData = true;
            data[name] = value;
          }
        }

        if (hasData) {
          const personName = data['성명'] || data['이름'] || `Row${rowNum}`;
          rows.push({
            rowIndex: rowNum,
            personName,
            data,
          });
        }
      });
    } catch (error) {
      console.error('[VerificationGraph] Error parsing Excel:', error);
    }

    return rows;
  }

  /**
   * Node: 생성된 HWPX 파일들 파싱
   */
  private async nodeParseGenerated(zipBuffer: Buffer): Promise<ParsedHwpxData[]> {
    const files: ParsedHwpxData[] = [];

    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      for (const entry of entries) {
        if (!entry.entryName.endsWith('.hwpx')) continue;

        try {
          const hwpxBuffer = entry.getData();
          const hwpxZip = new AdmZip(hwpxBuffer);
          const sectionEntry = hwpxZip.getEntry('Contents/section0.xml');

          if (!sectionEntry) continue;

          const xmlContent = sectionEntry.getData().toString('utf-8');
          const cells = new Map<string, string>();
          this.extractCellsFromXml(xmlContent, cells);

          // 파일명에서 이름 추출
          const fileName = entry.entryName;
          const personName = fileName.replace('.hwpx', '');

          files.push({
            fileName,
            personName,
            cells,
          });
        } catch (e) {
          console.warn(`[VerificationGraph] Error parsing ${entry.entryName}:`, e);
        }
      }
    } catch (error) {
      console.error('[VerificationGraph] Error parsing generated ZIP:', error);
    }

    return files;
  }

  /**
   * Node: Unified Model 생성 (샘플링 포함)
   */
  private nodeBuildUnifiedModel(state: VerificationGraphState): {
    sampledIndices: number[];
    unifiedCells: Map<number, UnifiedCell[]>;
  } {
    const { input, templateCells, excelRows, generatedFiles } = state;
    const options = input.options || { sampleStrategy: 'random' };

    // 샘플링
    const totalCount = excelRows.length;
    let sampleSize: number;

    if (options.sampleStrategy === 'all') {
      sampleSize = totalCount;
    } else if (options.sampleSize) {
      sampleSize = Math.min(options.sampleSize, totalCount);
    } else {
      // 자동 샘플링
      if (totalCount <= 20) {
        sampleSize = totalCount;
      } else if (totalCount <= 100) {
        sampleSize = Math.max(10, Math.ceil(totalCount * 0.2));
      } else {
        sampleSize = Math.min(30, Math.ceil(totalCount * 0.1));
      }
    }

    // 샘플 인덱스 선택
    let sampledIndices: number[];
    if (options.sampleStrategy === 'first_n') {
      sampledIndices = Array.from({ length: sampleSize }, (_, i) => i);
    } else {
      // 랜덤 샘플링
      const indices = Array.from({ length: totalCount }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      sampledIndices = indices.slice(0, sampleSize);
    }

    // Unified Cell Model 생성
    const unifiedCells = new Map<number, UnifiedCell[]>();

    for (const idx of sampledIndices) {
      const excelRow = excelRows[idx];
      if (!excelRow) continue;

      // 해당 사람의 생성된 파일 찾기
      const generatedFile = generatedFiles.find(
        (f) => f.personName === excelRow.personName ||
               f.personName.includes(excelRow.personName) ||
               excelRow.personName.includes(f.personName)
      );

      const cells: UnifiedCell[] = [];

      for (const mapping of input.mappings) {
        const cellKey = `${mapping.hwpxRow}-${mapping.hwpxCol}`;

        const templateValue = templateCells.get(cellKey) || '';
        const excelValue = excelRow.data[mapping.excelColumn] || '';
        const generatedValue = generatedFile?.cells.get(cellKey) || '';

        const status = this.determineCellStatus(templateValue, excelValue, generatedValue);

        cells.push({
          hwpxRow: mapping.hwpxRow,
          hwpxCol: mapping.hwpxCol,
          fieldName: mapping.excelColumn,
          excelColumn: mapping.excelColumn,
          templateValue,
          excelValue,
          generatedValue,
          status,
        });
      }

      unifiedCells.set(idx, cells);
    }

    return { sampledIndices, unifiedCells };
  }

  /**
   * Node: Agent 병렬 실행
   */
  private async nodeRunAgents(state: VerificationGraphState): Promise<VerificationAgentResult[]> {
    const { excelRows, sampledIndices, unifiedCells } = state;
    const enabledAgents = state.input.options?.enabledAgents;

    // 사용할 Agent 필터링
    const agentsToRun = enabledAgents
      ? this.agents.filter((a) => enabledAgents.includes(a.name))
      : this.agents;

    // 모든 Agent를 병렬로 실행
    const agentPromises = agentsToRun.map(async (agent) => {
      const startTime = Date.now();
      const allIssues: VerificationIssue[] = [];

      // 각 샘플에 대해 검증
      for (const idx of sampledIndices) {
        const excelRow = excelRows[idx];
        const cells = unifiedCells.get(idx);

        if (!excelRow || !cells) continue;

        const result = await agent.verify(idx, excelRow.personName, cells);
        allIssues.push(...result.issues);
      }

      const executionTimeMs = Date.now() - startTime;

      return {
        agentName: agent.name,
        description: agent.description,
        status: this.determineAgentStatus(allIssues),
        issueCount: allIssues.length,
        issues: allIssues,
        executionTimeMs,
      } as VerificationAgentResult;
    });

    return Promise.all(agentPromises);
  }

  /**
   * Node: 결과 병합
   */
  private async nodeMergeResults(
    state: VerificationGraphState,
    startTime: number,
  ): Promise<VerificationResult> {
    const { excelRows, sampledIndices, agentResults, input } = state;

    // 모든 이슈 수집 (중복 제거)
    const issueMap = new Map<string, VerificationIssue>();
    for (const agentResult of agentResults) {
      for (const issue of agentResult.issues) {
        const key = `${issue.personIndex}-${issue.cell.hwpxRow}-${issue.cell.hwpxCol}`;
        if (!issueMap.has(key)) {
          issueMap.set(key, issue);
        }
      }
    }
    const allIssues = Array.from(issueMap.values());

    // 상태 결정
    const hasCritical = allIssues.some((i) => i.severity === 'critical');
    const hasWarning = allIssues.some((i) => i.severity === 'warning');
    const status = hasCritical ? 'fail' : hasWarning ? 'warning' : 'pass';

    // 정확도 계산
    const totalChecks = sampledIndices.length * input.mappings.length;
    const failedChecks = allIssues.length;
    const accuracy = totalChecks > 0 ? ((totalChecks - failedChecks) / totalChecks) * 100 : 100;

    // 샘플링된 이름 목록
    const sampledNames = sampledIndices.map((idx) => excelRows[idx]?.personName || `Row${idx}`);

    // AI 요약 생성
    const aiSummary = input.options?.skipAiSummary
      ? ''
      : this.generateSummary(allIssues, agentResults, accuracy);

    return {
      status,
      sampledCount: sampledIndices.length,
      totalCount: excelRows.length,
      sampledNames,
      accuracy,
      agentResults,
      allIssues,
      aiSummary,
      totalExecutionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * XML에서 셀 값 추출
   */
  private extractCellsFromXml(xmlContent: string, cells: Map<string, string>): void {
    const tcRegex = /<hp:tc[^>]*>([\s\S]*?)<\/hp:tc>/g;
    let match;

    while ((match = tcRegex.exec(xmlContent)) !== null) {
      const tcContent = match[1];

      const colAddrMatch = tcContent.match(/colAddr="(\d+)"/);
      const rowAddrMatch = tcContent.match(/rowAddr="(\d+)"/);

      if (!colAddrMatch || !rowAddrMatch) continue;

      const col = parseInt(colAddrMatch[1], 10);
      const row = parseInt(rowAddrMatch[1], 10);

      const textMatches = tcContent.match(/<hp:t>([^<]*)<\/hp:t>/g);
      let text = '';
      if (textMatches) {
        text = textMatches
          .map((t) => t.replace(/<hp:t>|<\/hp:t>/g, ''))
          .join('')
          .trim();
      }

      cells.set(`${row}-${col}`, text);
    }
  }

  /**
   * 셀 값 추출 (ExcelJS)
   */
  private extractCellValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString().split('T')[0];
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if ('richText' in obj && Array.isArray(obj.richText)) {
        return (obj.richText as Array<{ text: string }>).map((t) => t.text).join('');
      }
      if ('result' in obj) return String(obj.result);
      if ('text' in obj) return String(obj.text);
    }
    return String(value);
  }

  /**
   * 셀 상태 결정
   */
  private determineCellStatus(
    templateValue: string,
    excelValue: string,
    generatedValue: string,
  ): CellStatus {
    const normalize = (v: string) => (v || '').trim();
    const tpl = normalize(templateValue);
    const excel = normalize(excelValue);
    const gen = normalize(generatedValue);

    // 둘 다 비어있으면 OK
    if (!excel && !gen) return 'empty_ok';

    // Excel 값과 Generated 값이 일치
    if (excel === gen) return 'match';

    // Excel 빈값인데 템플릿 값이 Generated에 남아있음
    if (!excel && tpl && gen === tpl) return 'template_leak';

    // Excel 값이 있는데 Generated가 비어있음
    if (excel && !gen) return 'missing';

    // 그 외 불일치
    return 'mismatch';
  }

  /**
   * Agent 상태 결정
   */
  private determineAgentStatus(issues: VerificationIssue[]): 'pass' | 'warning' | 'fail' {
    if (issues.length === 0) return 'pass';
    if (issues.some((i) => i.severity === 'critical')) return 'fail';
    return 'warning';
  }

  /**
   * 요약 생성 (AI 없이 규칙 기반)
   */
  private generateSummary(
    issues: VerificationIssue[],
    agentResults: VerificationAgentResult[],
    accuracy: number,
  ): string {
    if (issues.length === 0) {
      return `검증 완료: 모든 샘플에서 데이터가 정확하게 매핑되었습니다. (정확도: ${accuracy.toFixed(1)}%)`;
    }

    const summaryParts: string[] = [];

    // 이슈 유형별 집계
    const templateLeaks = issues.filter((i) => i.cell.status === 'template_leak');
    const mismatches = issues.filter((i) => i.cell.status === 'mismatch');
    const missing = issues.filter((i) => i.cell.status === 'missing');

    if (templateLeaks.length > 0) {
      const fields = [...new Set(templateLeaks.map((i) => i.cell.fieldName))];
      summaryParts.push(
        `템플릿 값 누수 ${templateLeaks.length}건 발견 (필드: ${fields.slice(0, 3).join(', ')}${fields.length > 3 ? ' 외' : ''})`
      );
    }

    if (mismatches.length > 0) {
      const fields = [...new Set(mismatches.map((i) => i.cell.fieldName))];
      summaryParts.push(
        `값 불일치 ${mismatches.length}건 발견 (필드: ${fields.slice(0, 3).join(', ')}${fields.length > 3 ? ' 외' : ''})`
      );
    }

    if (missing.length > 0) {
      summaryParts.push(`누락된 값 ${missing.length}건 발견`);
    }

    return `검증 완료 (정확도: ${accuracy.toFixed(1)}%): ${summaryParts.join(', ')}`;
  }
}
