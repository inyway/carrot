import type * as ExcelJS from 'exceljs';

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
    let numericCount = 0;
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
        numericCount++;
        return;
      }
      if (typeof value === 'object' && value !== null && 'result' in value) {
        hasFormula = true;
        const result = (value as { result: unknown }).result;
        if (typeof result === 'number') numericCount++;
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
 * 프론트엔드에서 셀 값을 안전하게 표시합니다.
 * object 타입이 넘어왔을 때 [object Object] 대신 의미 있는 값을 표시합니다.
 */
export function safeCellDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().split('T')[0];

  if (typeof value === 'object') {
    // formula result
    if ('result' in value) {
      const result = (value as { result: unknown }).result;
      if (result === null || result === undefined) return '';
      if (result instanceof Date) return result.toISOString().split('T')[0];
      return String(result);
    }
    // richText
    if ('richText' in value) {
      const richTextVal = value as { richText: Array<{ text: string }> };
      return (richTextVal.richText || []).map(t => t.text).join('');
    }
    // hyperlink
    if ('text' in value) {
      return (value as { text: string }).text;
    }
    // fallback for unknown objects
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  return String(value);
}
