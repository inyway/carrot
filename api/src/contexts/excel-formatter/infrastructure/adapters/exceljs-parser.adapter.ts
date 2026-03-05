import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { ExcelParserPort } from '../../application/ports';
import {
  type TemplateStructureVO,
  type TemplateSheetVO,
  type TemplateBlockVO,
  type CellInfo,
  type CellStyle,
  type MergedCellInfo,
  type HeaderStructure,
  type ColumnDefinition,
  type FormulaInfo,
  BlockType,
  ColumnType,
  TemplateFormatType,
  FormulaType,
  TemplateStructureFactory,
} from '../../domain/value-objects';

@Injectable()
export class ExceljsParserAdapter implements ExcelParserPort {
  async parseTemplate(
    buffer: Buffer,
    fileName: string,
  ): Promise<TemplateStructureVO> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    const sheets: TemplateSheetVO[] = [];

    workbook.eachSheet((worksheet, sheetId) => {
      const sheetVO = this.parseSheet(worksheet, sheetId - 1);
      sheets.push(sheetVO);
    });

    const formatType = this.classifyFormatType(sheets);

    return TemplateStructureFactory.create(fileName, sheets, formatType);
  }

  async extractSheetData(
    buffer: Buffer,
    sheetName: string,
  ): Promise<Array<Record<string, unknown>>> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    // Use detected header structure for smarter data extraction
    const mergedCells = this.detectMergedCells(worksheet);
    const titleRows = this.detectTitleRows(worksheet, mergedCells);
    const headerRows = this.detectHeaderRows(worksheet, titleRows);
    const dataStartRow = headerRows.length > 0
      ? Math.max(...headerRows) + 1
      : 2;

    const columns = this.detectColumnDefinitions(worksheet, headerRows, mergedCells, dataStartRow);
    const headers = columns.map((c) => c.fullName);

    const data: Array<Record<string, unknown>> = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber < dataStartRow) return;

      const rowData: Record<string, unknown> = {};
      let hasData = false;

      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const colDef = columns.find((c) => c.index === colNumber);
        const header = colDef?.fullName || headers[colNumber - 1] || `Column${colNumber}`;
        const value = this.extractCellValue(cell);
        if (value !== null && value !== undefined) {
          rowData[header] = value;
          hasData = true;
        }
      });

      if (hasData) {
        data.push(rowData);
      }
    });

    return data;
  }

  async getSheetNames(buffer: Buffer): Promise<string[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    const names: string[] = [];
    workbook.eachSheet((worksheet) => {
      names.push(worksheet.name);
    });

    return names;
  }

  // ============================================
  // Stage 1: Rule-Based Structure Detection
  // ============================================

  private parseSheet(worksheet: ExcelJS.Worksheet, index: number): TemplateSheetVO {
    const cells: CellInfo[] = [];
    let maxRow = 0;
    let maxCol = 0;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      maxRow = Math.max(maxRow, rowNumber);
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        maxCol = Math.max(maxCol, colNumber);
        cells.push(this.parseCellInfo(cell, rowNumber, colNumber));
      });
    });

    // Step 1: Detect merged cells
    const mergedCells = this.detectMergedCells(worksheet);

    // Step 2: Detect title rows
    const titleRows = this.detectTitleRows(worksheet, mergedCells);

    // Step 3: Detect header rows
    const headerRows = this.detectHeaderRows(worksheet, titleRows);

    // Step 4: Calculate data start row
    const dataStartRow = headerRows.length > 0
      ? Math.max(...headerRows) + 1
      : this.inferDataStartRow(cells);

    // Step 5: Detect column definitions
    const columns = this.detectColumnDefinitions(worksheet, headerRows, mergedCells, dataStartRow);

    // Step 6: Extract formulas
    const formulas = this.extractFormulas(worksheet);

    // Build header structure
    const header: HeaderStructure = {
      headerRows,
      dataStartRow,
      columns,
    };

    // Legacy block detection (backward compatible)
    const blocks = this.detectBlocks(cells, maxRow, maxCol);

    return {
      name: worksheet.name,
      index,
      blocks,
      rowCount: maxRow,
      colCount: maxCol,
      header,
      mergedCells,
      formulas,
      titleRows: titleRows.length > 0 ? titleRows : undefined,
    };
  }

  /**
   * Step 1: Merged cell 감지
   * worksheet.model.merges에서 파싱
   */
  private detectMergedCells(worksheet: ExcelJS.Worksheet): MergedCellInfo[] {
    const result: MergedCellInfo[] = [];

    // ExcelJS stores merges as string ranges like "A1:D1"
    const merges: string[] = (worksheet as unknown as { _merges: Record<string, unknown> })._merges
      ? Object.keys((worksheet as unknown as { _merges: Record<string, unknown> })._merges)
      : [];

    // Also try model.merges
    if (merges.length === 0 && worksheet.model?.merges) {
      for (const merge of worksheet.model.merges) {
        const rangeStr = typeof merge === 'string' ? merge : String(merge);
        merges.push(rangeStr);
      }
    }

    for (const rangeStr of merges) {
      const parts = rangeStr.split(':');
      if (parts.length !== 2) continue;

      const [start, end] = parts;
      const startMatch = start.match(/^([A-Z]+)(\d+)$/);
      const endMatch = end.match(/^([A-Z]+)(\d+)$/);
      if (!startMatch || !endMatch) continue;

      const startCol = this.letterToColumnNumber(startMatch[1]);
      const startRow = parseInt(startMatch[2]);
      const endCol = this.letterToColumnNumber(endMatch[1]);
      const endRow = parseInt(endMatch[2]);

      // Get the value from the top-left cell
      const cell = worksheet.getCell(start);
      const value = this.extractCellValue(cell);

      result.push({
        range: rangeStr,
        startRow,
        endRow,
        startCol,
        endCol,
        value,
      });
    }

    return result;
  }

  /**
   * Step 2: 타이틀 행 감지
   * 전체 폭(또는 거의 전체 폭)으로 merged된 셀 + 텍스트 = 타이틀 행
   */
  private detectTitleRows(
    worksheet: ExcelJS.Worksheet,
    mergedCells: MergedCellInfo[],
  ): number[] {
    const titleRows: number[] = [];
    let maxCol = 0;

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
        maxCol = Math.max(maxCol, colNumber);
      });
    });

    if (maxCol === 0) return titleRows;

    // Check rows 1-10 for full-width merged cells with text
    for (const mc of mergedCells) {
      if (mc.startRow > 10) continue;
      if (mc.startRow !== mc.endRow) continue; // Skip multi-row merges for title detection

      const mergeWidth = mc.endCol - mc.startCol + 1;
      const widthRatio = mergeWidth / maxCol;

      // A merged cell spanning > 60% of columns with text is likely a title
      if (widthRatio > 0.6 && mc.value && typeof mc.value === 'string' && mc.value.trim().length > 0) {
        titleRows.push(mc.startRow);
      }
    }

    return titleRows.sort((a, b) => a - b);
  }

  /**
   * Step 3: 헤더 행 감지
   * bold/fill이 있는 연속 행을 "헤더 밴드"로 인식
   */
  private detectHeaderRows(
    worksheet: ExcelJS.Worksheet,
    titleRows: number[],
  ): number[] {
    const scanLimit = Math.min(20, worksheet.rowCount);
    const rowScores: Map<number, { boldCount: number; fillCount: number; totalCells: number }> = new Map();

    for (let rowNum = 1; rowNum <= scanLimit; rowNum++) {
      if (titleRows.includes(rowNum)) continue;

      const row = worksheet.getRow(rowNum);
      let boldCount = 0;
      let fillCount = 0;
      let totalCells = 0;

      row.eachCell({ includeEmpty: false }, (cell) => {
        totalCells++;
        if (cell.font?.bold) boldCount++;
        if (cell.fill && cell.fill.type === 'pattern' && (cell.fill as ExcelJS.FillPattern).pattern !== 'none') {
          fillCount++;
        }
      });

      if (totalCells > 0) {
        rowScores.set(rowNum, { boldCount, fillCount, totalCells });
      }
    }

    // Find header band: consecutive rows where > 50% of cells have bold OR fill
    const headerRows: number[] = [];

    for (const [rowNum, score] of rowScores) {
      const styledRatio = (score.boldCount + score.fillCount) / (score.totalCells * 2);
      const boldRatio = score.boldCount / score.totalCells;
      const fillRatio = score.fillCount / score.totalCells;

      // Row is a header if > 50% bold or > 50% filled
      if (boldRatio >= 0.5 || fillRatio >= 0.5 || styledRatio >= 0.4) {
        headerRows.push(rowNum);
      }
    }

    // If no styled headers found, fall back to heuristic:
    // First row with data (after titles) is the header
    if (headerRows.length === 0) {
      for (let rowNum = 1; rowNum <= scanLimit; rowNum++) {
        if (titleRows.includes(rowNum)) continue;
        const row = worksheet.getRow(rowNum);
        let cellCount = 0;
        let textCount = 0;

        row.eachCell({ includeEmpty: false }, (cell) => {
          cellCount++;
          const val = this.extractCellValue(cell);
          if (typeof val === 'string') textCount++;
        });

        // First row that is predominantly text = header
        if (cellCount > 0 && textCount / cellCount >= 0.7) {
          headerRows.push(rowNum);
          break;
        }
      }
    }

    // Keep only contiguous header rows (allow gaps of 1 for merged cells)
    return this.filterContiguousRows(headerRows);
  }

  /**
   * Step 4: 컬럼 정의 감지
   * 헤더 텍스트 조합 + 10행 샘플링으로 타입 추론
   */
  private detectColumnDefinitions(
    worksheet: ExcelJS.Worksheet,
    headerRows: number[],
    mergedCells: MergedCellInfo[],
    dataStartRow: number,
  ): ColumnDefinition[] {
    const columns: ColumnDefinition[] = [];

    // Determine max column from header rows or first data rows
    let maxCol = 0;
    const rowsToCheck = [...headerRows, dataStartRow, dataStartRow + 1];
    for (const rowNum of rowsToCheck) {
      const row = worksheet.getRow(rowNum);
      if (row) {
        row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
          maxCol = Math.max(maxCol, colNumber);
        });
      }
    }

    if (maxCol === 0) return columns;

    // Build column definitions
    for (let col = 1; col <= maxCol; col++) {
      const letter = this.columnNumberToLetter(col);

      // Collect header texts from each header row
      const headerTexts: string[] = [];
      for (const rowNum of headerRows) {
        const cellValue = this.getEffectiveCellValue(worksheet, rowNum, col, mergedCells);
        headerTexts.push(cellValue !== null ? String(cellValue) : '');
      }

      // Build full name by joining non-empty header texts
      const nonEmpty = headerTexts.filter((t) => t.length > 0);
      const fullName = nonEmpty.length > 0
        ? nonEmpty.join(' > ')
        : `Column${col}`;

      // Sample 10 data rows for type inference
      const sampleValues: (string | number | boolean | null)[] = [];
      let sampleFormula: string | undefined;
      let numFmt: string | undefined;
      const maxSampleRow = Math.min(dataStartRow + 9, worksheet.rowCount);

      for (let rowNum = dataStartRow; rowNum <= maxSampleRow; rowNum++) {
        const cell = worksheet.getCell(`${letter}${rowNum}`);
        const value = this.extractCellValue(cell);
        sampleValues.push(value as string | number | boolean | null);

        if (cell.formula && !sampleFormula) {
          sampleFormula = cell.formula;
        }
        if (cell.numFmt && cell.numFmt !== 'General' && !numFmt) {
          numFmt = cell.numFmt;
        }
      }

      // Infer type
      const inferredType = this.inferColumnType(sampleValues, sampleFormula, numFmt);

      // Check if fixed (all same value)
      const nonNullValues = sampleValues.filter((v) => v !== null && v !== undefined);
      const isFixed = nonNullValues.length > 1 &&
        nonNullValues.every((v) => v === nonNullValues[0]);

      columns.push({
        index: col,
        letter,
        headerTexts,
        fullName,
        inferredType,
        formula: sampleFormula,
        isFixed,
        sampleValues,
        numFmt,
      });
    }

    return columns;
  }

  /**
   * Step 5: 수식 추출
   * standard/shared/array formula 수집
   */
  private extractFormulas(worksheet: ExcelJS.Worksheet): FormulaInfo[] {
    const formulas: FormulaInfo[] = [];
    const seenFormulas = new Set<string>();

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (!cell.formula) return;

        const address = `${this.columnNumberToLetter(colNumber)}${rowNumber}`;

        // Deduplicate shared formulas (only keep the first instance)
        const formulaKey = cell.formula;
        if (seenFormulas.has(formulaKey) && cell.sharedFormula) return;
        seenFormulas.add(formulaKey);

        let formulaType = FormulaType.STANDARD;
        let sharedRef: string | undefined;

        if (cell.sharedFormula) {
          formulaType = FormulaType.SHARED;
          sharedRef = cell.sharedFormula;
        }

        // Check for array formula via model
        const cellModel = cell.model as Record<string, unknown> | undefined;
        if (cellModel?.shareType === 'array') {
          formulaType = FormulaType.ARRAY;
        }

        formulas.push({
          address,
          formula: cell.formula,
          formulaType,
          sharedRef,
        });
      });
    });

    return formulas;
  }

  /**
   * Step 6: 포맷 타입 분류
   * flat vs multi_header vs multi_sheet
   */
  private classifyFormatType(sheets: TemplateSheetVO[]): TemplateFormatType {
    if (sheets.length === 0) return TemplateFormatType.FLAT;

    // Multi-sheet: 2+ sheets with data
    const sheetsWithData = sheets.filter((s) => s.rowCount > 0);
    if (sheetsWithData.length >= 2) {
      // Check if any sheet has multi-row headers
      const hasMultiHeader = sheetsWithData.some(
        (s) => s.header && s.header.headerRows.length > 1,
      );
      if (hasMultiHeader) {
        return TemplateFormatType.MULTI_SHEET;
      }
    }

    // Check for multi-header in single sheet
    const firstSheet = sheets[0];
    if (firstSheet?.header && firstSheet.header.headerRows.length > 1) {
      return TemplateFormatType.MULTI_HEADER;
    }

    // Check for merged cells in header area → multi_header
    if (firstSheet?.mergedCells && firstSheet.mergedCells.length > 0) {
      const headerArea = firstSheet.header?.headerRows || [];
      const hasMergedInHeader = firstSheet.mergedCells.some(
        (mc) => headerArea.some((hr) => mc.startRow <= hr && mc.endRow >= hr),
      );
      if (hasMergedInHeader) {
        return TemplateFormatType.MULTI_HEADER;
      }
    }

    return TemplateFormatType.FLAT;
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Get effective cell value, considering merged cells
   */
  private getEffectiveCellValue(
    worksheet: ExcelJS.Worksheet,
    row: number,
    col: number,
    mergedCells: MergedCellInfo[],
  ): string | number | boolean | Date | null {
    // Check if this cell is part of a merged range
    const mergedCell = mergedCells.find(
      (mc) => row >= mc.startRow && row <= mc.endRow && col >= mc.startCol && col <= mc.endCol,
    );

    if (mergedCell) {
      return mergedCell.value;
    }

    const cell = worksheet.getCell(`${this.columnNumberToLetter(col)}${row}`);
    return this.extractCellValue(cell);
  }

  /**
   * Extract cell value handling formulas, rich text, dates
   */
  private extractCellValue(cell: ExcelJS.Cell): string | number | boolean | Date | null {
    if (cell.value === null || cell.value === undefined) return null;

    if (typeof cell.value === 'object' && 'result' in cell.value) {
      return cell.value.result as string | number | boolean | Date | null;
    }

    if (typeof cell.value === 'object' && 'richText' in cell.value) {
      return (cell.value.richText as Array<{ text: string }>)
        .map((t) => t.text)
        .join('');
    }

    if (cell.value instanceof Date) {
      return cell.value;
    }

    return cell.value as string | number | boolean;
  }

  /**
   * Infer column type from sample values and format
   */
  private inferColumnType(
    sampleValues: (string | number | boolean | null)[],
    formula?: string,
    numFmt?: string,
  ): ColumnType {
    // If formula exists, check if it's purely a formula column
    if (formula) {
      return ColumnType.FORMULA;
    }

    // Check numFmt for percentage/currency
    if (numFmt) {
      if (numFmt.includes('%')) return ColumnType.PERCENTAGE;
      if (numFmt.includes('₩') || numFmt.includes('$') || numFmt.includes('원')) {
        return ColumnType.CURRENCY;
      }
    }

    const nonNull = sampleValues.filter((v) => v !== null && v !== undefined);
    if (nonNull.length === 0) return ColumnType.UNKNOWN;

    // Check types
    const typeDistribution = { number: 0, string: 0, date: 0, boolean: 0 };
    for (const val of nonNull) {
      if (val instanceof Date) {
        typeDistribution.date++;
      } else if (typeof val === 'number') {
        typeDistribution.number++;
      } else if (typeof val === 'boolean') {
        typeDistribution.boolean++;
      } else if (typeof val === 'string') {
        // Try to detect dates in string form
        if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(val)) {
          typeDistribution.date++;
        } else {
          typeDistribution.string++;
        }
      }
    }

    const total = nonNull.length;
    if (typeDistribution.date / total >= 0.7) return ColumnType.DATE;
    if (typeDistribution.number / total >= 0.7) return ColumnType.NUMBER;
    if (typeDistribution.string / total >= 0.7) return ColumnType.STRING;

    return ColumnType.STRING;
  }

  /**
   * Filter to keep contiguous or near-contiguous rows
   */
  private filterContiguousRows(rows: number[]): number[] {
    if (rows.length <= 1) return rows;

    const sorted = [...rows].sort((a, b) => a - b);
    const result: number[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      // Allow gap of 1 (for merged cells spanning header area)
      if (sorted[i] - sorted[i - 1] <= 2) {
        result.push(sorted[i]);
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * Infer data start row from cell distribution (fallback)
   */
  private inferDataStartRow(cells: CellInfo[]): number {
    if (cells.length === 0) return 2;

    // Find the first row where values change pattern from row to row
    const rows = new Set(cells.map((c) => parseInt(c.address.replace(/[A-Z]+/g, ''))));
    const sortedRows = [...rows].sort((a, b) => a - b);

    return sortedRows.length > 1 ? sortedRows[1] : 2;
  }

  // ============================================
  // Legacy Methods (backward compatible)
  // ============================================

  private parseCellInfo(
    cell: ExcelJS.Cell,
    rowNumber: number,
    colNumber: number,
  ): CellInfo {
    const address = this.columnNumberToLetter(colNumber) + rowNumber;
    const value = this.extractCellValue(cell);
    const style = this.extractCellStyle(cell);

    return {
      address,
      value,
      formula: cell.formula,
      style,
    };
  }

  private extractCellStyle(cell: ExcelJS.Cell): CellStyle | undefined {
    const style: CellStyle = {};

    if (cell.font) {
      style.font = {
        bold: cell.font.bold,
        size: cell.font.size,
        color: cell.font.color?.argb,
      };
    }

    if (cell.fill && cell.fill.type === 'pattern') {
      style.fill = {
        type: cell.fill.pattern,
        color: (cell.fill as ExcelJS.FillPattern).fgColor?.argb,
      };
    }

    if (cell.border) {
      style.border = !!(
        cell.border.top ||
        cell.border.bottom ||
        cell.border.left ||
        cell.border.right
      );
    }

    if (cell.alignment) {
      style.alignment = {
        horizontal: cell.alignment.horizontal,
        vertical: cell.alignment.vertical,
      };
    }

    return Object.keys(style).length > 0 ? style : undefined;
  }

  private detectBlocks(
    cells: CellInfo[],
    maxRow: number,
    maxCol: number,
  ): TemplateBlockVO[] {
    const blocks: TemplateBlockVO[] = [];

    const grid: Map<string, CellInfo> = new Map();
    cells.forEach((cell) => grid.set(cell.address, cell));

    const visited = new Set<string>();
    let blockCounter = 0;

    for (let row = 1; row <= maxRow; row++) {
      for (let col = 1; col <= maxCol; col++) {
        const address = this.columnNumberToLetter(col) + row;
        if (visited.has(address) || !grid.has(address)) continue;

        const region = this.findConnectedRegion(grid, row, col, maxRow, maxCol, visited);

        if (region.cells.length > 0) {
          blockCounter++;
          const blockType = this.inferBlockType(region.cells);

          blocks.push(
            TemplateStructureFactory.createBlock(
              `block_${blockCounter}`,
              blockType,
              `${this.columnNumberToLetter(region.startCol)}${region.startRow}:${this.columnNumberToLetter(region.endCol)}${region.endRow}`,
              region.startRow,
              region.endRow,
              region.startCol,
              region.endCol,
              region.cells,
              this.inferBlockConfig(region.cells, blockType),
            ),
          );
        }
      }
    }

    return blocks;
  }

  private findConnectedRegion(
    grid: Map<string, CellInfo>,
    startRow: number,
    startCol: number,
    maxRow: number,
    maxCol: number,
    visited: Set<string>,
  ): {
    cells: CellInfo[];
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  } {
    const cells: CellInfo[] = [];
    let endRow = startRow;
    let endCol = startCol;

    for (let col = startCol; col <= maxCol; col++) {
      const address = this.columnNumberToLetter(col) + startRow;
      if (!grid.has(address)) break;
      endCol = col;
    }

    for (let row = startRow; row <= maxRow; row++) {
      let hasData = false;
      for (let col = startCol; col <= endCol; col++) {
        const address = this.columnNumberToLetter(col) + row;
        if (grid.has(address)) {
          hasData = true;
          break;
        }
      }
      if (!hasData) break;
      endRow = row;
    }

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const address = this.columnNumberToLetter(col) + row;
        visited.add(address);
        const cell = grid.get(address);
        if (cell) {
          cells.push(cell);
        }
      }
    }

    return { cells, startRow, endRow, startCol, endCol };
  }

  private inferBlockType(cells: CellInfo[]): BlockType {
    if (cells.length === 0) return BlockType.TEXT_STATIC;

    const hasNumbers = cells.some(
      (c) => typeof c.value === 'number' || c.formula,
    );
    const hasFormulas = cells.some((c) => c.formula);
    const rowCount = new Set(cells.map((c) => c.address.replace(/[A-Z]+/g, ''))).size;
    const colCount = new Set(cells.map((c) => c.address.replace(/[0-9]+/g, ''))).size;

    if (rowCount > 2 && colCount > 1) {
      return BlockType.TABLE;
    }

    if (hasNumbers || hasFormulas) {
      return BlockType.METRIC_BLOCK;
    }

    const firstRowCells = cells.filter(
      (c) => parseInt(c.address.replace(/[A-Z]+/g, '')) === 1,
    );
    if (
      firstRowCells.length > 0 &&
      firstRowCells.some((c) => c.style?.font?.bold)
    ) {
      return BlockType.HEADER;
    }

    const hasLongText = cells.some(
      (c) => typeof c.value === 'string' && c.value.length > 50,
    );
    if (hasLongText) {
      return BlockType.TEXT_STATIC;
    }

    return BlockType.TEXT_STATIC;
  }

  private inferBlockConfig(
    cells: CellInfo[],
    blockType: BlockType,
  ): TemplateBlockVO['config'] {
    switch (blockType) {
      case BlockType.TABLE: {
        const rows = [...new Set(cells.map((c) => parseInt(c.address.replace(/[A-Z]+/g, ''))))].sort((a, b) => a - b);
        return { headerRow: rows[0] };
      }
      case BlockType.METRIC_BLOCK: {
        const metrics = cells
          .filter((c) => c.formula || typeof c.value === 'number')
          .map((c) => c.address);
        return { metrics };
      }
      case BlockType.TEXT_AI: {
        return { placeholder: '{{AI_GENERATED_TEXT}}' };
      }
      default:
        return undefined;
    }
  }

  private columnNumberToLetter(colNumber: number): string {
    let letter = '';
    let temp = colNumber;
    while (temp > 0) {
      const remainder = (temp - 1) % 26;
      letter = String.fromCharCode(65 + remainder) + letter;
      temp = Math.floor((temp - 1) / 26);
    }
    return letter;
  }

  private letterToColumnNumber(letter: string): number {
    let result = 0;
    for (let i = 0; i < letter.length; i++) {
      result = result * 26 + (letter.charCodeAt(i) - 64);
    }
    return result;
  }
}
