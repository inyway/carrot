import { NextRequest, NextResponse } from 'next/server';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';

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
      const value = cell.value;
      let text = '';

      if (value !== null && value !== undefined) {
        if (typeof value === 'object' && value !== null && 'richText' in (value as object)) {
          const richTextVal = value as { richText: Array<{ text: string }> };
          text = (richTextVal.richText || []).map((t) => t.text).join('');
        } else if (typeof value === 'object' && value !== null && 'result' in (value as object)) {
          const resultVal = value as { result: unknown };
          text = String(resultVal.result);
        } else {
          text = String(value);
        }
      }

      const trimmed = text.trim();
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

// Excel 데이터 추출
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

  // 컬럼 인덱스 매핑 생성
  const headerRow = worksheet.getRow(headerRowNum);
  const columnIndexToName: Array<{ colIndex: number; name: string }> = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const value = cell.value;
    let text = '';

    if (value !== null && value !== undefined) {
      if (typeof value === 'object' && value !== null && 'richText' in (value as object)) {
        const richTextVal = value as { richText: Array<{ text: string }> };
        text = (richTextVal.richText || []).map((t) => t.text).join('');
      } else if (typeof value === 'object' && value !== null && 'result' in (value as object)) {
        const resultVal = value as { result: unknown };
        text = String(resultVal.result);
      } else {
        text = String(value);
      }
    }

    const trimmed = text.trim();
    if (trimmed.length > 0 && trimmed !== 'undefined') {
      columnIndexToName.push({ colIndex: colNumber, name: trimmed });
    }
  });

  const columns = columnIndexToName.map(c => c.name);
  const data: Record<string, unknown>[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= headerRowNum) return;

    const rowData: Record<string, unknown> = {};
    let hasData = false;

    for (const { colIndex, name } of columnIndexToName) {
      const cell = row.getCell(colIndex);
      const value = cell.value;

      if (value !== null && value !== undefined) {
        hasData = true;
        if (value instanceof Date) {
          rowData[name] = value.toISOString().split('T')[0];
        } else if (typeof value === 'object' && 'richText' in (value as object)) {
          const richTextVal = value as { richText: Array<{ text: string }> };
          rowData[name] = (richTextVal.richText || []).map((t) => t.text).join('');
        } else if (typeof value === 'object' && 'result' in (value as object)) {
          const resultVal = value as { result: unknown };
          rowData[name] = resultVal.result;
        } else {
          rowData[name] = value;
        }
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

// Excel 템플릿 기반 보고서 생성
async function generateExcelReports(
  templateBuffer: Buffer,
  dataBuffer: Buffer,
  mappings: MappingItem[],
  templateFormat: string,
  dataFormat: string,
  templateSheet?: string,
  dataSheet?: string,
  fileNameColumn?: string
): Promise<Buffer> {
  // 템플릿 로드
  const templateWorkbook = new ExcelJS.Workbook();
  await templateWorkbook.xlsx.load(templateBuffer as unknown as ArrayBuffer);

  const targetTemplateSheet = templateSheet || templateWorkbook.worksheets[0]?.name;
  const templateWs = templateWorkbook.getWorksheet(targetTemplateSheet);

  if (!templateWs) {
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

  // 템플릿의 헤더 행 찾기
  const { headerRowNum: templateHeaderRow } = await findSmartHeaderRow(templateWs);

  // 템플릿 컬럼 위치 매핑 (컬럼명 -> 열 인덱스)
  const templateColumnIndex = new Map<string, number>();
  const headerRow = templateWs.getRow(templateHeaderRow);

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
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

    const trimmed = text.trim();
    if (trimmed) {
      templateColumnIndex.set(trimmed, colNumber);
    }
  });

  // ZIP 생성
  const zip = new JSZip();

  // 각 데이터 행에 대해 개별 Excel 파일 생성
  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const rowData = dataRows[rowIdx];

    // 새 워크북 생성 (템플릿 복사)
    const newWorkbook = new ExcelJS.Workbook();
    await newWorkbook.xlsx.load(templateBuffer as unknown as ArrayBuffer);

    const newWs = newWorkbook.getWorksheet(targetTemplateSheet);
    if (!newWs) continue;

    // 데이터 행 위치 (템플릿 헤더 다음 행)
    const dataRowNum = templateHeaderRow + 1;
    const targetRow = newWs.getRow(dataRowNum);

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
      }
    }

    targetRow.commit();

    // 파일명 결정
    let fileName: string;
    if (fileNameColumn && rowData[fileNameColumn]) {
      // 파일명에 사용할 수 없는 문자 제거
      fileName = String(rowData[fileNameColumn])
        .replace(/[\/\\:*?"<>|]/g, '_')
        .trim();
    } else {
      fileName = `report_${rowIdx + 1}`;
    }

    // Excel 파일을 버퍼로 변환
    const fileBuffer = await newWorkbook.xlsx.writeBuffer();
    zip.file(`${fileName}.xlsx`, fileBuffer);
  }

  // ZIP 파일 생성
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
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
    const fileNameColumn = formData.get('fileNameColumn') as string | null;

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
      // Excel 템플릿 → ZIP (각 행별 Excel 파일)
      resultBuffer = await generateExcelReports(
        templateBuffer,
        dataBuffer,
        validMappings,
        actualTemplateFormat,
        actualDataFormat,
        templateSheet || undefined,
        dataSheet || undefined,
        fileNameColumn || undefined
      );
      contentType = 'application/zip';
      fileName = `reports_${Date.now()}.zip`;
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
