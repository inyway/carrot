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
    return result.data;
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

    return data;
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
