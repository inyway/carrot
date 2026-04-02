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

/**
 * ExcelJS 셀 값에서 실제 값을 안전하게 추출합니다.
 * formula, richText, hyperlink, error 등 다양한 셀 타입을 처리합니다.
 */
export function safeExtractCellValue(
  value: ExcelJS.CellValue
): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  // primitive 타입은 그대로 반환
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  // Date 객체
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  // object 타입 처리
  if (typeof value === 'object') {
    // formula / sharedFormula: { formula, result, ... }
    if ('result' in value) {
      const result = (value as { result: unknown }).result;
      if (result === null || result === undefined) return null;
      if (result instanceof Date) return result.toISOString().split('T')[0];
      if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
        return result;
      }
      return String(result);
    }

    // richText: { richText: [{ text: string }, ...] }
    if ('richText' in value) {
      const richTextVal = value as { richText: Array<{ text: string }> };
      return (richTextVal.richText || []).map(t => t.text).join('');
    }

    // hyperlink: { text, hyperlink }
    if ('text' in value && 'hyperlink' in value) {
      return (value as { text: string }).text;
    }

    // error: { error: ... }
    if ('error' in value) {
      return null;
    }

    // 기타 알 수 없는 object - JSON 시도 후 fallback
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  return String(value);
}

/**
 * ExcelJS 셀 값을 항상 문자열로 변환합니다.
 * null/undefined는 빈 문자열로 반환됩니다.
 */
export function cellValueToString(value: ExcelJS.CellValue): string {
  const extracted = safeExtractCellValue(value);
  if (extracted === null || extracted === undefined) return '';
  return String(extracted);
}

/**
 * Multi-row 헤더를 감지하고 복합 컬럼명을 생성합니다.
 * 예: 3행 헤더에서 col5 → ["4월", "1회차", "14(Mo)"] → "4월_1회차_14(Mo)"
 */
export function detectMultiRowHeaders(
  worksheet: ExcelJS.Worksheet,
  primaryHeaderRowNum: number,
  maxExtraRows: number = 5
): {
  headerRowNums: number[];
  compositeColumns: Array<{ colIndex: number; name: string }>;
  dataStartRow: number;
} {
  const headerRowNums: number[] = [primaryHeaderRowNum];

  // primaryHeaderRowNum 행의 최대 컬럼 수 파악
  const primaryRow = worksheet.getRow(primaryHeaderRowNum);
  let maxCol = 0;
  const primaryValues = new Map<number, string>();
  primaryRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > maxCol) maxCol = colNumber;
    const text = cellValueToString(cell.value).trim();
    if (text.length > 0) {
      primaryValues.set(colNumber, text);
    }
  });

  // 다음 행들을 순차 스캔하여 서브헤더 여부 판단
  for (let offset = 1; offset <= maxExtraRows; offset++) {
    const rowNum = primaryHeaderRowNum + offset;
    if (rowNum > worksheet.rowCount) break;

    const row = worksheet.getRow(rowNum);
    let nonEmptyCount = 0;
    let hasFormula = false;
    let shortTextCount = 0;
    let dateCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let _numericCount = 0;
    let matchesPrimaryCount = 0;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = cell.value;
      if (value === null || value === undefined) return;

      nonEmptyCount++;

      // 프라이머리 헤더와 동일한 값인지 체크 (수직 병합 감지)
      const text = cellValueToString(value).trim();
      const primaryText = primaryValues.get(colNumber);
      if (primaryText && text === primaryText) {
        matchesPrimaryCount++;
      }

      if (value instanceof Date) {
        dateCount++;
        return;
      }
      if (typeof value === 'number') {
        _numericCount++;
        return;
      }
      if (typeof value === 'object' && value !== null && 'result' in value) {
        hasFormula = true;
        const result = (value as { result: unknown }).result;
        if (typeof result === 'number') _numericCount++;
        return;
      }

      // 텍스트 셀 - 짧은 텍스트인지 확인
      if (text.length > 0 && text.length <= 15) {
        shortTextCount++;
      }
    });

    // 빈 행 → 스캔 중단
    if (nonEmptyCount === 0) break;

    // 수직 병합 패턴: 많은 셀이 프라이머리 헤더와 동일 → 서브헤더
    // (병합된 셀은 마스터 셀의 값을 반복하므로 동일 값이 나옴)
    if (matchesPrimaryCount >= 3) {
      headerRowNums.push(rowNum);
      continue;
    }

    // 수식이 포함된 행 → 데이터행 (스캔 중단)
    if (hasFormula) break;

    // 짧은 텍스트 + 날짜만 있으면 → 서브헤더 (날짜를 레이블로 취급)
    if (shortTextCount + dateCount === nonEmptyCount) {
      headerRowNums.push(rowNum);
      continue;
    }

    // 그 외: 데이터행으로 판단, 스캔 중단
    break;
  }

  const dataStartRow = headerRowNums[headerRowNums.length - 1] + 1;

  // 각 열에 대해 모든 헤더행의 값을 수집, 복합 컬럼명 생성
  const compositeColumns: Array<{ colIndex: number; name: string }> = [];

  for (let col = 1; col <= maxCol; col++) {
    const parts: string[] = [];

    for (const rowNum of headerRowNums) {
      const cell = worksheet.getRow(rowNum).getCell(col);
      const text = cellValueToString(cell.value).trim();
      if (text.length > 0 && text !== 'undefined') {
        parts.push(text);
      }
    }

    if (parts.length > 0) {
      // 중복 제거 후 _로 조인
      const unique = parts.filter((v, i, arr) => arr.indexOf(v) === i);
      compositeColumns.push({ colIndex: col, name: unique.join('_') });
    }
  }

  return { headerRowNums, compositeColumns, dataStartRow };
}

