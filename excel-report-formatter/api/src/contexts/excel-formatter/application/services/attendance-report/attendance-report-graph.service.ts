/**
 * AttendanceReportGraphService
 * LangGraph.js 기반 출결 보고서 생성 파이프라인
 *
 * 5-Node Pipeline: Parse → Map → Transform → Calculate → Render
 */
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Annotation, StateGraph } from '@langchain/langgraph';
import {
  AttendanceGraphState,
  AttendanceMappingResult,
  StudentRow,
  StudentRenderData,
  ProgressInfo,
  AttendanceRule,
  HierarchicalColumn,
} from './types';
import { PIPELINE_PROGRESS } from './attendance-constants';
import { AttendanceMappingService } from './attendance-mapping.service';
import { AttendanceCalculationService } from './attendance-calculation.service';
import { EXCEL_PARSER_PORT } from '../../ports';
import type { ExcelParserPort } from '../../ports';

// LangGraph State Annotation
const GraphAnnotation = Annotation.Root({
  // Inputs
  rawDataBuffer: Annotation<Buffer>,
  templateBuffer: Annotation<Buffer>,
  companyId: Annotation<string>,
  sheetName: Annotation<string | undefined>,

  // Parse output
  templateColumns: Annotation<string[]>,
  dataColumns: Annotation<string[]>,
  templateSampleData: Annotation<Record<string, unknown>[]>,
  dataSampleData: Annotation<Record<string, unknown>[]>,
  dataMetadata: Annotation<Record<string, string>>,
  dataHeaderRows: Annotation<number[]>,
  dataStartRow: Annotation<number>,
  templateDataStartRow: Annotation<number>,
  dataHierarchicalColumns: Annotation<HierarchicalColumn[]>,

  // Map output
  mappings: Annotation<AttendanceMappingResult[]>,
  unmappedColumns: Annotation<string[]>,

  // Transform output
  students: Annotation<StudentRow[]>,

  // Calculate output
  rule: Annotation<AttendanceRule | null>,
  renderedStudents: Annotation<StudentRenderData[]>,

  // Render output
  outputBuffer: Annotation<Buffer | null>,

  // Progress tracking
  progress: Annotation<number>,
  currentStep: Annotation<string>,
  errors: Annotation<string[]>,
});

