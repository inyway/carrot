import { NextRequest, NextResponse } from 'next/server';
import * as ExcelJS from 'exceljs';
import { cellValueToString, safeExtractCellValue, detectMultiRowHeaders } from '@/lib/cell-value-utils';

export const runtime = 'nodejs';

interface MappingItem {
  templateField: string;
  dataColumn: string;
}

// 스마트 헤더 행 찾기
async function findSmartHeaderRow(
  worksheet: ExcelJS.Worksheet
): Promise<{ headerRowNum: number; columns: string[] }> {
  const rows: Array<{ rowNum: number; values: string[]; score: number }> = [];

  for (let rowNum = 1; rowNum <= 10; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const values: string[] = [];
    let nonEmptyCount = 0;
    let hasShortLabels = 0;
    let hasSectionMarkers = 0;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const trimmed = cellValueToString(cell.value).trim();
      values[colNumber - 1] = trimmed;

      if (trimmed.length > 0) {
        nonEmptyCount++;
        if (trimmed.length >= 2 && trimmed.length <= 15) {
          hasShortLabels++;
        }
        if (/^\d+\./.test(trimmed)) {
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
  const columns = headerRow.values.filter(v => v && v.length > 0 && v !== 'undefined');

  return { headerRowNum: headerRow.rowNum, columns };
}

// Excel 데이터 추출 (multi-row 헤더 지원)
async function extractExcelData(
  buffer: Buffer,
  sheetName?: string
): Promise<{ columns: string[]; data: Record<string, unknown>[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets = workbook.worksheets.map(ws => ws.name);
  const targetSheet = sheetName || sheets[0];
  const worksheet = workbook.getWorksheet(targetSheet);

  if (!worksheet) {
    throw new Error(`시트 "${targetSheet}"를 찾을 수 없습니다.`);
  }

  const { headerRowNum } = await findSmartHeaderRow(worksheet);

  // Multi-row 헤더 감지 + 복합 컬럼명 생성
  const { compositeColumns, dataStartRow } = detectMultiRowHeaders(worksheet, headerRowNum);

  const columns = compositeColumns.map(c => c.name);
  const data: Record<string, unknown>[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum < dataStartRow) return;

    const rowData: Record<string, unknown> = {};
    let hasData = false;

    for (const { colIndex, name } of compositeColumns) {
      const cell = row.getCell(colIndex);
      const extracted = safeExtractCellValue(cell.value);

      if (extracted !== null) {
        hasData = true;
        rowData[name] = extracted;
      } else {
        rowData[name] = '';
      }
    }

    if (hasData) {
      data.push(rowData);
    }
  });

  return { columns, data };
}

// CSV 데이터 추출
function extractCsvData(buffer: Buffer): { columns: string[]; data: Record<string, unknown>[] } {
  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/).filter(line => line.trim());

  if (lines.length === 0) {
    throw new Error('CSV 파일이 비어있습니다.');
  }

  const columns = lines[0].split(',').map(col => col.trim().replace(/^"|"$/g, ''));
  const data: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx] || '';
    });
    data.push(row);
  }

  return { columns, data };
}