/**
 * 데이터 행이 반복 헤더나 메타데이터 행인지 판별합니다.
 * - 반복 헤더: 3개 이상의 컬럼 값이 해당 컬럼 헤더명과 정확히 일치
 * - 메타데이터: 대부분의 셀이 동일한 긴 텍스트 (병합된 메타 행)
 */
export function isRepeatedHeaderOrMetadata(
  rowData: Record<string, unknown>,
  columns: string[]
): boolean {
  const values = columns.map(col => String(rowData[col] ?? '').trim());
  const nonEmptyValues = values.filter(v => v.length > 0);

  if (nonEmptyValues.length === 0) return false;

  // 반복 헤더 감지: 컬럼 값이 헤더명과 일치하는 개수
  let headerMatchCount = 0;
  for (const col of columns) {
    const val = String(rowData[col] ?? '').trim();
    // 복합 컬럼명의 첫 파트와 비교 (예: "4월_1회차_14 (Mo)" → "4월")
    const firstPart = col.split('_')[0];
    if (val === col || val === firstPart) {
      headerMatchCount++;
    }
  }
  if (headerMatchCount >= 3) return true;

  // 메타데이터 감지: 동일 텍스트(>5자)가 과반수의 셀에 반복 (병합된 메타 행)
  // 짧은 값("Y","N","BZ" 등)은 출결 데이터일 수 있으므로 제외
  const valueCounts = new Map<string, number>();
  for (const v of nonEmptyValues) {
    if (v.length > 5) {
      valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
    }
  }
  for (const count of Array.from(valueCounts.values())) {
    if (count >= Math.max(3, nonEmptyValues.length * 0.5)) return true;
  }

  return false;
}

/**
 * 같은 사람의 여러 행(일정 + 출결 등)을 1행으로 병합합니다.
 * 패턴: 이메일 있는 행 다음에 이메일 없는 행이 교대로 나오는 구조.
 * - fillCols: 한 행만 값 있고 나머지 null → 비null 값 사용
 * - differingCols: 양쪽 모두 값 있고 다름 → 접미사(일정/출결) 붙여 분리
 */
