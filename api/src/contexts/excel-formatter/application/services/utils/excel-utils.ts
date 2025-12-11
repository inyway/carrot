import * as ExcelJS from 'exceljs';

/**
 * Excel 셀에서 텍스트 추출
 */
export function getCellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  let text = '';

  if (value !== null && value !== undefined) {
    if (typeof value === 'object' && 'richText' in (value as object)) {
      const richTextVal = value as { richText: Array<{ text: string }> };
      text = (richTextVal.richText || []).map((t) => t.text).join('');
    } else if (typeof value === 'object' && 'result' in (value as object)) {
      const resultVal = value as { result: unknown };
      text = String(resultVal.result);
    } else {
      text = String(value);
    }
  }

  return text.trim();
}

/**
 * 셀 값을 적절한 타입으로 추출
 */
export function extractCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;

  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  if (typeof value === 'object' && 'richText' in (value as object)) {
    const richTextVal = value as { richText: Array<{ text: string }> };
    return (richTextVal.richText || []).map((t) => t.text).join('');
  }

  if (typeof value === 'object' && 'result' in (value as object)) {
    const resultVal = value as { result: unknown };
    return resultVal.result;
  }

  return value;
}

/**
 * 스마트 헤더 행 찾기
 * 데이터가 많고 짧은 라벨이 있는 행을 헤더로 선택
 */
export async function findSmartHeaderRow(
  worksheet: ExcelJS.Worksheet,
  maxRowsToScan = 10,
): Promise<{ headerRowNum: number; columns: string[] }> {
  const rows: Array<{ rowNum: number; values: string[]; score: number }> = [];

  for (let rowNum = 1; rowNum <= maxRowsToScan; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const values: string[] = [];
    let nonEmptyCount = 0;
    let hasShortLabels = 0;
    let hasSectionMarkers = 0;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const text = getCellText(cell);
      values[colNumber - 1] = text;

      if (text.length > 0) {
        nonEmptyCount++;
        if (text.length >= 2 && text.length <= 15) {
          hasShortLabels++;
        }
        if (/^\d+\./.test(text)) {
          hasSectionMarkers++;
        }
      }
    });

    const score = nonEmptyCount * 2 + hasShortLabels * 3 - hasSectionMarkers * 10;

    if (nonEmptyCount >= 3) {
      rows.push({ rowNum, values, score });
    }
  }

  rows.sort((a, b) => b.score - a.score);

  if (rows.length === 0) {
    return { headerRowNum: 1, columns: [] };
  }

  const headerRow = rows[0];
  const columns = headerRow.values.filter(
    (v) => v && v.length > 0 && v !== 'undefined',
  );

  return { headerRowNum: headerRow.rowNum, columns };
}

/**
 * Excel 데이터 추출
 */
export async function extractExcelData(
  buffer: Buffer,
  sheetName?: string,
): Promise<{ columns: string[]; data: Record<string, unknown>[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets = workbook.worksheets.map((ws) => ws.name);
  const targetSheet = sheetName || sheets[0];
  const worksheet = workbook.getWorksheet(targetSheet);

  if (!worksheet) {
    throw new Error(`시트 "${targetSheet}"를 찾을 수 없습니다.`);
  }

  const { headerRowNum } = await findSmartHeaderRow(worksheet);
  const headerRow = worksheet.getRow(headerRowNum);
  const columnIndexToName: Array<{ colIndex: number; name: string }> = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = getCellText(cell);
    if (text && text !== 'undefined') {
      columnIndexToName.push({ colIndex: colNumber, name: text });
    }
  });

  const columns = columnIndexToName.map((c) => c.name);
  const data: Record<string, unknown>[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= headerRowNum) return;

    const rowData: Record<string, unknown> = {};
    let hasData = false;

    for (const { colIndex, name } of columnIndexToName) {
      const cell = row.getCell(colIndex);
      const value = extractCellValue(cell);

      if (value !== null && value !== undefined && value !== '') {
        hasData = true;
      }
      rowData[name] = value;
    }

    if (hasData) {
      data.push(rowData);
    }
  });

  return { columns, data };
}

/**
 * CSV 데이터 추출
 */
export function extractCsvData(
  buffer: Buffer,
): { columns: string[]; data: Record<string, unknown>[] } {
  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error('CSV 파일이 비어있습니다.');
  }

  const columns = lines[0]
    .split(',')
    .map((col) => col.trim().replace(/^"|"$/g, ''));
  const data: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]
      .split(',')
      .map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx] || '';
    });
    data.push(row);
  }

  return { columns, data };
}

/**
 * JSON 데이터 추출
 */
export function extractJsonData(
  buffer: Buffer,
): { columns: string[]; data: Record<string, unknown>[] } {
  const text = buffer.toString('utf-8');
  const parsed = JSON.parse(text);

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new Error('JSON 배열이 비어있습니다.');
    }
    const columns = Object.keys(parsed[0] || {});
    return { columns, data: parsed };
  }

  if (typeof parsed === 'object' && parsed !== null) {
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
        const columns = Object.keys(parsed[key][0] || {});
        return { columns, data: parsed[key] };
      }
    }
  }

  throw new Error('JSON 구조를 인식할 수 없습니다.');
}

/**
 * CSV 값 이스케이프
 */
export function escapeCsvValue(val: unknown): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
