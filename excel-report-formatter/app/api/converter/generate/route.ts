import { NextRequest, NextResponse } from 'next/server';
import * as ExcelJS from 'exceljs';
import { safeExtractCellValue, detectMultiRowHeaders, isRepeatedHeaderOrMetadata, findSmartHeaderRow, mergePairedRows } from '@/lib/cell-value-utils';

export const runtime = 'nodejs';

interface MappingItem {
  templateField: string;
  dataColumn: string;
  isMetadata?: boolean;
  metadataValue?: string;
}

type SummaryFormulaKey =
  | 'totalSessions'
  | 'attended'
  | 'absent'
  | 'excused'
  | 'realAttendanceRate'
  | 'attendanceRate';

interface ParsedDate {
  month?: number;
  day?: number;
}

function isBlankCellValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function normalizeColName(name: string): string {
  return name.replace(/\n/g, ' ').replace(/\.+$/, '').trim();
}

function isAttendanceColumn(colName: string): boolean {
  const normalized = normalizeColName(colName);
  if (/출결|출석률|결석|합계|비고|미참석|출석\s*\(|공결/i.test(normalized)) return false;
  if (/(?<!\d)회차\s*$/i.test(normalized)) return false;
  return /\d+\s*(week|월|회차)/i.test(normalized);
}

function isSummaryColumn(colName: string): boolean {
  const normalized = normalizeColName(colName);
  if (/출석\s*\(|결석\s*\(|지각\s*\(|출석률|실\s*출석률|BZ|공결|미참석|업무/i.test(normalized)) return true;
  if (/(?<!\d)회차\s*$/i.test(normalized)) return true;
  return false;
}

function extractDatesFromTemplateCol(colName: string): ParsedDate[] {
  const dates: ParsedDate[] = [];
  const regex = /(\d{1,2})월\s*(\d{1,2})일/g;
  let match;
  while ((match = regex.exec(colName)) !== null) {
    dates.push({ month: parseInt(match[1], 10), day: parseInt(match[2], 10) });
  }
  return dates;
}

function extractMonthFromDataCol(colName: string): number | null {
  // Korean format: "12월"
  const korMatch = colName.match(/(\d{1,2})월/);
  if (korMatch) return parseInt(korMatch[1], 10);
  // ISO date format: "2026-01-05"
  const isoMatch = colName.match(/\d{4}-(\d{2})-\d{2}/);
  if (isoMatch) return parseInt(isoMatch[1], 10);
  return null;
}

function extractDayFromSampleValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2})\s*\(/);
  return match ? parseInt(match[1], 10) : null;
}

function columnNumberToName(columnNumber: number): string {
  let result = '';
  let current = columnNumber;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function buildRowAttendanceMap(
  rowData: Record<string, unknown>,
  dataColumns: string[],
): Map<string, unknown> {
  const attendanceMap = new Map<string, unknown>();
  const pairMap = new Map<string, { schedule?: string; attendance?: string }>();

  for (const col of dataColumns) {
    const scheduleMatch = col.match(/^(.*)\(일정\)$/);
    const attendanceMatch = col.match(/^(.*)\(출결\)$/);

    if (scheduleMatch) {
      const base = scheduleMatch[1].trim();
      pairMap.set(base, { ...(pairMap.get(base) || {}), schedule: col });
    }

    if (attendanceMatch) {
      const base = attendanceMatch[1].trim();
      pairMap.set(base, { ...(pairMap.get(base) || {}), attendance: col });
    }
  }

  for (const [base, pair] of Array.from(pairMap.entries())) {
    if (!pair.schedule || !pair.attendance) continue;

    const month = extractMonthFromDataCol(base);
    const day = extractDayFromSampleValue(rowData[pair.schedule]);
    if (!month || day === null) continue;

    attendanceMap.set(`${month}-${day}`, rowData[pair.attendance] ?? null);
  }

  return attendanceMap;
}

function resolveAttendanceSymbolForTemplateField(
  templateField: string,
  rowAttendanceMap: Map<string, unknown>,
  fallbackValue: unknown,
): unknown {
  const dates = extractDatesFromTemplateCol(templateField);

  for (const date of dates) {
    if (!date.month || !date.day) continue;
    const key = `${date.month}-${date.day}`;
    if (rowAttendanceMap.has(key)) {
      return rowAttendanceMap.get(key) ?? null;
    }
  }

  return fallbackValue;
}

function buildSummaryFormulaMap(templateColumns: string[]): Map<string, SummaryFormulaKey> {
  const result = new Map<string, SummaryFormulaKey>();

  for (const col of templateColumns) {
    if (!isSummaryColumn(col)) continue;

    const normalized = normalizeColName(col).toLowerCase();
    if (normalized.includes('출석') && normalized.includes('률')) {
      result.set(col, normalized.includes('실') ? 'realAttendanceRate' : 'attendanceRate');
    } else if (normalized.includes('결석') || normalized.includes('(n') || normalized.includes(',c')) {
      result.set(col, 'absent');
    } else if (normalized.includes('공결') || normalized.includes('bz')) {
      result.set(col, 'excused');
    } else if (normalized.includes('회차')) {
      result.set(col, 'totalSessions');
    } else if (normalized.includes('출석') || normalized.includes('(y')) {
      result.set(col, 'attended');
    }
  }

  return result;
}

function buildSummaryFormula(
  formulaKey: SummaryFormulaKey,
  attendanceRange: string,
): ExcelJS.CellFormulaValue {
  const attendedFormula = `COUNTIF(${attendanceRange},"Y")+COUNTIF(${attendanceRange},"L")`;
  const absentFormula = `COUNTIF(${attendanceRange},"N")+COUNTIF(${attendanceRange},"C")`;
  const excusedFormula = `COUNTIF(${attendanceRange},"BZ")+COUNTIF(${attendanceRange},"VA")`;
  const totalFormula = `COUNTA(${attendanceRange})`;

  switch (formulaKey) {
    case 'totalSessions':
      return { formula: totalFormula };
    case 'attended':
      return { formula: attendedFormula };
    case 'absent':
      return { formula: absentFormula };
    case 'excused':
      return { formula: excusedFormula };
    case 'realAttendanceRate':
      return { formula: `IF(${totalFormula}>0,(${attendedFormula})/${totalFormula}*100,0)` };
    case 'attendanceRate':
      return { formula: `IF(${totalFormula}>0,(${attendedFormula}+${excusedFormula})/${totalFormula}*100,0)` };
  }
}

function resetWorksheetView(worksheet: ExcelJS.Worksheet) {
  const focusCell = 'A1';
  const currentView = worksheet.views?.[0];

  if (currentView) {
    worksheet.views = [{
      ...currentView,
      activeCell: focusCell,
      topLeftCell: focusCell,
    }];
    return;
  }

  worksheet.views = [{
    state: 'normal',
    activeCell: focusCell,
    showGridLines: true,
    showRowColHeaders: true,
  }];
}

function resetWorkbookView(workbook: ExcelJS.Workbook, activeSheetIndex: number) {
  const normalizedIndex = Math.max(0, activeSheetIndex);
  const currentView = workbook.views?.[0];

  if (currentView) {
    workbook.views = [{
      ...currentView,
      activeTab: normalizedIndex,
      firstSheet: normalizedIndex,
    }];
    return;
  }

  workbook.views = [{
    x: 0,
    y: 0,
    width: 16000,
    height: 9000,
    visibility: 'visible',
    firstSheet: normalizedIndex,
    activeTab: normalizedIndex,
  }];
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

  const { headerRowNum } = findSmartHeaderRow(worksheet);

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
        rowData[name] = null;
      }
    }

    if (hasData && !isRepeatedHeaderOrMetadata(rowData, columns)) {
      data.push(rowData);
    }
  });

  // 교대 패턴(이메일 행 + 출결 행) 감지 및 병합
  const merged = mergePairedRows(data, columns);
  return { columns: merged.columns, data: merged.rows };
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
      row[col] = values[idx] ? values[idx] : null;
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
  let dataColumns: string[];

  switch (dataFormat) {
    case 'xlsx':
    case 'xls': {
      const result = await extractExcelData(dataBuffer, dataSheet);
      dataColumns = result.columns;
      dataRows = result.data;
      break;
    }
    case 'csv': {
      const result = extractCsvData(dataBuffer);
      dataColumns = result.columns;
      dataRows = result.data;
      break;
    }
    case 'json': {
      const result = extractJsonData(dataBuffer);
      dataColumns = result.columns;
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

  // Metadata mappings lookup (templateField -> metadataValue)
  const metadataMappings = new Map<string, string>();
  for (const m of mappings) {
    if (m.isMetadata && m.metadataValue && m.templateField) {
      metadataMappings.set(m.templateField, m.metadataValue);
    }
  }

  // 템플릿의 헤더 행 찾기 + multi-row 헤더 감지
  const { headerRowNum: templateHeaderRow } = await findSmartHeaderRow(ws);
  const { compositeColumns: templateCompositeColumns, dataStartRow: firstDataRow } =
    detectMultiRowHeaders(ws, templateHeaderRow);
  const templateColumns = templateCompositeColumns.map(c => c.name);

  // 템플릿 복합 컬럼명 → 열 인덱스 매핑
  const templateColumnIndex = new Map<string, number>();
  for (const { colIndex, name } of templateCompositeColumns) {
    templateColumnIndex.set(name, colIndex);
  }

  const templateAttendanceFields = templateColumns.filter(isAttendanceColumn);
  const templateSummaryFields = templateColumns.filter(isSummaryColumn);
  const attendanceFieldSet = new Set(templateAttendanceFields);
  const summaryFieldSet = new Set(templateSummaryFields);
  const isAttendanceReport = templateAttendanceFields.length >= 3 && dataColumns.filter(isAttendanceColumn).length >= 3;
  const summaryFormulaMap = isAttendanceReport ? buildSummaryFormulaMap(templateColumns) : new Map<string, SummaryFormulaKey>();
  const attendanceColumnNumbers = templateAttendanceFields
    .map(field => templateColumnIndex.get(field))
    .filter((value): value is number => value !== undefined);
  const attendanceRange = attendanceColumnNumbers.length > 0
    ? `${columnNumberToName(Math.min(...attendanceColumnNumbers))}${firstDataRow}:${columnNumberToName(Math.max(...attendanceColumnNumbers))}${firstDataRow}`
    : null;

  // 첫 번째 데이터 행의 스타일 저장 (후속 행에 복사용)
  const firstRow = ws.getRow(firstDataRow);
  const styleCache = new Map<number, Partial<ExcelJS.Style>>();
  for (const { colIndex } of templateCompositeColumns) {
    const cell = firstRow.getCell(colIndex);
    if (cell.style) {
      styleCache.set(colIndex, JSON.parse(JSON.stringify(cell.style)));
    }
  }

  const lastRowNum = ws.rowCount;

  // === Phase 1: Shared formula → standalone formula 변환 (충돌 방지) ===
  for (let rowNum = firstDataRow; rowNum <= lastRowNum; rowNum++) {
    const row = ws.getRow(rowNum);
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value && typeof cell.value === 'object' &&
          ('sharedFormula' in cell.value ||
           (cell.value as unknown as Record<string, unknown>).shareType === 'shared')) {
        const translatedFormula = cell.formula; // ExcelJS _getTranslatedFormula()
        const result = cell.result;
        if (translatedFormula) {
          cell.value = { formula: translatedFormula, result } as ExcelJS.CellFormulaValue;
        }
      }
    });
    row.commit();
  }

  // === Phase 2: 매핑된 컬럼만 선택 초기화 (미매핑 컬럼 보존) ===
  const mappedColIndices = new Set<number>();
  for (const [templateField] of Array.from(mappingMap.entries())) {
    const colIndex = templateColumnIndex.get(templateField);
    if (isAttendanceReport && summaryFieldSet.has(templateField)) continue;
    if (colIndex) mappedColIndices.add(colIndex);
  }

  for (let rowNum = firstDataRow; rowNum <= lastRowNum; rowNum++) {
    const row = ws.getRow(rowNum);
    mappedColIndices.forEach((colIdx) => {
      row.getCell(colIdx).value = null;
    });
    row.commit();
  }

  // === Phase 4 준비: 첫 데이터 행의 미매핑 컬럼 수식 스냅샷 ===
  const formulaSnapshot = new Map<number, { formula: string; style: Partial<ExcelJS.Style> }>();
  for (const { colIndex } of templateCompositeColumns) {
    if (!mappedColIndices.has(colIndex)) {
      const cell = ws.getRow(firstDataRow).getCell(colIndex);
      if (cell.formula) {
        formulaSnapshot.set(colIndex, {
          formula: cell.formula,
          style: JSON.parse(JSON.stringify(cell.style || {})),
        });
      }
    }
  }

  // === Phase 3: 데이터 쓰기 (매핑된 컬럼만) ===
  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const rowData = dataRows[rowIdx];
    const targetRowNum = firstDataRow + rowIdx;
    const targetRow = ws.getRow(targetRowNum);
    const rowAttendanceMap = isAttendanceReport ? buildRowAttendanceMap(rowData, dataColumns) : null;

    // 매핑에 따라 데이터 채우기
    for (const [templateField, dataColumn] of Array.from(mappingMap.entries())) {
      const colIndex = templateColumnIndex.get(templateField);
      if (!colIndex) continue;
      if (isAttendanceReport && summaryFieldSet.has(templateField)) continue;

      const cell = targetRow.getCell(colIndex);

      // Check if this is a metadata constant mapping
      const metadataValue = metadataMappings.get(templateField);
      if (metadataValue !== undefined) {
        cell.value = isBlankCellValue(metadataValue) ? null : metadataValue;
        const style = styleCache.get(colIndex);
        if (style) {
          cell.style = style as ExcelJS.Style;
        }
      } else if (rowData[dataColumn] !== undefined) {
        const value = isAttendanceReport && attendanceFieldSet.has(templateField)
          ? resolveAttendanceSymbolForTemplateField(templateField, rowAttendanceMap || new Map(), rowData[dataColumn])
          : rowData[dataColumn];

        if (isBlankCellValue(value)) {
          cell.value = null;
        } else if (value instanceof Date) {
          cell.value = value;
        } else if (typeof value === 'number') {
          cell.value = value;
        } else if (typeof value === 'boolean') {
          cell.value = value;
        } else {
          cell.value = String(value);
        }

        // 첫 데이터 행의 스타일 적용
        const style = styleCache.get(colIndex);
        if (style) {
          cell.style = style as ExcelJS.Style;
        }
      }
    }

    if (isAttendanceReport && attendanceRange) {
      const rowAttendanceRange = attendanceRange.replace(`${firstDataRow}`, `${targetRowNum}`).replace(`${firstDataRow}`, `${targetRowNum}`);
      for (const [templateField, formulaKey] of Array.from(summaryFormulaMap.entries())) {
        const colIndex = templateColumnIndex.get(templateField);
        if (!colIndex) continue;

        const cell = targetRow.getCell(colIndex);
        cell.value = buildSummaryFormula(formulaKey, rowAttendanceRange);
        const style = styleCache.get(colIndex);
        if (style) {
          cell.style = style as ExcelJS.Style;
        }
      }
    }

    targetRow.commit();
  }

  // === Phase 4: 확장 행에 미매핑 컬럼 수식 복사 ===
  const templateDataRowCount = lastRowNum - firstDataRow + 1;
  if (dataRows.length > templateDataRowCount) {
    for (let rowIdx = templateDataRowCount; rowIdx < dataRows.length; rowIdx++) {
      const targetRowNum = firstDataRow + rowIdx;
      const targetRow = ws.getRow(targetRowNum);
      for (const [colIdx, snap] of Array.from(formulaSnapshot.entries())) {
        // 수식 내 행 번호를 현재 행에 맞게 치환
        const rowOffset = targetRowNum - firstDataRow;
        const newFormula = snap.formula.replace(
          /(\$?)([A-Z]+)(\$?)(\d+)/g,
          (match, dollarCol: string, col: string, dollarRow: string, rowStr: string) => {
            if (dollarRow === '$') return match; // 절대 참조는 유지
            const origRow = parseInt(rowStr);
            const newRow = origRow + rowOffset;
            return `${dollarCol}${col}${newRow}`;
          }
        );
        targetRow.getCell(colIdx).value = { formula: newFormula } as ExcelJS.CellFormulaValue;
        targetRow.getCell(colIdx).style = snap.style as ExcelJS.Style;
      }
      targetRow.commit();
    }
  }

  const activeSheetIndex = Math.max(0, workbook.worksheets.findIndex(sheet => sheet.id === ws.id));
  resetWorksheetView(ws);
  resetWorkbookView(workbook, activeSheetIndex);

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
