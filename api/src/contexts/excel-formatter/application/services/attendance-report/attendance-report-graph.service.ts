/**
 * AttendanceReportGraphService
 * LangGraph.js 기반 출결 보고서 생성 파이프라인
 *
 * 5-Node Pipeline: Parse → Map → Transform → Calculate → Render
 */
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AttendanceGraphState,
  AttendanceMappingResult,
  StudentRow,
  StudentRenderData,
  ProgressInfo,
  AttendanceRule,
} from './types';
import { PIPELINE_PROGRESS } from './attendance-constants';
import { AttendanceMappingService } from './attendance-mapping.service';
import { AttendanceCalculationService } from './attendance-calculation.service';
import { EXCEL_PARSER_PORT } from '../../ports';
import type { ExcelParserPort } from '../../ports';

// GraphAnnotation and GraphState are created lazily inside execute() to avoid
// loading @langchain/langgraph at module init time (saves ~50MB RSS on startup).

@Injectable()
export class AttendanceReportGraphService {
  constructor(
    private readonly configService: ConfigService,
    private readonly mappingService: AttendanceMappingService,
    private readonly calculationService: AttendanceCalculationService,
    @Inject(EXCEL_PARSER_PORT)
    private readonly excelParser: ExcelParserPort,
  ) {}

  /**
   * 파이프라인 실행
   */
  async execute(
    templateBuffer: Buffer,
    dataBuffer: Buffer,
    companyId: string,
    sheetName?: string,
    onProgress?: (info: ProgressInfo) => void,
    options?: {
      dataSheetName?: string;
      precomputedMappings?: Array<{ templateField: string; dataColumn: string }>;
    },
  ): Promise<{
    outputBuffer: Buffer;
    studentCount: number;
    mappedCount: number;
  }> {
    console.log('[AttendanceGraph] Starting pipeline...', {
      sheetName,
      dataSheetName: options?.dataSheetName,
      precomputedMappings: options?.precomputedMappings?.length ?? 0,
    });

    // Lazy import to avoid loading LangGraph at server startup
    const { Annotation, StateGraph } = await import('@langchain/langgraph');

    const GraphAnnotation = Annotation.Root({
      rawDataBuffer: Annotation<Buffer>,
      templateBuffer: Annotation<Buffer>,
      companyId: Annotation<string>,
      sheetName: Annotation<string | undefined>,
      dataSheetName: Annotation<string | undefined>,
      precomputedMappings: Annotation<Array<{ templateField: string; dataColumn: string }>>,
      templateColumns: Annotation<string[]>,
      dataColumns: Annotation<string[]>,
      templateSampleData: Annotation<Record<string, unknown>[]>,
      dataSampleData: Annotation<Record<string, unknown>[]>,
      dataMetadata: Annotation<Record<string, string>>,
      mappings: Annotation<AttendanceMappingResult[]>,
      unmappedColumns: Annotation<string[]>,
      students: Annotation<StudentRow[]>,
      rule: Annotation<AttendanceRule | null>,
      renderedStudents: Annotation<StudentRenderData[]>,
      outputBuffer: Annotation<Buffer | null>,
      progress: Annotation<number>,
      currentStep: Annotation<string>,
      errors: Annotation<string[]>,
    });

    type GraphState = typeof GraphAnnotation.State;

    const emitProgress = (step: string, progress: number, message: string) => {
      if (onProgress) {
        onProgress({ step, progress, message, timestamp: new Date() });
      }
    };

    // Build the graph
    const graph = new StateGraph(GraphAnnotation)
      .addNode('parse', async (state: GraphState) => {
        emitProgress('parse', PIPELINE_PROGRESS.PARSE.start, 'Excel 파일 파싱 중...');
        return this.nodeParse(state);
      })
      .addNode('map', async (state: GraphState) => {
        emitProgress('map', PIPELINE_PROGRESS.MAP.start, '컬럼 매핑 중...');
        return this.nodeMap(state);
      })
      .addNode('transform', async (state: GraphState) => {
        emitProgress('transform', PIPELINE_PROGRESS.TRANSFORM.start, '데이터 변환 중...');
        return this.nodeTransform(state);
      })
      .addNode('calculate', async (state: GraphState) => {
        emitProgress('calculate', PIPELINE_PROGRESS.CALCULATE.start, '출결 계산 중...');
        return this.nodeCalculate(state);
      })
      .addNode('render', async (state: GraphState) => {
        emitProgress('render', PIPELINE_PROGRESS.RENDER.start, '보고서 생성 중...');
        return this.nodeRender(state);
      })
      .addEdge('__start__', 'parse')
      .addEdge('parse', 'map')
      .addEdge('map', 'transform')
      .addEdge('transform', 'calculate')
      .addEdge('calculate', 'render')
      .addEdge('render', '__end__')
      .compile();

    // Initial state
    const initialState: Partial<GraphState> = {
      rawDataBuffer: dataBuffer,
      templateBuffer: templateBuffer,
      companyId,
      sheetName,
      dataSheetName: options?.dataSheetName,
      precomputedMappings: options?.precomputedMappings || [],
      templateColumns: [],
      dataColumns: [],
      templateSampleData: [],
      dataSampleData: [],
      dataMetadata: {},
      mappings: [],
      unmappedColumns: [],
      students: [],
      rule: null,
      renderedStudents: [],
      outputBuffer: null,
      progress: 0,
      currentStep: 'init',
      errors: [],
    };

    const finalState = await graph.invoke(initialState);

    if (!finalState.outputBuffer) {
      throw new Error('Pipeline failed: no output generated. Errors: ' + (finalState.errors || []).join(', '));
    }

    emitProgress('completed', 100, '보고서 생성 완료');

    return {
      outputBuffer: finalState.outputBuffer,
      studentCount: finalState.students?.length ?? 0,
      mappedCount: finalState.mappings?.length ?? 0,
    };
  }

