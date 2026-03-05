import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { AnalysisResult, HeaderInfo, FormulaInfo, TemplateConfig, DataRow } from './types';

// 컬럼 번호를 문자로 변환 (1 -> 'A', 27 -> 'AA')
export function columnToLetter(col: number): string {
  let letter = '';
  while (col > 0) {
    const mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - mod) / 26);
  }
  return letter;
}

// 컬럼 문자를 번호로 변환 ('A' -> 1, 'AA' -> 27)
export function letterToColumn(letter: string): number {
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 64);
  }
  return col;
}

// 셀 값을 문자열로 변환
function getCellValueAsString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';

  if (typeof value === 'object') {
    // 수식인 경우
    if ('formula' in value) return '';
    // 리치 텍스트인 경우
    if ('richText' in value) {
      return (value as ExcelJS.CellRichTextValue).richText
        .map(rt => rt.text)
        .join('');
    }
    // 에러인 경우
    if ('error' in value) return '';
    // 하이퍼링크인 경우
    if ('hyperlink' in value) {
      return (value as ExcelJS.CellHyperlinkValue).text || '';
    }
    return String(value);
  }

  return String(value);
}

// 템플릿 분석
export async function analyzeTemplate(buffer: Buffer): Promise<AnalysisResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('워크시트를 찾을 수 없습니다.');
  }

  const sheetName = sheet.name;
  const headers: HeaderInfo[] = [];
  const formulas: FormulaInfo[] = [];

  // 첫 번째 행에서 헤더 추출
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers.push({
      column: colNumber,
      letter: columnToLetter(colNumber),
      name: getCellValueAsString(cell),
    });
  });

  // 두 번째 행에서 수식 찾기
  const dataRow = sheet.getRow(2);
  dataRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const value = cell.value;
    if (value && typeof value === 'object' && 'formula' in value && typeof value.formula === 'string') {
      formulas.push({
        cell: `${columnToLetter(colNumber)}2`,
        formula: value.formula,
      });
    }
  });

  return {
    sheetName,
    headers,
    dataStartRow: 2,
    formulas,
  };
}

// 이메일 컬럼 자동 감지
function detectEmailColumn(headers: string[], rows: DataRow[]): string | null {
  const emailPatterns = ['이메일', 'email', 'e-mail', 'e_mail', 'mail'];
  for (const header of headers) {
    const normalized = header.replace(/\s+/g, '').toLowerCase();
    if (emailPatterns.some(p => normalized.includes(p))) {
      return header;
    }
  }

  const sample = rows.slice(0, Math.min(5, rows.length));
  for (const header of headers) {
    const emailCount = sample.filter(row => {
      const val = String(row[header] || '').trim();
      return val.includes('@') && val.includes('.');
    }).length;
    if (emailCount >= Math.ceil(sample.length * 0.5)) {
      return header;
    }
  }

  return null;
}

