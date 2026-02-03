import { NextRequest, NextResponse } from 'next/server';
import * as ExcelJS from 'exceljs';
import { cellValueToString, safeExtractCellValue, detectMultiRowHeaders, isRepeatedHeaderOrMetadata } from '@/lib/cell-value-utils';

export const runtime = 'nodejs';

type FileFormat = 'xlsx' | 'xls' | 'csv' | 'json' | 'hwpx' | 'unknown';

interface AnalyzeResult {
  success: boolean;
  format: FileFormat;
  columns?: string[];
  sheets?: string[];
  rowCount?: number;
  preview?: Record<string, unknown>[];
  error?: string;
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

// Excel/CSV 분석
async function analyzeExcel(
  buffer: Buffer,
  sheetName?: string
): Promise<AnalyzeResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets = workbook.worksheets.map(ws => ws.name);

  if (sheets.length === 0) {
    return { success: false, format: 'xlsx', error: '워크시트가 없습니다.' };
  }

  const targetSheet = sheetName || sheets[0];
  const worksheet = workbook.getWorksheet(targetSheet);

  if (!worksheet) {
    return { success: false, format: 'xlsx', error: `시트 "${targetSheet}"를 찾을 수 없습니다.` };
  }

  // 스마트 헤더 감지
  const { headerRowNum } = await findSmartHeaderRow(worksheet);

  // Multi-row 헤더 감지 + 복합 컬럼명 생성
  const { compositeColumns, dataStartRow } = detectMultiRowHeaders(worksheet, headerRowNum);
  const columns = compositeColumns.map(c => c.name);

  // 데이터 추출 (미리보기용 최대 100행)
  const preview: Record<string, unknown>[] = [];
  let rowCount = 0;

  // 컬럼 인덱스 매핑은 compositeColumns에서 직접 사용
  const columnIndexToName = compositeColumns;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum < dataStartRow) return;

    if (preview.length < 100) {
      const rowData: Record<string, unknown> = {};
      let hasData = false;

      for (const { colIndex, name } of columnIndexToName) {
        const cell = row.getCell(colIndex);
        const extracted = safeExtractCellValue(cell.value);

        if (extracted !== null) {
          hasData = true;
          rowData[name] = extracted;
        }
      }

      if (hasData && !isRepeatedHeaderOrMetadata(rowData, columns)) {
        rowCount++;
        preview.push(rowData);
      }
    } else {
      // 미리보기 범위 밖이라도 행 수는 계속 카운트
      const rowData: Record<string, unknown> = {};
      let hasData = false;
      for (const { colIndex, name } of columnIndexToName) {
        const extracted = safeExtractCellValue(row.getCell(colIndex).value);
        if (extracted !== null) { hasData = true; rowData[name] = extracted; }
      }
      if (hasData && !isRepeatedHeaderOrMetadata(rowData, columns)) {
        rowCount++;
      }
    }
  });

  return {
    success: true,
    format: 'xlsx',
    columns,
    sheets,
    rowCount,
    preview,
  };
}

// CSV 분석
async function analyzeCsv(buffer: Buffer): Promise<AnalyzeResult> {
  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/).filter(line => line.trim());

  if (lines.length === 0) {
    return { success: false, format: 'csv', error: 'CSV 파일이 비어있습니다.' };
  }

  // 첫 줄을 헤더로 사용
  const columns = lines[0].split(',').map(col => col.trim().replace(/^"|"$/g, ''));

  // 데이터 파싱
  const preview: Record<string, unknown>[] = [];
  for (let i = 1; i < Math.min(lines.length, 101); i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx] || '';
    });
    preview.push(row);
  }

  return {
    success: true,
    format: 'csv',
    columns,
    rowCount: lines.length - 1,
    preview,
  };
}

// JSON 분석
async function analyzeJson(buffer: Buffer): Promise<AnalyzeResult> {
  try {
    const text = buffer.toString('utf-8');
    const data = JSON.parse(text);

    // 배열인 경우
    if (Array.isArray(data)) {
      if (data.length === 0) {
        return { success: false, format: 'json', error: 'JSON 배열이 비어있습니다.' };
      }

      const columns = Object.keys(data[0] || {});
      const preview = data.slice(0, 100);

      return {
        success: true,
        format: 'json',
        columns,
        rowCount: data.length,
        preview,
      };
    }

    // 객체인 경우 - 첫 번째 배열 값을 찾기
    if (typeof data === 'object' && data !== null) {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          const columns = Object.keys(data[key][0] || {});
          const preview = data[key].slice(0, 100);

          return {
            success: true,
            format: 'json',
            columns,
            sheets: Object.keys(data).filter(k => Array.isArray(data[k])),
            rowCount: data[key].length,
            preview,
          };
        }
      }
    }

    return { success: false, format: 'json', error: 'JSON 구조를 인식할 수 없습니다.' };
  } catch {
    return { success: false, format: 'json', error: 'JSON 파싱 실패' };
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const format = formData.get('format') as FileFormat | null;
    const sheetName = formData.get('sheetName') as string | null;

    if (!file) {
      return NextResponse.json({ success: false, error: '파일이 없습니다.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let result: AnalyzeResult;

    switch (format) {
      case 'xlsx':
      case 'xls':
        result = await analyzeExcel(buffer, sheetName || undefined);
        break;
      case 'csv':
        result = await analyzeCsv(buffer);
        break;
      case 'json':
        result = await analyzeJson(buffer);
        break;
      default:
        // 확장자로 판단
        const ext = file.name.toLowerCase().split('.').pop();
        if (ext === 'xlsx' || ext === 'xls') {
          result = await analyzeExcel(buffer, sheetName || undefined);
        } else if (ext === 'csv') {
          result = await analyzeCsv(buffer);
        } else if (ext === 'json') {
          result = await analyzeJson(buffer);
        } else {
          result = { success: false, format: 'unknown', error: '지원하지 않는 파일 형식입니다.' };
        }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Analyze error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '분석 실패' },
      { status: 500 }
    );
  }
}