  // ==========================================
  // Node 1: Parse - Excel 파싱
  // ==========================================
  private async nodeParse(state: any): Promise<Partial<any>> {
    console.log('[Node:Parse] Parsing Excel files...');

    try {
      const ExcelJS = await import('exceljs');

      // --- Parse template file ---
      const templateWorkbook = new ExcelJS.default.Workbook();
      await templateWorkbook.xlsx.load(state.templateBuffer as unknown as ArrayBuffer);
      const templateSheetName = state.sheetName;
      const templateSheet = templateSheetName
        ? templateWorkbook.getWorksheet(templateSheetName)
        : templateWorkbook.worksheets[0];
      if (!templateSheet) throw new Error(`템플릿 파일에서 시트를 찾을 수 없습니다: ${templateSheetName || '(첫 번째 시트)'}`);

      const templateColumns = this.extractColumns(templateSheet);
      const templateSampleData = this.extractSampleData(templateSheet, templateColumns, 2);

      // --- Parse data file (use dataSheetName, NOT sheetName) ---
      const dataWorkbook = new ExcelJS.default.Workbook();
      await dataWorkbook.xlsx.load(state.rawDataBuffer as unknown as ArrayBuffer);
      const dataSheetTarget = state.dataSheetName;
      const dataSheet = dataSheetTarget
        ? dataWorkbook.getWorksheet(dataSheetTarget)
        : dataWorkbook.worksheets[0];
      if (!dataSheet) throw new Error(`데이터 파일에서 시트를 찾을 수 없습니다: ${dataSheetTarget || '(첫 번째 시트)'}`);

      // Smart header detection (from hwpx-mapping-graph.service.ts pattern)
      const { columns: dataColumns, headerRowNum } = this.detectSmartHeader(dataSheet);
      const dataSampleData = this.extractSampleData(dataSheet, dataColumns, 5, headerRowNum + 1);

      // Extract metadata from the data file (rows above header)
      const dataMetadata = this.extractMetadata(dataSheet, headerRowNum);

      console.log(`[Node:Parse] Template: ${templateColumns.length} cols, Data: ${dataColumns.length} cols`);
      console.log(`[Node:Parse] Data header at row ${headerRowNum}, metadata keys: ${Object.keys(dataMetadata).join(', ')}`);

      return {
        templateColumns,
        dataColumns,
        templateSampleData,
        dataSampleData,
        dataMetadata,
        progress: PIPELINE_PROGRESS.PARSE.end,
        currentStep: 'parse_done',
      };
    } catch (error) {
      console.error('[Node:Parse] Error:', error);
      return {
        errors: [...(state.errors || []), `Parse error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  // ==========================================
  // Node 2: Map - 컬럼 매핑
  // ==========================================
  private async nodeMap(state: any): Promise<Partial<any>> {
    console.log('[Node:Map] Mapping columns...');

    // If precomputed mappings from frontend exist, use them directly (skip AI)
    if (state.precomputedMappings?.length > 0) {
      console.log(`[Node:Map] Using ${state.precomputedMappings.length} precomputed mappings from frontend`);
      const mappings: AttendanceMappingResult[] = state.precomputedMappings.map(
        (m: { templateField: string; dataColumn: string }) => ({
          templateField: m.templateField,
          dataColumn: m.dataColumn,
          confidence: 1.0,
          method: 'precomputed' as const,
        }),
      );
      const mappedTemplateFields = new Set(mappings.map((m: AttendanceMappingResult) => m.templateField));
      const unmappedColumns = (state.templateColumns || []).filter(
        (c: string) => !mappedTemplateFields.has(c),
      );
      console.log(`[Node:Map] Precomputed: ${mappings.length} mapped, ${unmappedColumns.length} unmapped`);
      return {
        mappings,
        unmappedColumns,
        progress: PIPELINE_PROGRESS.MAP.end,
        currentStep: 'map_done',
      };
    }

    if (!state.templateColumns?.length || !state.dataColumns?.length) {
      return {
        errors: [...(state.errors || []), 'Map error: 컬럼이 비어있습니다.'],
      };
    }

    // Retry up to 3 times (Gemini AI calls can fail transiently)
    const result = await this.executeWithRetry(
      () =>
        this.mappingService.generateMappings(
          state.templateColumns,
          state.dataColumns,
          state.dataMetadata,
          state.dataSampleData,
          state.templateSampleData,
        ),
      3,
      'Map',
    );

    if (!result) {
      return {
        errors: [...(state.errors || []), 'Map error: 매핑 실패 (3회 재시도 후)'],
      };
    }

    const { mappings, unmappedColumns } = result;
    console.log(`[Node:Map] Mapped: ${mappings.length}/${state.templateColumns.length}, Unmapped: ${unmappedColumns.length}`);

    return {
      mappings,
      unmappedColumns,
      progress: PIPELINE_PROGRESS.MAP.end,
      currentStep: 'map_done',
    };
  }

  // ==========================================
  // Node 3: Transform - 데이터 변환
  // ==========================================
  private async nodeTransform(state: any): Promise<Partial<any>> {
    console.log('[Node:Transform] Transforming data...');

    if (!state.mappings?.length) {
      return {
        errors: [...(state.errors || []), 'Transform error: 매핑 결과가 없습니다.'],
      };
    }

    try {
      const ExcelJS = await import('exceljs');
      const dataWorkbook = new ExcelJS.default.Workbook();
      await dataWorkbook.xlsx.load(state.rawDataBuffer as unknown as ArrayBuffer);
      const dataSheet = state.dataSheetName
        ? dataWorkbook.getWorksheet(state.dataSheetName)
        : dataWorkbook.worksheets[0];
      if (!dataSheet) throw new Error('데이터 시트를 찾을 수 없습니다.');

      const { headerRowNum } = this.detectSmartHeader(dataSheet);

      // Build column index map (data column name -> column number)
      const headerRow = dataSheet.getRow(headerRowNum);
      const colIndexMap = new Map<string, number>();
      headerRow.eachCell({ includeEmpty: false }, (cell: any, colNumber: number) => {
        const text = this.getCellText(cell);
        if (text) colIndexMap.set(text, colNumber);
      });

      // Classify mappings
      const attendanceMappings: AttendanceMappingResult[] = [];
      const identityMappings: AttendanceMappingResult[] = [];
      const metadataMappings: AttendanceMappingResult[] = [];
      const summaryMappings: AttendanceMappingResult[] = [];

      for (const m of state.mappings) {
        if (m.isMetadata) {
          metadataMappings.push(m);
        } else if (AttendanceMappingService.isAttendanceColumn(m.dataColumn)) {
          attendanceMappings.push(m);
        } else if (AttendanceMappingService.isSummaryColumn(m.dataColumn)) {
          summaryMappings.push(m);
        } else {
          identityMappings.push(m);
        }
      }

      // Extract students from data rows
      const students: StudentRow[] = [];
      const totalRows = dataSheet.rowCount;

      // Detect 2-row-per-student pattern (odd=dates, even=symbols)
      const is2RowPattern = this.detect2RowPattern(dataSheet, headerRowNum, attendanceMappings, colIndexMap);

      const rowStep = is2RowPattern ? 2 : 1;
      for (let rowNum = headerRowNum + 1; rowNum <= totalRows; rowNum += rowStep) {
        const row = dataSheet.getRow(rowNum);

        // Skip empty rows
        const hasData = identityMappings.some(m => {
          const colNum = colIndexMap.get(m.dataColumn);
          return colNum && this.getCellText(row.getCell(colNum)).length > 0;
        });
        if (!hasData) continue;

        const student: StudentRow = {
          identity: {},
          attendance: {},
          metadata: {},
          rawSummary: {},
        };

        // Identity fields
        for (const m of identityMappings) {
          const colNum = colIndexMap.get(m.dataColumn);
          if (colNum) {
            student.identity[m.templateField] = this.getCellText(row.getCell(colNum));
          }
        }

        // Attendance symbols
        if (is2RowPattern) {
          // 2-row pattern: current row has dates, next row has symbols
          const symbolRow = dataSheet.getRow(rowNum + 1);
          for (const m of attendanceMappings) {
            const colNum = colIndexMap.get(m.dataColumn);
            if (colNum) {
              const symbol = this.getCellText(symbolRow.getCell(colNum));
              student.attendance[m.templateField] = symbol;
            }
          }
        } else {
          // Single-row pattern: symbol is in the same row
          for (const m of attendanceMappings) {
            const colNum = colIndexMap.get(m.dataColumn);
            if (colNum) {
              student.attendance[m.templateField] = this.getCellText(row.getCell(colNum));
            }
          }
        }

        // Metadata (from metadata dict or extracted values)
        for (const m of metadataMappings) {
          if (m.metadataValue) {
            student.metadata[m.templateField] = m.metadataValue;
          }
        }

        // Summary (for reference)
        for (const m of summaryMappings) {
          const colNum = colIndexMap.get(m.dataColumn);
          if (colNum) {
            student.rawSummary[m.templateField] = this.getCellText(row.getCell(colNum));
          }
        }

        students.push(student);
      }

      console.log(`[Node:Transform] Extracted ${students.length} students (2-row pattern: ${is2RowPattern})`);

      return {
        students,
        progress: PIPELINE_PROGRESS.TRANSFORM.end,
        currentStep: 'transform_done',
      };
    } catch (error) {
      console.error('[Node:Transform] Error:', error);
      return {
        errors: [...(state.errors || []), `Transform error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  // ==========================================
  // Node 4: Calculate - 출결 계산 + 수식 생성
  // ==========================================
  private async nodeCalculate(state: any): Promise<Partial<any>> {
    console.log('[Node:Calculate] Calculating attendance...');

    if (!state.students?.length) {
      return {
        errors: [...(state.errors || []), 'Calculate error: 학생 데이터가 없습니다.'],
      };
    }

    try {
      // Template 분석: 출결 데이터가 시작되는 열과 끝나는 열 파악
      const attendanceCols = state.templateColumns.filter(c =>
        AttendanceMappingService.isAttendanceColumn(c),
      );
      const firstAttIdx = state.templateColumns.indexOf(attendanceCols[0]);
      const lastAttIdx = state.templateColumns.indexOf(attendanceCols[attendanceCols.length - 1]);

      // Excel 열 문자로 변환 (0-indexed -> A, B, C, ...)
      const startCol = this.numToCol(firstAttIdx + 1); // +1 for 1-indexed
      const endCol = this.numToCol(lastAttIdx + 1);
      const dataStartRow = 5; // 기본값, 실제는 템플릿 분석 필요

      const { renderedStudents, rule } = await this.calculationService.processStudents(
        state.students,
        state.companyId,
        startCol,
        endCol,
        dataStartRow,
      );

      console.log(`[Node:Calculate] Processed ${renderedStudents.length} students with rule: ${rule?.name || 'default'}`);

      return {
        rule,
        renderedStudents,
        progress: PIPELINE_PROGRESS.CALCULATE.end,
        currentStep: 'calculate_done',
      };
    } catch (error) {
      console.error('[Node:Calculate] Error:', error);
      return {
        errors: [...(state.errors || []), `Calculate error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  // ==========================================
  // Node 5: Render - 템플릿에 데이터 삽입
  // ==========================================
  private async nodeRender(state: any): Promise<Partial<any>> {
    console.log('[Node:Render] Rendering report...');

    if (!state.renderedStudents?.length) {
      return {
        errors: [...(state.errors || []), 'Render error: 렌더링할 데이터가 없습니다.'],
      };
    }

    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.default.Workbook();
      await workbook.xlsx.load(state.templateBuffer as unknown as ArrayBuffer);
      const templateSheetName = state.sheetName;
      const sheet = templateSheetName
        ? workbook.getWorksheet(templateSheetName)
        : workbook.worksheets[0];
      if (!sheet) throw new Error('템플릿 시트를 찾을 수 없습니다.');

      // Break shared formulas to prevent ExcelJS errors when modifying cells
      // "Shared Formula master must exist above and or left of clone"
      this.breakSharedFormulas(sheet);

      // Find data start row (first empty row after headers)
      const { headerRowNum: templateHeaderRow } = this.detectSmartHeader(sheet);
      const dataStartRow = templateHeaderRow + 1;

      // Template column index map
      const templateHeaderCells = sheet.getRow(templateHeaderRow);
      const templateColMap = new Map<string, number>();
      templateHeaderCells.eachCell({ includeEmpty: false }, (cell: any, colNumber: number) => {
        const text = this.getCellText(cell);
        if (text) templateColMap.set(text, colNumber);
      });

      // Clear existing data rows and prepare space
      const availableRows = sheet.rowCount - dataStartRow + 1;
      const needed = state.renderedStudents.length;
      if (needed > availableRows) {
        for (let i = 0; i < needed - availableRows; i++) {
          sheet.insertRow(dataStartRow + availableRows + i, []);
        }
      }

      // Fill data
      for (let i = 0; i < state.renderedStudents.length; i++) {
        const student = state.renderedStudents[i];
        const rowNum = dataStartRow + i;
        const row = sheet.getRow(rowNum);

        // Identity fields
        for (const [field, value] of Object.entries(student.identity)) {
          const colNum = templateColMap.get(field);
          if (colNum) {
            row.getCell(colNum).value = value as string;
          }
        }

        // Attendance symbols
        for (const [field, symbol] of Object.entries(student.attendance)) {
          const colNum = templateColMap.get(field);
          if (colNum) {
            row.getCell(colNum).value = symbol as string;
          }
        }

        // Metadata fields
        for (const [field, value] of Object.entries(student.metadata)) {
          const colNum = templateColMap.get(field);
          if (colNum) {
            row.getCell(colNum).value = value as string;
          }
        }

        // Summary fields with formulas
        const summaryFieldMap: Record<string, keyof typeof student.formulas> = {};
        for (const col of state.templateColumns) {
          if (AttendanceMappingService.isSummaryColumn(col)) {
            const normalizedCol = col.toLowerCase();
            if (normalizedCol.includes('출석') && normalizedCol.includes('률')) {
              if (normalizedCol.includes('실')) {
                summaryFieldMap[col] = 'realAttendanceRate';
              } else {
                summaryFieldMap[col] = 'attendanceRate';
              }
            } else if (normalizedCol.includes('출석') || normalizedCol.includes('y')) {
              summaryFieldMap[col] = 'attended';
            } else if (normalizedCol.includes('결석') || normalizedCol.includes('n')) {
              summaryFieldMap[col] = 'absent';
            } else if (normalizedCol.includes('공결') || normalizedCol.includes('bz')) {
              summaryFieldMap[col] = 'excused';
            } else if (normalizedCol.includes('미참석')) {
              summaryFieldMap[col] = 'notAttended';
            } else if (normalizedCol.includes('회차')) {
              summaryFieldMap[col] = 'totalSessions';
            }
          }
        }

        for (const [field, formulaKey] of Object.entries(summaryFieldMap)) {
          const colNum = templateColMap.get(field);
          if (colNum && student.formulas[formulaKey]) {
            row.getCell(colNum).value = { formula: student.formulas[formulaKey] } as any;
          }
        }

        row.commit();
      }

      // Generate output buffer
      const outputBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

      console.log(`[Node:Render] Report generated: ${state.renderedStudents.length} students`);

      return {
        outputBuffer,
        progress: PIPELINE_PROGRESS.RENDER.end,
        currentStep: 'render_done',
      };
    } catch (error) {
      console.error('[Node:Render] Error:', error);
      return {
        errors: [...(state.errors || []), `Render error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  // ==========================================
  // Helper methods
  // ==========================================

  /**
   * Break shared formulas in the worksheet to prevent ExcelJS errors
   * when modifying cells that are part of a shared formula group.
   */
  private breakSharedFormulas(sheet: any): void {
    let converted = 0;
    try {
      sheet.eachRow({ includeEmpty: false }, (row: any) => {
        row.eachCell({ includeEmpty: false }, (cell: any) => {
          try {
            // Access internal _value model for shared formula detection
            const internalModel = cell._value?.model;
            if (!internalModel) return;

            const isSharedMaster = internalModel.shareType === 'master';
            const isSharedClone = internalModel.shareType === 'shared';
            const hasSharedRef = internalModel.sharedFormula !== undefined;

            if (isSharedMaster || isSharedClone || hasSharedRef) {
              if (isSharedMaster && internalModel.formula) {
                // Master cell: keep formula as regular (non-shared) formula
                cell.value = { formula: internalModel.formula, result: internalModel.result };
              } else {
                // Clone cell: has no own formula, use cached result value
                cell.value = internalModel.result ?? null;
              }
              converted++;
            }
          } catch {
            // Last resort: force clear the cell's formula
            try { cell.value = null; } catch { /* skip */ }
          }
        });
      });
    } catch (error) {
      console.warn('[Node:Render] breakSharedFormulas error:', error instanceof Error ? error.message : error);
    }
    console.log(`[Node:Render] Converted ${converted} shared formula cells`);
  }

  private getCellText(cell: any): string {
    const value = cell?.value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && 'richText' in value) {
      return (value.richText || []).map((t: any) => t.text).join('').trim();
    }
    if (typeof value === 'object' && 'result' in value) {
      return String(value.result).trim();
    }
    return String(value).trim();
  }

  private extractColumns(sheet: any): string[] {
    const { columns } = this.detectSmartHeader(sheet);
    return columns;
  }

  private detectSmartHeader(sheet: any): { columns: string[]; headerRowNum: number } {
    const rows: Array<{ rowNum: number; values: string[]; score: number }> = [];

    for (let rowNum = 1; rowNum <= Math.min(10, sheet.rowCount); rowNum++) {
      const row = sheet.getRow(rowNum);
      const values: string[] = [];
      let nonEmptyCount = 0;
      let hasShortLabels = 0;
      let hasSectionMarkers = 0;

      row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        const trimmed = this.getCellText(cell);
        values[colNumber - 1] = trimmed;
        if (trimmed.length > 0) {
          nonEmptyCount++;
          if (trimmed.length >= 2 && trimmed.length <= 10) hasShortLabels++;
          if (/^\d+\./.test(trimmed)) hasSectionMarkers++;
        }
      });

      const score = nonEmptyCount * 2 + hasShortLabels * 3 - hasSectionMarkers * 10;
      if (nonEmptyCount >= 3) {
        rows.push({ rowNum, values, score });
      }
    }

    rows.sort((a, b) => b.score - a.score);

    if (rows.length === 0) {
      return { columns: [], headerRowNum: 1 };
    }

    const headerRow = rows[0];
    const columns = headerRow.values.filter(v => v && v.length > 0 && v !== 'undefined');

    return { columns, headerRowNum: headerRow.rowNum };
  }

  private extractSampleData(
    sheet: any,
    columns: string[],
    maxRows: number,
    startRow?: number,
  ): Record<string, unknown>[] {
    const { headerRowNum } = this.detectSmartHeader(sheet);
    const dataStartRow = startRow ?? headerRowNum + 1;
    const samples: Record<string, unknown>[] = [];

    for (let rowNum = dataStartRow; rowNum < dataStartRow + maxRows && rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      const record: Record<string, unknown> = {};
      let hasData = false;

      row.eachCell({ includeEmpty: false }, (cell: any, colNumber: number) => {
        const colName = columns[colNumber - 1];
        if (colName) {
          record[colName] = this.getCellText(cell);
          hasData = true;
        }
      });

      if (hasData) samples.push(record);
    }

    return samples;
  }

  private extractMetadata(sheet: any, headerRowNum: number): Record<string, string> {
    const metadata: Record<string, string> = {};

    // Scan rows above header for key-value pairs
    for (let rowNum = 1; rowNum < headerRowNum; rowNum++) {
      const row = sheet.getRow(rowNum);
      const cells: string[] = [];

      row.eachCell({ includeEmpty: false }, (cell: any) => {
        const text = this.getCellText(cell);
        if (text.length > 0) cells.push(text);
      });

      // Pattern: "강사: 홍길동" or ["강사", "홍길동"]
      for (const cell of cells) {
        const colonMatch = cell.match(/^(.+?)\s*[:：]\s*(.+)$/);
        if (colonMatch) {
          metadata[colonMatch[1].trim()] = colonMatch[2].trim();
        }
      }

      // Pattern: adjacent cells as key-value
      if (cells.length === 2 && cells[0].length <= 10) {
        metadata[cells[0]] = cells[1];
      }
    }

    return metadata;
  }

  private detect2RowPattern(
    sheet: any,
    headerRowNum: number,
    attendanceMappings: AttendanceMappingResult[],
    colIndexMap: Map<string, number>,
  ): boolean {
    if (attendanceMappings.length === 0) return false;

    // Check first 2 data rows
    const row1 = sheet.getRow(headerRowNum + 1);
    const row2 = sheet.getRow(headerRowNum + 2);

    const firstAttMapping = attendanceMappings[0];
    const colNum = colIndexMap.get(firstAttMapping.dataColumn);
    if (!colNum) return false;

    const val1 = this.getCellText(row1.getCell(colNum));
    const val2 = this.getCellText(row2.getCell(colNum));

    // 2-row pattern: first row has date-like values ("02(Tu)"), second has symbols ("Y", "N")
    const isDateValue = /^\d{1,2}\s*\(/.test(val1);
    const isSymbolValue = /^[A-Z]{1,3}$/i.test(val2);

    return isDateValue && isSymbolValue;
  }

  private numToCol(num: number): string {
    let result = '';
    while (num > 0) {
      num--;
      result = String.fromCharCode(65 + (num % 26)) + result;
      num = Math.floor(num / 26);
    }
    return result;
  }

  /**
   * Retry helper for transient failures (e.g. Gemini API calls)
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    nodeName: string,
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[Node:${nodeName}] Attempt ${attempt}/${maxRetries} failed: ${msg}`);
        if (attempt === maxRetries) {
          console.error(`[Node:${nodeName}] All ${maxRetries} attempts failed.`);
          return null;
        }
        // Exponential backoff: 1s, 2s, 4s...
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
    return null;
  }
}
