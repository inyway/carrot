import { NextRequest, NextResponse } from 'next/server';
import * as ExcelJS from 'exceljs';
import { cellValueToString, safeExtractCellValue, detectMultiRowHeaders } from '@/lib/cell-value-utils';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

export const runtime = 'nodejs';

type FileFormat = 'xlsx' | 'xls' | 'csv' | 'json' | 'hwpx';

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

// Excel로 변환
async function convertToExcel(
  columns: string[],
  data: Record<string, unknown>[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  // 헤더 추가
  worksheet.addRow(columns);

  // 헤더 스타일링
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  // 데이터 추가
  for (const row of data) {
    const values = columns.map(col => row[col] ?? '');
    worksheet.addRow(values);
  }

  // 컬럼 너비 자동 조정
  worksheet.columns.forEach((column) => {
    column.width = 15;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// CSV로 변환
function convertToCsv(columns: string[], data: Record<string, unknown>[]): Buffer {
  const escapeValue = (val: unknown): string => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines: string[] = [];

  // 헤더
  lines.push(columns.map(escapeValue).join(','));

  // 데이터
  for (const row of data) {
    const values = columns.map(col => escapeValue(row[col]));
    lines.push(values.join(','));
  }

  return Buffer.from(lines.join('\n'), 'utf-8');
}

// JSON으로 변환
function convertToJson(data: Record<string, unknown>[]): Buffer {
  return Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
}

// HWPX로 변환 (기존 HWPX API로 리다이렉트)
async function convertToHwpx(
  sourceBuffer: Buffer,
  templateBuffer: Buffer,
  sheetName?: string
): Promise<Buffer> {
  // NestJS API 호출
  const formData = new FormData();
  formData.append('template', new Blob([new Uint8Array(templateBuffer)]), 'template.hwpx');
  formData.append('excel', new Blob([new Uint8Array(sourceBuffer)]), 'data.xlsx');
  if (sheetName) {
    formData.append('sheetName', sheetName);
  }

  // AI 매핑으로 자동 매핑
  const mappingRes = await fetch(`${API_BASE_URL}/excel-formatter/hwpx/ai-mapping`, {
    method: 'POST',
    body: formData,
  });

  if (!mappingRes.ok) {
    throw new Error('HWPX 매핑 실패');
  }

  const mappingResult = await mappingRes.json();
  const mappings = mappingResult.mappings || [];

  if (mappings.length === 0) {
    throw new Error('HWPX 매핑을 생성할 수 없습니다.');
  }

  // 생성 요청
  const generateFormData = new FormData();
  generateFormData.append('template', new Blob([new Uint8Array(templateBuffer)]), 'template.hwpx');
  generateFormData.append('excel', new Blob([new Uint8Array(sourceBuffer)]), 'data.xlsx');
  if (sheetName) {
    generateFormData.append('sheetName', sheetName);
  }
  generateFormData.append('mappings', JSON.stringify(mappings));

  const generateRes = await fetch(`${API_BASE_URL}/excel-formatter/hwpx/generate`, {
    method: 'POST',
    body: generateFormData,
  });

  if (!generateRes.ok) {
    throw new Error('HWPX 생성 실패');
  }

  return Buffer.from(await generateRes.arrayBuffer());
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const sourceFormat = formData.get('sourceFormat') as FileFormat | null;
    const targetFormat = formData.get('targetFormat') as FileFormat | null;
    const sheetName = formData.get('sheetName') as string | null;
    const template = formData.get('template') as File | null;

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }

    if (!targetFormat) {
      return NextResponse.json({ error: '변환 형식을 선택해주세요.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // HWPX 변환의 경우 별도 처리
    if (targetFormat === 'hwpx') {
      if (!template) {
        return NextResponse.json({ error: 'HWPX 템플릿이 필요합니다.' }, { status: 400 });
      }

      const templateBuffer = Buffer.from(await template.arrayBuffer());
      const result = await convertToHwpx(buffer, templateBuffer, sheetName || undefined);

      return new NextResponse(new Uint8Array(result), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="hwpx_output_${Date.now()}.zip"`,
        },
      });
    }

    // 소스 데이터 추출
    let columns: string[];
    let data: Record<string, unknown>[];

    const actualFormat = sourceFormat || detectFormatFromName(file.name);

    switch (actualFormat) {
      case 'xlsx':
      case 'xls': {
        const result = await extractExcelData(buffer, sheetName || undefined);
        columns = result.columns;
        data = result.data;
        break;
      }
      case 'csv': {
        const result = extractCsvData(buffer);
        columns = result.columns;
        data = result.data;
        break;
      }
      case 'json': {
        const result = extractJsonData(buffer);
        columns = result.columns;
        data = result.data;
        break;
      }
      default:
        return NextResponse.json({ error: '지원하지 않는 소스 형식입니다.' }, { status: 400 });
    }

    // 타겟 형식으로 변환
    let resultBuffer: Buffer;
    let contentType: string;
    let fileName: string;

    switch (targetFormat) {
      case 'xlsx': {
        resultBuffer = await convertToExcel(columns, data);
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileName = `converted_${Date.now()}.xlsx`;
        break;
      }
      case 'csv': {
        resultBuffer = convertToCsv(columns, data);
        contentType = 'text/csv; charset=utf-8';
        fileName = `converted_${Date.now()}.csv`;
        break;
      }
      case 'json': {
        resultBuffer = convertToJson(data);
        contentType = 'application/json';
        fileName = `converted_${Date.now()}.json`;
        break;
      }
      default:
        return NextResponse.json({ error: '지원하지 않는 타겟 형식입니다.' }, { status: 400 });
    }

    return new NextResponse(new Uint8Array(resultBuffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error('Convert error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '변환 실패' },
      { status: 500 }
    );
  }
}

function detectFormatFromName(fileName: string): FileFormat | 'unknown' {
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'xlsx':
      return 'xlsx';
    case 'xls':
      return 'xls';
    case 'csv':
      return 'csv';
    case 'json':
      return 'json';
    case 'hwpx':
      return 'hwpx';
    default:
      return 'unknown';
  }
}