// 같은 사람의 여러 행을 1행으로 병합
// 패턴: 이메일 있는 행(일정) 다음에 이메일 없는 행(출결)이 교대로 나오는 구조
function mergePairedRows(data: DataRow[], headers: string[]): { rows: DataRow[]; headers: string[] } {
  if (data.length < 2) return { rows: data, headers };

  const emailCol = detectEmailColumn(headers, data);
  if (!emailCol) return { rows: data, headers };

  // 그룹핑: 이메일 있는 행 + 뒤따르는 동일/빈 이메일 행을 같은 그룹으로
  const groups: DataRow[][] = [];
  let i = 0;
  while (i < data.length) {
    const email = String(data[i][emailCol] || '').trim().toLowerCase();
    if (email) {
      const group: DataRow[] = [data[i]];
      while (i + 1 < data.length) {
        const nextEmail = String(data[i + 1][emailCol] || '').trim().toLowerCase();
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

  const hasMultiRow = groups.some(g => g.length > 1);
  if (!hasMultiRow) return { rows: data, headers };

  // 컬럼 분류: same (동일), fill (한쪽만 값), differing (양쪽 다른 값)
  const sampleGroup = groups.find(g => g.length > 1)!;
  const sameCols: string[] = [];
  const fillCols: string[] = [];
  const differingCols: string[] = [];

  for (const h of headers) {
    const values = sampleGroup.map(r => String(r[h] ?? '').trim());
    const nonEmpty = values.filter(v => v);
    if (new Set(values).size <= 1) {
      sameCols.push(h);
    } else if (nonEmpty.length <= 1) {
      fillCols.push(h);
    } else {
      differingCols.push(h);
    }
  }

  if (differingCols.length === 0) {
    const mergedRows: DataRow[] = groups.map(group => {
      const merged: DataRow = {};
      for (const col of headers) {
        merged[col] = group.reduce<DataRow[string]>((acc, row) => {
          const val = row[col];
          return (acc === null || acc === undefined || acc === '') ? val : acc;
        }, null);
      }
      return merged;
    });
    return { rows: mergedRows, headers };
  }

  const attendancePattern = /^(Y|N|C|L|O|X|-|출석|결석|지각|공결|중도입과)$/i;
  function isAttendanceRow(row: DataRow): boolean {
    let matchCount = 0;
    let totalCount = 0;
    for (const col of differingCols) {
      const val = String(row[col] ?? '').trim();
      if (val) {
        totalCount++;
        if (attendancePattern.test(val)) matchCount++;
      }
    }
    return totalCount > 0 && matchCount / totalCount > 0.5;
  }

  const rowLabels = sampleGroup.map(row => isAttendanceRow(row) ? '출결' : '일정');
  const useLabels = new Set(rowLabels).size > 1;

  const baseCols = [...sameCols, ...fillCols];
  const newHeaders = [...baseCols];
  for (let idx = 0; idx < sampleGroup.length; idx++) {
    const suffix = useLabels ? rowLabels[idx] : `${idx + 1}`;
    for (const col of differingCols) {
      newHeaders.push(`${col}(${suffix})`);
    }
  }

  const mergedRows: DataRow[] = [];
  for (const group of groups) {
    const merged: DataRow = {};
    for (const col of baseCols) {
      merged[col] = group.reduce<DataRow[string]>((acc, row) => {
        const val = row[col];
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

  console.log(`[parseDataFile] Merged paired rows by "${emailCol}": ${data.length} → ${mergedRows.length} rows`);
  return { rows: mergedRows, headers: newHeaders };
}

// CSV/Excel 데이터 파싱
export async function parseDataFile(buffer: Buffer, fileName: string): Promise<DataRow[]> {
  const ext = fileName.toLowerCase().split('.').pop();

  if (ext === 'csv') {
    const text = new TextDecoder('utf-8').decode(buffer);
    const result = Papa.parse<DataRow>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
    });
    const headers = result.meta.fields || [];
    return mergePairedRows(result.data, headers).rows;
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new Error('워크시트를 찾을 수 없습니다.');
    }

    const data: DataRow[] = [];
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];

    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      headers.push(getCellValueAsString(cell));
    });

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // 헤더 행 스킵

      const rowData: DataRow = {};
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (headers[colNumber - 1]) {
          const value = cell.value;
          if (value === null || value === undefined) {
            rowData[headers[colNumber - 1]] = null;
          } else if (value instanceof Date) {
            rowData[headers[colNumber - 1]] = value.toISOString();
          } else if (typeof value === 'object') {
            if ('formula' in value) {
              const result = (value as ExcelJS.CellFormulaValue).result;
              if (result instanceof Date) {
                rowData[headers[colNumber - 1]] = result.toISOString();
              } else if (result === null || result === undefined) {
                rowData[headers[colNumber - 1]] = null;
              } else if (typeof result === 'object' && 'error' in result) {
                rowData[headers[colNumber - 1]] = null;
              } else {
                rowData[headers[colNumber - 1]] = result as string | number | boolean;
              }
            } else if ('richText' in value) {
              rowData[headers[colNumber - 1]] = (value as ExcelJS.CellRichTextValue).richText
                .map(rt => rt.text)
                .join('');
            } else {
              rowData[headers[colNumber - 1]] = String(value);
            }
          } else {
            rowData[headers[colNumber - 1]] = value;
          }
        }
      });
      data.push(rowData);
    });

    return mergePairedRows(data, headers).rows;
  }

  throw new Error('지원하지 않는 파일 형식입니다. CSV 또는 Excel 파일을 사용해주세요.');
}

// 데이터 변환 및 보고서 생성
export async function processData(
  templateBuffer: Buffer,
  config: TemplateConfig,
  data: DataRow[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer as unknown as ArrayBuffer);

  const sheet = workbook.getWorksheet(config.sheetName) || workbook.worksheets[0];
  if (!sheet) {
    throw new Error('워크시트를 찾을 수 없습니다.');
  }

  // 기존 데이터 행 삭제 (보존할 행 제외)
  const lastRow = sheet.rowCount;
  for (let i = lastRow; i >= config.dataStartRow; i--) {
    if (!config.preserveRows.includes(i)) {
      sheet.spliceRows(i, 1);
    }
  }

  // 새 데이터 추가
  data.forEach((rowData, index) => {
    const rowNumber = config.dataStartRow + index;
    const row = sheet.getRow(rowNumber);

    config.columns.forEach((colConfig) => {
      const colNumber = letterToColumn(colConfig.column);
      const cell = row.getCell(colNumber);

      if (colConfig.type === 'formula' && colConfig.formula) {
        // 수식 컬럼: {row} 플레이스홀더를 실제 행 번호로 치환
        const formula = colConfig.formula.replace(/\{row\}/g, String(rowNumber));
        cell.value = { formula };
      } else if (colConfig.type === 'data' && colConfig.sourceField) {
        // 데이터 컬럼: 원본 데이터에서 값 가져오기
        const value = rowData[colConfig.sourceField];
        cell.value = value ?? null;
      }
    });

    row.commit();
  });

  // Buffer로 반환
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