export function mergePairedRows(
  data: Record<string, unknown>[],
  columns: string[],
): { rows: Record<string, unknown>[]; columns: string[] } {
  if (data.length < 2) return { rows: data, columns };

  // 이메일 컬럼 자동 감지
  const emailPatterns = ['이메일', 'email', 'e-mail', 'e_mail', 'mail'];
  let emailCol: string | null = null;
  for (const col of columns) {
    const normalized = col.replace(/\s+/g, '').toLowerCase();
    if (emailPatterns.some(p => normalized.includes(p))) {
      emailCol = col;
      break;
    }
  }
  if (!emailCol) {
    const sample = data.slice(0, Math.min(5, data.length));
    for (const col of columns) {
      const count = sample.filter(row => {
        const val = String(row[col] ?? '').trim();
        return val.includes('@') && val.includes('.');
      }).length;
      if (count >= Math.ceil(sample.length * 0.5)) {
        emailCol = col;
        break;
      }
    }
  }
  if (!emailCol) return { rows: data, columns };

  // 그룹핑: 2가지 패턴 지원
  // 1) 교대 패턴: 이메일 있는 행 + 뒤따르는 이메일 없는 행
  // 2) 연속 동일 이메일 패턴: 같은 이메일이 연속으로 나오는 경우 (ExcelJS 병합셀)
  const groups: Record<string, unknown>[][] = [];
  let i = 0;
  while (i < data.length) {
    const email = String(data[i][emailCol] ?? '').trim().toLowerCase();
    if (email) {
      const group = [data[i]];
      while (i + 1 < data.length) {
        const nextEmail = String(data[i + 1][emailCol] ?? '').trim().toLowerCase();
        if (nextEmail === email || !nextEmail) {
          i++;
          group.push(data[i]);
        } else {
          break;
        }
      }
      groups.push(group);
    } else {
      groups.push([data[i]]);
    }
    i++;
  }

  if (!groups.some(g => g.length > 1)) return { rows: data, columns };

  // 컬럼 분류
  // 첫 학생 그룹만 기준으로 잡으면, 앞 학생에게 비어 있는 후반 회차 컬럼이
  // same/fill로 굳어져 "(출결)" suffix가 사라질 수 있다.
  // 전체 멀티행 그룹을 훑어 한 번이라도 일정/출결 쌍이 관측된 컬럼은 differing으로 분류한다.
  const multiRowGroups = groups.filter(g => g.length > 1);
  const sameCols: string[] = [];
  const fillCols: string[] = [];
  const differingCols: string[] = [];

  for (const h of columns) {
    let hasDiffering = false;
    let hasFill = false;

    for (const group of multiRowGroups) {
      const values = group.map(r => String(r[h] ?? '').trim());
      const nonEmpty = values.filter(v => v);
      const uniqueNonEmpty = Array.from(new Set(nonEmpty));

      if (uniqueNonEmpty.length >= 2) {
        hasDiffering = true;
        break;
      }

      if (nonEmpty.length === 1) {
        hasFill = true;
      }
    }

    if (hasDiffering) {
      differingCols.push(h);
    } else if (hasFill) {
      fillCols.push(h);
    } else {
      sameCols.push(h);
    }
  }

  if (differingCols.length === 0) {
    const merged = groups.map(group => {
      const row: Record<string, unknown> = {};
      for (const col of columns) {
        row[col] = group.reduce<unknown>((acc, r) => {
          const val = r[col];
          return (acc === null || acc === undefined || acc === '') ? val : acc;
        }, null);
      }
      return row;
    });
    return { rows: merged, columns };
  }

  // 출결 패턴 감지
  const attendancePattern = /^(Y|N|C|L|O|X|-|출석|결석|지각|공결|중도입과)$/i;
  const isAttendanceRow = (row: Record<string, unknown>): boolean => {
    let mc = 0, tc = 0;
    for (const col of differingCols) {
      const val = String(row[col] ?? '').trim();
      if (val) { tc++; if (attendancePattern.test(val)) mc++; }
    }
    return tc > 0 && mc / tc > 0.5;
  };

  const sampleGroup = multiRowGroups
    .map(group => ({
      group,
      score: differingCols.reduce((count, col) => {
        return count + (group.some(row => String(row[col] ?? '').trim().length > 0) ? 1 : 0);
      }, 0),
    }))
    .sort((a, b) => b.score - a.score || b.group.length - a.group.length)[0]?.group || multiRowGroups[0];

  const rowLabels = sampleGroup.map(r => isAttendanceRow(r) ? '출결' : '일정');
  const useLabels = new Set(rowLabels).size > 1;

  const baseCols = [...sameCols, ...fillCols];
  const newColumns = [...baseCols];
  for (let idx = 0; idx < sampleGroup.length; idx++) {
    const suffix = useLabels ? rowLabels[idx] : `${idx + 1}`;
    for (const col of differingCols) {
      newColumns.push(`${col}(${suffix})`);
    }
  }

  const mergedRows: Record<string, unknown>[] = [];
  for (const group of groups) {
    const merged: Record<string, unknown> = {};
    for (const col of baseCols) {
      merged[col] = group.reduce<unknown>((acc, r) => {
        const val = r[col];
        return (acc === null || acc === undefined || acc === '') ? val : acc;
      }, null);
    }
    for (let idx = 0; idx < group.length; idx++) {
      const suffix = useLabels
        ? (isAttendanceRow(group[idx]) ? '출결' : '일정')
        : `${idx + 1}`;
      for (const col of differingCols) {
        merged[`${col}(${suffix})`] = group[idx][col];
      }
    }
    mergedRows.push(merged);
  }

  console.log(`[mergePairedRows] Merged by "${emailCol}": ${data.length} → ${mergedRows.length} rows, ${columns.length} → ${newColumns.length} columns`);
  return { rows: mergedRows, columns: newColumns };
}
