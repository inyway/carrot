import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { ExcelParserPort } from '../../application/ports';
import {
  type TemplateStructureVO,
  type TemplateSheetVO,
  type TemplateBlockVO,
  type CellInfo,
  type CellStyle,
  BlockType,
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

    return TemplateStructureFactory.create(fileName, sheets);
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

    const data: Array<Record<string, unknown>> = [];
    const headers: string[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        // 첫 행을 헤더로 사용
        row.eachCell((cell, colNumber) => {
          headers[colNumber - 1] = String(cell.value || `Column${colNumber}`);
        });
      } else {
        const rowData: Record<string, unknown> = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1] || `Column${colNumber}`;
          rowData[header] = cell.value;
        });
        if (Object.keys(rowData).length > 0) {
          data.push(rowData);
        }
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

    // 블록 자동 감지
    const blocks = this.detectBlocks(cells, maxRow, maxCol);

    return {
      name: worksheet.name,
      index,
      blocks,
      rowCount: maxRow,
      colCount: maxCol,
    };
  }

  private parseCellInfo(
    cell: ExcelJS.Cell,
    rowNumber: number,
    colNumber: number,
  ): CellInfo {
    const address = this.columnNumberToLetter(colNumber) + rowNumber;

    let value: CellInfo['value'] = null;
    if (cell.value !== null && cell.value !== undefined) {
      if (typeof cell.value === 'object' && 'result' in cell.value) {
        // formula result
        value = cell.value.result as CellInfo['value'];
      } else if (typeof cell.value === 'object' && 'richText' in cell.value) {
        // rich text
        value = (cell.value.richText as Array<{ text: string }>)
          .map((t) => t.text)
          .join('');
      } else if (cell.value instanceof Date) {
        value = cell.value;
      } else {
        value = cell.value as string | number | boolean;
      }
    }

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

    // 셀을 그리드로 변환
    const grid: Map<string, CellInfo> = new Map();
    cells.forEach((cell) => grid.set(cell.address, cell));

    // 연속된 영역 찾기 (간단한 알고리즘)
    const visited = new Set<string>();
    let blockCounter = 0;

    for (let row = 1; row <= maxRow; row++) {
      for (let col = 1; col <= maxCol; col++) {
        const address = this.columnNumberToLetter(col) + row;
        if (visited.has(address) || !grid.has(address)) continue;

        // 연속된 영역 탐색
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

    // 행 방향으로 연속된 셀 찾기
    for (let col = startCol; col <= maxCol; col++) {
      const address = this.columnNumberToLetter(col) + startRow;
      if (!grid.has(address)) break;
      endCol = col;
    }

    // 열 방향으로 연속된 행 찾기
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

    // 영역 내 모든 셀 수집
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

    // 여러 행과 열이 있는 경우 → TABLE
    if (rowCount > 2 && colCount > 1) {
      return BlockType.TABLE;
    }

    // 숫자나 수식이 많은 경우 → METRIC_BLOCK
    if (hasNumbers || hasFormulas) {
      return BlockType.METRIC_BLOCK;
    }

    // 첫 행이고 굵은 글씨가 있는 경우 → HEADER
    const firstRowCells = cells.filter(
      (c) => parseInt(c.address.replace(/[A-Z]+/g, '')) === 1,
    );
    if (
      firstRowCells.length > 0 &&
      firstRowCells.some((c) => c.style?.font?.bold)
    ) {
      return BlockType.HEADER;
    }

    // 긴 텍스트가 있는 경우 → TEXT_STATIC (나중에 TEXT_AI로 변환 가능)
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
        // 첫 행을 헤더로 추정
        const rows = [...new Set(cells.map((c) => parseInt(c.address.replace(/[A-Z]+/g, ''))))].sort((a, b) => a - b);
        return { headerRow: rows[0] };
      }
      case BlockType.METRIC_BLOCK: {
        // 수식이 있는 셀의 주소를 메트릭 키로 사용
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
}