// JSON 데이터 추출
function extractJsonData(buffer: Buffer): { columns: string[]; data: Record<string, unknown>[] } {
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

// Excel 템플릿 기반 보고서 생성 (batch 모드 - 단일 .xlsx 출력)
async function generateExcelReports(
  templateBuffer: Buffer,
  dataBuffer: Buffer,
  mappings: MappingItem[],
  templateFormat: string,
  dataFormat: string,
  templateSheet?: string,
  dataSheet?: string,
): Promise<Buffer> {
  // 템플릿 1회만 복제
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer as unknown as ArrayBuffer);

  const targetTemplateSheet = templateSheet || workbook.worksheets[0]?.name;
  const ws = workbook.getWorksheet(targetTemplateSheet);

  if (!ws) {
    throw new Error('템플릿 시트를 찾을 수 없습니다.');
  }

  // 데이터 추출
  let dataRows: Record<string, unknown>[];

  switch (dataFormat) {
    case 'xlsx':
    case 'xls': {
      const result = await extractExcelData(dataBuffer, dataSheet);
      dataRows = result.data;
      break;
    }
    case 'csv': {
      const result = extractCsvData(dataBuffer);
      dataRows = result.data;
      break;
    }
    case 'json': {
      const result = extractJsonData(dataBuffer);
      dataRows = result.data;
      break;
    }
    default:
      throw new Error('지원하지 않는 데이터 형식입니다.');
  }

  if (dataRows.length === 0) {
    throw new Error('데이터가 없습니다.');
  }

  // 매핑 맵 생성 (템플릿 필드 -> 데이터 컬럼)
  const mappingMap = new Map<string, string>();
  for (const m of mappings) {
    if (m.templateField && m.dataColumn) {
      mappingMap.set(m.templateField, m.dataColumn);
    }
  }

  // 템플릿의 헤더 행 찾기 + multi-row 헤더 감지
  const { headerRowNum: templateHeaderRow } = await findSmartHeaderRow(ws);
  const { compositeColumns: templateCompositeColumns, dataStartRow: firstDataRow } =
    detectMultiRowHeaders(ws, templateHeaderRow);

  // 템플릿 복합 컬럼명 → 열 인덱스 매핑
  const templateColumnIndex = new Map<string, number>();
  for (const { colIndex, name } of templateCompositeColumns) {
    templateColumnIndex.set(name, colIndex);
  }

  // 첫 번째 데이터 행의 스타일 저장 (후속 행에 복사용)
  const firstRow = ws.getRow(firstDataRow);
  const styleCache = new Map<number, Partial<ExcelJS.Style>>();
  for (const { colIndex } of templateCompositeColumns) {
    const cell = firstRow.getCell(colIndex);
    if (cell.style) {
      styleCache.set(colIndex, JSON.parse(JSON.stringify(cell.style)));
    }
  }

  // 기존 데이터 행 초기화 (shared formula 충돌 방지)
  const lastRowNum = ws.rowCount;
  for (let rowNum = firstDataRow; rowNum <= lastRowNum; rowNum++) {
    const row = ws.getRow(rowNum);
    row.eachCell((cell) => {
      cell.value = null;
    });
    row.commit();
  }

  // 모든 데이터행을 하나의 워크시트에 순차 삽입
  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const rowData = dataRows[rowIdx];
    const targetRowNum = firstDataRow + rowIdx;
    const targetRow = ws.getRow(targetRowNum);

    // 매핑에 따라 데이터 채우기
    for (const [templateField, dataColumn] of Array.from(mappingMap.entries())) {
      const colIndex = templateColumnIndex.get(templateField);
      if (colIndex && rowData[dataColumn] !== undefined) {
        const cell = targetRow.getCell(colIndex);
        const value = rowData[dataColumn];

        if (value instanceof Date) {
          cell.value = value;
        } else if (typeof value === 'number') {
          cell.value = value;
        } else {
          cell.value = String(value ?? '');
        }

        // 첫 데이터 행의 스타일 적용
        const style = styleCache.get(colIndex);
        if (style) {
          cell.style = style as ExcelJS.Style;
        }
      }
    }

    targetRow.commit();
  }

  // 단일 .xlsx 반환
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// CSV 템플릿 기반 보고서 생성 (단일 CSV에 모든 데이터)
async function generateCsvReports(
  templateBuffer: Buffer,
  dataBuffer: Buffer,
  mappings: MappingItem[],
  dataFormat: string,
  dataSheet?: string
): Promise<Buffer> {
  // 템플릿 헤더 추출
  const templateText = templateBuffer.toString('utf-8');
  const templateLines = templateText.split(/\r?\n/).filter(line => line.trim());

  if (templateLines.length === 0) {
    throw new Error('템플릿 CSV가 비어있습니다.');
  }

  const templateColumns = templateLines[0].split(',').map(col => col.trim().replace(/^"|"$/g, ''));

  // 데이터 추출
  let dataRows: Record<string, unknown>[];

  switch (dataFormat) {
    case 'xlsx':
    case 'xls': {
      const result = await extractExcelData(dataBuffer, dataSheet);
      dataRows = result.data;
      break;
    }
    case 'csv': {
      const result = extractCsvData(dataBuffer);
      dataRows = result.data;
      break;
    }
    case 'json': {
      const result = extractJsonData(dataBuffer);
      dataRows = result.data;
      break;
    }
    default:
      throw new Error('지원하지 않는 데이터 형식입니다.');
  }

  // 매핑 맵 생성
  const mappingMap = new Map<string, string>();
  for (const m of mappings) {
    if (m.templateField && m.dataColumn) {
      mappingMap.set(m.templateField, m.dataColumn);
    }
  }

  // CSV 값 이스케이프
  const escapeValue = (val: unknown): string => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // 결과 CSV 생성
  const lines: string[] = [];

  // 헤더
  lines.push(templateColumns.map(escapeValue).join(','));

  // 데이터 행
  for (const rowData of dataRows) {
    const values = templateColumns.map(templateCol => {
      const dataCol = mappingMap.get(templateCol);
      if (dataCol && rowData[dataCol] !== undefined) {
        return escapeValue(rowData[dataCol]);
      }
      return '';
    });
    lines.push(values.join(','));
  }

  return Buffer.from(lines.join('\n'), 'utf-8');
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const template = formData.get('template') as File | null;
    const data = formData.get('data') as File | null;
    const templateFormat = formData.get('templateFormat') as string | null;
    const dataFormat = formData.get('dataFormat') as string | null;
    const templateSheet = formData.get('templateSheet') as string | null;
    const dataSheet = formData.get('dataSheet') as string | null;
    const mappingsJson = formData.get('mappings') as string | null;

    if (!template) {
      return NextResponse.json({ error: '템플릿 파일이 없습니다.' }, { status: 400 });
    }

    if (!data) {
      return NextResponse.json({ error: '데이터 파일이 없습니다.' }, { status: 400 });
    }

    if (!mappingsJson) {
      return NextResponse.json({ error: '매핑 정보가 없습니다.' }, { status: 400 });
    }

    const mappings: MappingItem[] = JSON.parse(mappingsJson);
    const validMappings = mappings.filter(m => m.templateField && m.dataColumn);

    if (validMappings.length === 0) {
      return NextResponse.json({ error: '유효한 매핑이 없습니다.' }, { status: 400 });
    }

    const templateBuffer = Buffer.from(await template.arrayBuffer());
    const dataBuffer = Buffer.from(await data.arrayBuffer());

    const actualTemplateFormat = templateFormat || detectFormat(template.name);
    const actualDataFormat = dataFormat || detectFormat(data.name);

    let resultBuffer: Buffer;
    let contentType: string;
    let fileName: string;

    if (actualTemplateFormat === 'xlsx') {
      // Excel 템플릿 → 단일 .xlsx (batch 모드)
      resultBuffer = await generateExcelReports(
        templateBuffer,
        dataBuffer,
        validMappings,
        actualTemplateFormat,
        actualDataFormat,
        templateSheet || undefined,
        dataSheet || undefined,
      );
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      fileName = `report_${Date.now()}.xlsx`;
    } else if (actualTemplateFormat === 'csv') {
      // CSV 템플릿 → 단일 CSV
      resultBuffer = await generateCsvReports(
        templateBuffer,
        dataBuffer,
        validMappings,
        actualDataFormat,
        dataSheet || undefined
      );
      contentType = 'text/csv; charset=utf-8';
      fileName = `reports_${Date.now()}.csv`;
    } else {
      return NextResponse.json({ error: '지원하지 않는 템플릿 형식입니다.' }, { status: 400 });
    }

    return new NextResponse(new Uint8Array(resultBuffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error('Generate error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '생성 실패' },
      { status: 500 }
    );
  }
}

function detectFormat(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'xlsx': return 'xlsx';
    case 'xls': return 'xls';
    case 'csv': return 'csv';
    case 'json': return 'json';
    default: return 'unknown';
  }
}