type GraphState = typeof GraphAnnotation.State;

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
  ): Promise<{
    outputBuffer: Buffer;
    studentCount: number;
    mappedCount: number;
  }> {
    console.log('[AttendanceGraph] Starting pipeline...');

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
      templateColumns: [],
      dataColumns: [],
      templateSampleData: [],
      dataSampleData: [],
      dataMetadata: {},
      dataHeaderRows: [],
      dataStartRow: 0,
      templateDataStartRow: 0,
      dataHierarchicalColumns: [],
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
  private async nodeParse(state: GraphState): Promise<Partial<GraphState>> {
    console.log('[Node:Parse] Parsing Excel files...');

    try {
      const ExcelJS = await import('exceljs');

      // --- Parse template file ---
      const templateWorkbook = new ExcelJS.default.Workbook();
      await templateWorkbook.xlsx.load(state.templateBuffer as unknown as ArrayBuffer);
      const templateSheet = templateWorkbook.worksheets[0];
      if (!templateSheet) throw new Error('템플릿 파일에 시트가 없습니다.');

      const templateHeader = this.detectMultiRowHeader(templateSheet);
      const templateColumns = templateHeader.columns;
      const templateDataStartRow = templateHeader.dataStartRow;
      const templateSampleData = this.extractSampleDataFromRow(templateSheet, templateColumns, 2, templateDataStartRow);

      // --- Parse data file ---
      const dataWorkbook = new ExcelJS.default.Workbook();
      await dataWorkbook.xlsx.load(state.rawDataBuffer as unknown as ArrayBuffer);
      const targetSheetName = state.sheetName;
      const dataSheet = targetSheetName
        ? dataWorkbook.getWorksheet(targetSheetName)
        : dataWorkbook.worksheets[0];
      if (!dataSheet) throw new Error(`데이터 파일에서 시트를 찾을 수 없습니다: ${targetSheetName || '(첫 번째 시트)'}`);

      // Multi-row header detection
      const dataHeader = this.detectMultiRowHeader(dataSheet);
      const dataColumns = dataHeader.columns;
      const dataStartRow = dataHeader.dataStartRow;
      const dataSampleData = this.extractSampleDataFromRow(dataSheet, dataColumns, 5, dataStartRow);

      // Extract metadata from the data file (rows above header)
      const firstHeaderRow = dataHeader.headerRows.length > 0 ? dataHeader.headerRows[0] : 1;
      const dataMetadata = this.extractMetadata(dataSheet, firstHeaderRow);

      console.log(`[Node:Parse] Template: ${templateColumns.length} cols (dataStart=${templateDataStartRow}), Data: ${dataColumns.length} cols (dataStart=${dataStartRow})`);
      console.log(`[Node:Parse] Data header rows: [${dataHeader.headerRows.join(',')}], hierarchical cols: ${dataHeader.hierarchicalColumns.length}`);
      console.log(`[Node:Parse] metadata keys: ${Object.keys(dataMetadata).join(', ')}`);

      return {
        templateColumns,
        dataColumns,
        templateSampleData,
        dataSampleData,
        dataMetadata,
        dataHeaderRows: dataHeader.headerRows,
        dataStartRow,
        templateDataStartRow,
        dataHierarchicalColumns: dataHeader.hierarchicalColumns,
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
  private async nodeMap(state: GraphState): Promise<Partial<GraphState>> {
    console.log('[Node:Map] Mapping columns...');

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
  private async nodeTransform(state: GraphState): Promise<Partial<GraphState>> {
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
      const dataSheet = state.sheetName
        ? dataWorkbook.getWorksheet(state.sheetName)
        : dataWorkbook.worksheets[0];
      if (!dataSheet) throw new Error('데이터 시트를 찾을 수 없습니다.');

      // Use state.dataStartRow from nodeParse (no re-detection)
      const dataStartRow = state.dataStartRow;

      // Build column index map from hierarchical columns or last header row
      const colIndexMap = new Map<string, number>();
      if (state.dataHierarchicalColumns?.length > 0) {
        for (const hc of state.dataHierarchicalColumns) {
          colIndexMap.set(hc.name, hc.colIndex);
        }
      } else {
        // Fallback: read from last header row
        const lastHeaderRow = state.dataHeaderRows?.length > 0
          ? state.dataHeaderRows[state.dataHeaderRows.length - 1]
          : dataStartRow - 1;
        const headerRow = dataSheet.getRow(lastHeaderRow);
        headerRow.eachCell({ includeEmpty: false }, (cell: any, colNumber: number) => {
          const text = this.getCellText(cell);
          if (text) colIndexMap.set(text, colNumber);
        });
      }

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

      // Detect 2-row-per-student pattern with majority vote across multiple columns
      const is2RowPattern = this.detect2RowPatternMajority(dataSheet, dataStartRow, attendanceMappings, colIndexMap);

      // Decompose class name for metadata enrichment
      const classNameCol = this.findClassNameColumn(state.dataColumns);
      let classNameValue: string | null = null;
      if (classNameCol) {
        const colNum = colIndexMap.get(classNameCol);
        if (colNum) {
          // Read from first data row
          classNameValue = this.getCellText(dataSheet.getRow(dataStartRow).getCell(colNum));
        }
      }

      const rowStep = is2RowPattern ? 2 : 1;
      for (let rowNum = dataStartRow; rowNum <= totalRows; rowNum += rowStep) {
        const row = dataSheet.getRow(rowNum);

        // Skip empty rows — check identity columns for data
        const hasData = identityMappings.some(m => {
          const colNum = this.resolveColNum(m.dataColumn, colIndexMap);
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
          const colNum = this.resolveColNum(m.dataColumn, colIndexMap);
          if (colNum) {
            student.identity[m.templateField] = this.getCellText(row.getCell(colNum));
          }
        }

        // Attendance symbols
        if (is2RowPattern) {
          // 2-row pattern: current row has dates, next row has symbols
          const symbolRow = dataSheet.getRow(rowNum + 1);
          for (const m of attendanceMappings) {
            const colNum = this.resolveColNum(m.dataColumn, colIndexMap);
            if (!colNum) continue;

            // If mapping has (출결) suffix → read from symbol row (row+1)
            // If mapping has (일정) suffix → read from date row (current)
            // If no suffix → use symbol row (backward-compatible)
            const isMergedAttendance = /\(출결\)$/.test(m.dataColumn);
            const isMergedSchedule = /\(일정\)$/.test(m.dataColumn);

            if (isMergedSchedule) {
              // Date/schedule value from current row
              student.attendance[m.templateField] = this.getCellText(row.getCell(colNum));
            } else {
              // Attendance symbol from next row (출결 or default)
              student.attendance[m.templateField] = this.getCellText(symbolRow.getCell(colNum));
            }
          }
        } else {
          // Single-row pattern: symbol is in the same row
          for (const m of attendanceMappings) {
            const colNum = this.resolveColNum(m.dataColumn, colIndexMap);
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

        // Enrich metadata from class name decomposition
        if (classNameValue) {
          this.enrichMetadataFromClassName(student, classNameValue, state.mappings);
        }

        // Summary (for reference)
        for (const m of summaryMappings) {
          const colNum = this.resolveColNum(m.dataColumn, colIndexMap);
          if (colNum) {
            student.rawSummary[m.templateField] = this.getCellText(row.getCell(colNum));
          }
        }

        students.push(student);
      }

      // Classify targetSheet for each student (그룹 vs 1:1)
      for (const student of students) {
        student.metadata['__targetSheet'] = this.classifyTargetSheet(student, students.length);
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
  private async nodeCalculate(state: GraphState): Promise<Partial<GraphState>> {
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
      // 동적 dataStartRow — 템플릿 헤더 분석 결과 사용
      const dataStartRow = state.templateDataStartRow || 5;

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
  private async nodeRender(state: GraphState): Promise<Partial<GraphState>> {
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

      // Group students by targetSheet
      const sheetGroups = new Map<string, StudentRenderData[]>();
      for (const student of state.renderedStudents) {
        const targetSheet = student.targetSheet || 'default';
        if (!sheetGroups.has(targetSheet)) sheetGroups.set(targetSheet, []);
        sheetGroups.get(targetSheet)!.push(student);
      }

      // If only one group (default), render to first sheet
      // If multiple groups, try to find matching sheets or use first sheet
      const renderToSheet = (
        sheet: any,
        students: StudentRenderData[],
        templateDataStartRow: number,
      ) => {
        const dataStartRow = templateDataStartRow;

        // Template column index map — use the same composite header detection as parse stage
        const templateColMap = new Map<string, number>();
        const sheetHeader = this.detectMultiRowHeader(sheet);
        for (const hc of sheetHeader.hierarchicalColumns) {
          if (!templateColMap.has(hc.name)) {
            templateColMap.set(hc.name, hc.colIndex);
          }
        }

        // Break shared formulas in the data area before overwriting
        for (let rowNum = dataStartRow; rowNum <= sheet.rowCount; rowNum++) {
          const row = sheet.getRow(rowNum);
          row.eachCell({ includeEmpty: false }, (cell: any) => {
            if (cell.value && typeof cell.value === 'object' && 'sharedFormula' in cell.value) {
              // Convert shared formula to regular formula
              const formula = cell.value.formula || cell.value.sharedFormula;
              if (formula) {
                cell.value = { formula };
              }
            }
          });
        }

        // Insert rows if needed
        const availableRows = Math.max(0, sheet.rowCount - dataStartRow + 1);
        const needed = students.length;
        if (needed > availableRows) {
          for (let i = 0; i < needed - availableRows; i++) {
            sheet.insertRow(dataStartRow + availableRows + i, []);
          }
        }

        // Build summary field mapping once
        const summaryFieldMap: Record<string, keyof StudentRenderData['formulas']> = {};
        for (const col of state.templateColumns) {
          if (AttendanceMappingService.isSummaryColumn(col)) {
            const normalizedCol = col.toLowerCase();
            if (normalizedCol.includes('출석') && normalizedCol.includes('률')) {
              summaryFieldMap[col] = normalizedCol.includes('실') ? 'realAttendanceRate' : 'attendanceRate';
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

        // Fill data
        for (let i = 0; i < students.length; i++) {
          const student = students[i];
          const rowNum = dataStartRow + i;
          const row = sheet.getRow(rowNum);

          // Identity fields
          for (const [field, value] of Object.entries(student.identity)) {
            const colNum = templateColMap.get(field);
            if (colNum) row.getCell(colNum).value = value;
          }

          // Attendance symbols
          for (const [field, symbol] of Object.entries(student.attendance)) {
            const colNum = templateColMap.get(field);
            if (colNum) row.getCell(colNum).value = symbol;
          }

          // Metadata fields (skip internal keys starting with __)
          for (const [field, value] of Object.entries(student.metadata)) {
            if (field.startsWith('__')) continue;
            const colNum = templateColMap.get(field);
            if (colNum) row.getCell(colNum).value = value;
          }

          // Summary fields with formulas
          for (const [field, formulaKey] of Object.entries(summaryFieldMap)) {
            const colNum = templateColMap.get(field);
            if (colNum && student.formulas[formulaKey]) {
              const rawResult = student.calculated[formulaKey];
              const result = formulaKey === 'attendanceRate' || formulaKey === 'realAttendanceRate'
                ? rawResult / 100
                : rawResult;
              row.getCell(colNum).value = { formula: student.formulas[formulaKey], result } as any;
            }
          }

          row.commit();
        }
      };

      // Render each sheet group
      if (sheetGroups.size <= 1) {
        // Single group → first sheet
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error('템플릿 시트를 찾을 수 없습니다.');
        const allStudents = state.renderedStudents;
        renderToSheet(sheet, allStudents, state.templateDataStartRow || 5);
      } else {
        // Multi-sheet: try to match sheet names, fallback to first sheet
        for (const [sheetKey, students] of sheetGroups) {
          let sheet = workbook.getWorksheet(sheetKey);
          if (!sheet) {
            // Fallback: use first sheet for all
            sheet = workbook.worksheets[0];
          }
          if (sheet) {
            // Each sheet may have its own header structure
            const sheetHeader = this.detectMultiRowHeader(sheet);
            renderToSheet(sheet, students, sheetHeader.dataStartRow);
          }
        }
      }

      // Generate output buffer
      const outputBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

      console.log(`[Node:Render] Report generated: ${state.renderedStudents.length} students across ${sheetGroups.size} sheet group(s)`);

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

  /**
   * 멀티로우 헤더 감지 — RAW2 3-row 헤더 등 계층적 구조 지원
   *
   * 전략:
   * 1. 시트 상단 15행 스캔, 각 행의 non-empty 셀 수 집계
   * 2. 연속된 "dense" 행(3+ 셀)을 헤더 후보 그룹으로 묶음
   * 3. 가장 많은 컬럼을 커버하는 그룹 선택
   * 4. 그룹 내 마지막 행을 leaf header로 사용, 상위 행은 계층 경로
   * 5. dataStartRow = 마지막 헤더 행 + 1
   */
  private detectMultiRowHeader(sheet: any): {
    columns: string[];
    headerRows: number[];
    dataStartRow: number;
    hierarchicalColumns: HierarchicalColumn[];
  } {
    const maxScan = Math.min(15, sheet.rowCount);
    const rowInfos: Array<{
      rowNum: number;
      cells: Map<number, string>; // colIndex (1-based) → text
      nonEmptyCount: number;
    }> = [];

    for (let rowNum = 1; rowNum <= maxScan; rowNum++) {
      const row = sheet.getRow(rowNum);
      const cells = new Map<number, string>();
      let nonEmptyCount = 0;

      row.eachCell({ includeEmpty: false }, (cell: any, colNumber: number) => {
        const text = this.getCellText(cell);
        if (text.length > 0) {
          cells.set(colNumber, text);
          nonEmptyCount++;
        }
      });

      rowInfos.push({ rowNum, cells, nonEmptyCount });
    }

    const isDataLikeRow = (info: typeof rowInfos[number]): boolean => {
      let emailCount = 0;
      let attendanceCount = 0;
      let dateLikeCount = 0;
      let longTextCount = 0;
      let numericCount = 0;

      for (const text of info.cells.values()) {
        const trimmed = text.trim();
        if (!trimmed) continue;
        if (trimmed.includes('@') && trimmed.includes('.')) emailCount++;
        if (/^(Y|N|C|L|O|X|-|BZ|VA)$/i.test(trimmed)) attendanceCount++;
        if (/^\d{1,2}\s*\([A-Za-z]{2,3}\)$/.test(trimmed) || /^\d{1,2}월\s*\d{1,2}일$/.test(trimmed)) {
          dateLikeCount++;
        }
        if (trimmed.length >= 25) longTextCount++;
        if (/^\d+(\.\d+)?$/.test(trimmed)) numericCount++;
      }

      if (emailCount >= 1) return true;
      if (attendanceCount >= 3) return true;
      if (longTextCount >= 2) return true;
      if (dateLikeCount >= 4 && numericCount >= 2) return true;
      return false;
    };

    // Group consecutive dense rows (3+ non-empty cells)
    const groups: Array<typeof rowInfos> = [];
    let currentGroup: typeof rowInfos = [];

    for (const info of rowInfos) {
      if (info.nonEmptyCount >= 3) {
        currentGroup.push(info);
      } else {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);

    if (groups.length === 0) {
      return { columns: [], headerRows: [1], dataStartRow: 2, hierarchicalColumns: [] };
    }

    // Pick best group: prefer groups where rows have short label-like cells (not data rows)
    let bestGroup = groups[0];
    let bestScore = -1;

    for (const group of groups) {
      // Score: sum of non-empty cells across header rows, bonus for short labels, penalty for numeric-only rows
      let score = 0;
      let hasDataLikeRow = false;

      for (const info of group) {
        let shortLabels = 0;
        let numericOnly = true;
        for (const text of info.cells.values()) {
          if (text.length >= 1 && text.length <= 20) shortLabels++;
          if (!/^\d+(\.\d+)?$/.test(text)) numericOnly = false;
        }
        score += info.nonEmptyCount + shortLabels * 2;
        if (numericOnly && info.nonEmptyCount > 5) hasDataLikeRow = true;
      }

      // If the group's last row looks like pure data, it's probably not a header group
      if (hasDataLikeRow) score -= 50;

      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }

    const truncatedGroup: typeof bestGroup = [];
    for (const info of bestGroup) {
      if (truncatedGroup.length > 0 && isDataLikeRow(info)) {
        break;
      }
      truncatedGroup.push(info);
    }
    const effectiveGroup = truncatedGroup.length > 0 ? truncatedGroup : [bestGroup[0]];

    // Determine if this is a multi-row header vs single-row
    // A group with rows where upper rows have FEWER cells than lower rows → hierarchical header
    const headerRows = effectiveGroup.map(g => g.rowNum);
    const lastHeaderInfo = effectiveGroup[effectiveGroup.length - 1];
    const dataStartRow = lastHeaderInfo.rowNum + 1;

    // Build column names from the leaf (last) header row
    // For multi-row headers, build hierarchical path
    const maxCol = Math.max(...effectiveGroup.flatMap(g => Array.from(g.cells.keys())));
    const columns: string[] = [];
    const hierarchicalColumns: HierarchicalColumn[] = [];
    // Track which column indices we've already seen via sparse array
    const colNames = new Array<string>(maxCol + 1).fill('');

    // For single-row headers, just use that row
    if (effectiveGroup.length === 1) {
      for (const [colIdx, text] of lastHeaderInfo.cells) {
        colNames[colIdx] = text;
      }
    } else {
      // Multi-row: build full path names
      // For each column, walk top-down through header rows to build path
      // Handle merged cells: if a row doesn't have a value at colIdx, inherit from nearest left cell in same row
      const rowMergedValues: Map<number, Map<number, string>> = new Map();

      for (const info of effectiveGroup) {
        const merged = new Map<number, string>();
        let lastVal = '';
        for (let col = 1; col <= maxCol; col++) {
          if (info.cells.has(col)) {
            lastVal = info.cells.get(col)!;
          }
          // Only propagate if there was a value to the left AND this column has data in the leaf row
          if (lastVal) {
            merged.set(col, lastVal);
          }
        }
        rowMergedValues.set(info.rowNum, merged);
      }

      for (let colIdx = 1; colIdx <= maxCol; colIdx++) {
        // Check if the leaf row has data at this column
        const leafText = lastHeaderInfo.cells.get(colIdx);
        if (!leafText) continue;

        const path: string[] = [];
        for (const info of effectiveGroup) {
          const mergedMap = rowMergedValues.get(info.rowNum);
          const val = mergedMap?.get(colIdx);
          if (val) path.push(val);
        }

        // Build unique column name
        // If all path parts are the same (single-row repeated), just use leaf
        const uniqueParts = [...new Set(path)];
        const name = uniqueParts.length <= 1 ? leafText : uniqueParts.join('_');

        colNames[colIdx] = name;
        hierarchicalColumns.push({ name, colIndex: colIdx, path });
      }
    }

    // Build flat column list (preserving order, skipping empty)
    for (let i = 1; i <= maxCol; i++) {
      if (colNames[i] && colNames[i].length > 0) {
        columns.push(colNames[i]);
        // Add hierarchical info for single-row case too
        if (effectiveGroup.length === 1) {
          hierarchicalColumns.push({ name: colNames[i], colIndex: i });
        }
      }
    }

    return { columns, headerRows, dataStartRow, hierarchicalColumns };
  }

  private extractSampleDataFromRow(
    sheet: any,
    columns: string[],
    maxRows: number,
    startRow: number,
  ): Record<string, unknown>[] {
    const samples: Record<string, unknown>[] = [];

    for (let rowNum = startRow; rowNum < startRow + maxRows && rowNum <= sheet.rowCount; rowNum++) {
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

  /**
   * 2-row-per-student 패턴 감지 — 복수 컬럼 majority vote
   * 단일 컬럼이 아닌 여러 출결 컬럼에서 패턴을 확인하여 신뢰도 향상
   */
  /**
   * Strip (출결) / (일정) / (1) / (2) suffixes from merged column names
   * to recover the original column name for colIndexMap lookup.
   */
  private stripMergedSuffix(colName: string): string {
    return colName.replace(/\((출결|일정|\d+)\)$/, '').trim();
  }

  /**
   * Resolve column number from colIndexMap, trying both the original name
   * and the name with merged suffix stripped.
   */
  private resolveColNum(colName: string, colIndexMap: Map<string, number>): number | undefined {
    return colIndexMap.get(colName) ?? colIndexMap.get(this.stripMergedSuffix(colName));
  }

  private detect2RowPatternMajority(
    sheet: any,
    dataStartRow: number,
    attendanceMappings: AttendanceMappingResult[],
    colIndexMap: Map<string, number>,
  ): boolean {
    const row1 = sheet.getRow(dataStartRow);
    const row2 = sheet.getRow(dataStartRow + 1);
    if (!row1 || !row2) return false;

    // Strategy 1: Use attendance mappings (strip merged suffixes for lookup)
    if (attendanceMappings.length > 0) {
      const sampled = attendanceMappings.slice(0, 10);
      let dateSymbolVotes = 0;
      let totalVotes = 0;

      for (const m of sampled) {
        const colNum = this.resolveColNum(m.dataColumn, colIndexMap);
        if (!colNum) continue;

        const val1 = this.getCellText(row1.getCell(colNum));
        const val2 = this.getCellText(row2.getCell(colNum));

        if (!val1 && !val2) continue;
        totalVotes++;

        const isRow1DateLike = /^\d{1,2}\s*\(/.test(val1) || /^\d{1,2}$/.test(val1) || val1 === '';
        const isRow2Symbol = /^[A-Z]{1,3}$/i.test(val2);

        if (isRow1DateLike && isRow2Symbol) {
          dateSymbolVotes++;
        }
      }

      if (totalVotes > 0 && dateSymbolVotes / totalVotes > 0.5) {
        return true;
      }
    }

    // Strategy 2: Fallback — scan all columns in the sheet directly
    // Look for date-like values in row1 and attendance symbols in row2
    let dateSymbolVotes = 0;
    let totalVotes = 0;
    const colCount = Math.min(sheet.columnCount || 50, 50);

    for (let col = 1; col <= colCount; col++) {
      const val1 = this.getCellText(row1.getCell(col));
      const val2 = this.getCellText(row2.getCell(col));

      if (!val1 && !val2) continue;

      const isRow1DateLike = /^\d{1,2}\s*\(/.test(val1) || /^\d{1,2}$/.test(val1);
      const isRow2Symbol = /^(Y|N|C|L|O|X|BZ|VA|-)$/i.test(val2);

      if (isRow1DateLike || isRow2Symbol) {
        totalVotes++;
        if (isRow1DateLike && isRow2Symbol) {
          dateSymbolVotes++;
        }
      }
    }

    return totalVotes >= 3 && dateSymbolVotes / totalVotes > 0.5;
  }

  /** 데이터 컬럼에서 클래스명 컬럼 찾기 */
  private findClassNameColumn(dataColumns: string[]): string | null {
    return dataColumns.find(dc => {
      const lower = dc.toLowerCase();
      return (
        lower.includes('class name') ||
        lower.includes('클래스명') ||
        lower.includes('class_name') ||
        lower.includes('classname')
      );
    }) || null;
  }

  /** 클래스명에서 메타데이터 필드 보충 */
  private enrichMetadataFromClassName(
    student: StudentRow,
    className: string,
    _mappings: AttendanceMappingResult[],
  ): void {
    const parts = className.split('_');
    if (parts.length < 3) return;

    const is5Part = parts.length >= 5;

    // Only fill metadata fields that haven't been set yet
    const setIfEmpty = (key: string, value: string | null) => {
      if (value && !student.metadata[key]) {
        student.metadata[key] = value;
      }
    };

    // 법인
    const company = parts[0].replace(/\s*\d{2,4}[-–]?\d*학기.*$/, '').trim();
    setIfEmpty('법인', company || null);

    // 프로그램
    setIfEmpty('프로그램', parts[1]?.trim() || null);

    if (is5Part) {
      // 요일
      const dayMatch = parts[2].match(/([월화수목금토일])/);
      setIfEmpty('요일', dayMatch ? dayMatch[1] : parts[2].trim());

      // 진행시간
      setIfEmpty('진행시간', parts[2].trim());

      // 레벨
      setIfEmpty('레벨', parts[3]?.trim() || null);

      // 강사명
      const teacher = parts[4]?.replace(/\s*\([^)]*\)\s*$/, '').trim();
      setIfEmpty('강사', teacher || null);
    } else {
      // 3-part legacy: parts[2] = 레벨
      setIfEmpty('레벨', parts[2]?.trim() || null);
    }
  }

  /** 학생을 그룹/1:1 시트로 분류 */
  private classifyTargetSheet(student: StudentRow, totalStudents: number): string {
    // Default: group sheet if more than 1 student
    // Can be extended with program-name-based logic
    if (totalStudents <= 2) return '1:1';
    return 'group';
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
