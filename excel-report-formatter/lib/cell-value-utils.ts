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
  primaryRow.eachCell({ includeEmpty: true }, (_cell, colNumber) => {
    if (colNumber > maxCol) maxCol = colNumber;
  });

  // 다음 행들을 순차 스캔하여 서브헤더 여부 판단
  for (let offset = 1; offset <= maxExtraRows; offset++) {
    const rowNum = primaryHeaderRowNum + offset;
    if (rowNum > worksheet.rowCount) break;

    const row = worksheet.getRow(rowNum);
    let nonEmptyCount = 0;
    let hasNumeric = false;
    let hasFormula = false;
    let shortTextCount = 0;
    let dateCount = 0;

    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = cell.value;
      if (value === null || value === undefined) return;

      nonEmptyCount++;

      if (value instanceof Date) {
        dateCount++;
        return;
      }
      if (typeof value === 'number') {
        hasNumeric = true;
        return;
      }
      if (typeof value === 'object' && value !== null && 'result' in value) {
        hasFormula = true;
        const result = (value as { result: unknown }).result;
        if (typeof result === 'number') hasNumeric = true;
        return;
      }

      // 텍스트 셀 - 짧은 텍스트인지 확인
      const text = cellValueToString(value).trim();
      if (text.length > 0 && text.length <= 15) {
        shortTextCount++;
      }
    });

    // 빈 행 → 스캔 중단
    if (nonEmptyCount === 0) break;

    // 숫자, 수식이 있으면 → 데이터행 (스캔 중단)
    if (hasNumeric || hasFormula) break;

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
