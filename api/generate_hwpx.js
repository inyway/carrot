const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

async function generateHwpxFiles() {
  console.log('=== HWPX 파일 생성 시작 ===\n');

  // 1. 템플릿 로드
  const templatePath = '/Users/gwangyunmoon/Documents/excel-report-formatter/개인이력카드(정아리아님) (1).hwpx';
  const templateBuffer = fs.readFileSync(templatePath);
  console.log('템플릿 로드 완료:', templatePath);

  // 2. Excel 데이터 로드
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/Users/gwangyunmoon/Documents/excel-report-formatter/한국산업인력공단 리턴업 명단 251209 최신버전.xlsx');
  const ws = wb.worksheets[0];
  console.log('Excel 로드 완료');

  // 3. 컬럼명 생성 (계층적)
  const columnNames = {};
  const row1 = ws.getRow(1);
  const row2 = ws.getRow(2);
  const row3 = ws.getRow(3);

  for (let col = 1; col <= 55; col++) {
    const v1 = getCellText(row1.getCell(col));
    const v2 = getCellText(row2.getCell(col));
    const v3 = getCellText(row3.getCell(col));

    const parts = [v1, v2, v3].filter(v => v && v.length > 0);
    const uniqueParts = [];
    for (const p of parts) {
      if (!uniqueParts.includes(p)) uniqueParts.push(p);
    }
    if (uniqueParts.length > 0) {
      columnNames[col] = uniqueParts.join('_');
    }
  }

  // 4. 매핑 규칙 (HWPX 셀 위치)
  const mappingRules = [
    // 신상정보 (실제 HWPX 구조 기반)
    { pattern: /성명/, hwpxRow: 3, hwpxCol: 1 },
    { pattern: /연락처/, hwpxRow: 3, hwpxCol: 3 },
    { pattern: /생년월일/, hwpxRow: 3, hwpxCol: 5 },
    { pattern: /이메일/, hwpxRow: 4, hwpxCol: 1 },
    { pattern: /성별/, hwpxRow: 4, hwpxCol: 3 },
    { pattern: /거주지/, hwpxRow: 4, hwpxCol: 5 },

    // 해외취업 경험
    { pattern: /참여분야/, hwpxRow: 6, hwpxCol: 1 },
    { pattern: /수행기관/, hwpxRow: 6, hwpxCol: 3 },
    { pattern: /사업명/, hwpxRow: 7, hwpxCol: 1 },
    { pattern: /참여기간/, hwpxRow: 7, hwpxCol: 3 },
    { pattern: /국가/, hwpxRow: 8, hwpxCol: 1 },
    { pattern: /해외.*취업.*직무|취업경험.*직무/i, hwpxRow: 8, hwpxCol: 3 },

    // 희망직종/직무
    { pattern: /희망직종/, hwpxRow: 10, hwpxCol: 1 },
    { pattern: /희망직무/, hwpxRow: 10, hwpxCol: 3 },

    // 핵심 세미나 (전문가 강연) - Row 13
    { pattern: /전문가\s?강연.*1회/i, hwpxRow: 13, hwpxCol: 2 },
    { pattern: /전문가\s?강연.*2회/i, hwpxRow: 13, hwpxCol: 3 },
    { pattern: /전문가\s?강연.*3회/i, hwpxRow: 13, hwpxCol: 4 },
    { pattern: /전문가\s?강연.*4회/i, hwpxRow: 13, hwpxCol: 5 },
    { pattern: /전문가\s?강연.*5회/i, hwpxRow: 13, hwpxCol: 6 },
    { pattern: /전문가\s?강연.*6회/i, hwpxRow: 13, hwpxCol: 7 },

    // 전문가 컨설팅 - Row 14
    { pattern: /전문가\s?컨설팅.*1회/i, hwpxRow: 14, hwpxCol: 2 },
    { pattern: /전문가\s?컨설팅.*2회/i, hwpxRow: 14, hwpxCol: 3 },
    { pattern: /전문가\s?컨설팅.*3회/i, hwpxRow: 14, hwpxCol: 5 },

    // 실전모의면접 - Row 15
    { pattern: /실전.*면접.*1회/i, hwpxRow: 15, hwpxCol: 2 },
    { pattern: /실전.*면접.*2회/i, hwpxRow: 15, hwpxCol: 3 },
    { pattern: /실전.*면접.*3회/i, hwpxRow: 15, hwpxCol: 4 },
    { pattern: /실전.*면접.*4회/i, hwpxRow: 15, hwpxCol: 5 },
    { pattern: /실전.*면접.*5회/i, hwpxRow: 15, hwpxCol: 6 },
    { pattern: /실전.*면접.*6회/i, hwpxRow: 15, hwpxCol: 7 },

    // 취업현황 - 2분기 (Row 18-20, Col 2)
    { pattern: /2분기.*취업여부/i, hwpxRow: 18, hwpxCol: 2 },
    { pattern: /2분기.*취업처/i, hwpxRow: 19, hwpxCol: 2 },
    { pattern: /2분기.*담당직무/i, hwpxRow: 20, hwpxCol: 2 },

    // 취업현황 - 3분기 (Row 18-20, Col 6)
    { pattern: /3분기.*취업여부/i, hwpxRow: 18, hwpxCol: 6 },
    { pattern: /3분기.*취업처/i, hwpxRow: 19, hwpxCol: 6 },
    { pattern: /3분기.*담당직무/i, hwpxRow: 20, hwpxCol: 6 },

    // 취업현황 - 4분기 (Row 18-20, Col 11)
    { pattern: /4분기.*취업여부/i, hwpxRow: 18, hwpxCol: 11 },
    { pattern: /4분기.*취업처/i, hwpxRow: 19, hwpxCol: 11 },
    { pattern: /4분기.*담당직무/i, hwpxRow: 20, hwpxCol: 11 },
  ];

  // 5. 컬럼 → 매핑 연결
  const colMappings = [];
  for (const [col, name] of Object.entries(columnNames)) {
    for (const rule of mappingRules) {
      if (rule.pattern.test(name)) {
        colMappings.push({
          excelCol: parseInt(col),
          colName: name,
          hwpxRow: rule.hwpxRow,
          hwpxCol: rule.hwpxCol,
        });
        break;
      }
    }
  }
  console.log(`매핑 규칙 ${colMappings.length}개 생성`);

  // 5.1 초기화해야 할 모든 셀 위치 (템플릿 값 제거용)
  const allCellsToReset = new Set();
  for (const mapping of colMappings) {
    allCellsToReset.add(`${mapping.hwpxRow}-${mapping.hwpxCol}`);
  }

  // 6. 출력 ZIP 생성
  const outputZip = new AdmZip();
  let generatedCount = 0;

  // 모든 데이터 행 처리 (Row 4부터)
  const lastRow = ws.rowCount;
  console.log(`총 ${lastRow - 3}명 처리 예정\n`);

  for (let rowNum = 4; rowNum <= lastRow; rowNum++) {
    const row = ws.getRow(rowNum);
    const name = getCellText(row.getCell(3));  // 성명 Col 3

    if (!name || !name.trim()) continue;

    // 이 사람의 데이터 추출
    const data = {};
    for (const mapping of colMappings) {
      const value = getCellText(row.getCell(mapping.excelCol));
      if (value && value.trim() && value !== '-') {
        const key = `${mapping.hwpxRow}-${mapping.hwpxCol}`;
        data[key] = value;
      }
    }

    // HWPX 생성 (먼저 모든 매핑 셀을 빈 값으로 초기화 후 데이터 입력)
    const hwpxBuffer = fillHwpxTemplate(templateBuffer, data, allCellsToReset);
    const fileName = `${name.replace(/[/\\?%*:|"<>]/g, '_')}.hwpx`;
    outputZip.addFile(fileName, hwpxBuffer);
    generatedCount++;

    if (generatedCount % 10 === 0) {
      console.log(`${generatedCount}명 처리 완료...`);
    }
  }

  // 7. ZIP 저장
  const outputPath = '/Users/gwangyunmoon/Downloads/1.4.zip';
  outputZip.writeZip(outputPath);
  console.log(`\n=== 완료 ===`);
  console.log(`생성된 파일: ${generatedCount}개`);
  console.log(`저장 위치: ${outputPath}`);
}

function getCellText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';

  if (typeof value === 'object' && value.richText) {
    return value.richText.map(t => t.text).join('');
  }
  if (typeof value === 'object' && value.result !== undefined) {
    return String(value.result);
  }
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  return String(value);
}

function escapeXml(text) {
  if (!text) return text;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fillHwpxTemplate(templateBuffer, data, allCellsToReset) {
  // 템플릿 버퍼 복사
  const bufferCopy = Buffer.from(templateBuffer);
  const zip = new AdmZip(bufferCopy);
  const sectionEntry = zip.getEntry('Contents/section0.xml');

  if (!sectionEntry) {
    throw new Error('section0.xml not found');
  }

  let xmlContent = sectionEntry.getData().toString('utf-8');

  // 1. 먼저 모든 매핑 대상 셀을 빈 값으로 초기화 (템플릿 기존 값 제거)
  for (const cellKey of allCellsToReset) {
    const [rowStr, colStr] = cellKey.split('-');
    const targetRow = parseInt(rowStr);
    const targetCol = parseInt(colStr);
    xmlContent = replaceCellText(xmlContent, targetRow, targetCol, '');
  }

  // 2. 실제 데이터가 있는 셀만 값 입력
  for (const [key, value] of Object.entries(data)) {
    const [rowStr, colStr] = key.split('-');
    const targetRow = parseInt(rowStr);
    const targetCol = parseInt(colStr);

    xmlContent = replaceCellText(xmlContent, targetRow, targetCol, value);
  }

  zip.updateFile('Contents/section0.xml', Buffer.from(xmlContent, 'utf-8'));
  return zip.toBuffer();
}

function replaceCellText(xmlContent, targetRow, targetCol, newText) {
  let result = xmlContent;

  result = result.replace(
    /<hp:tc([^>]*)>([\s\S]*?)<\/hp:tc>/g,
    (tcMatch, tcAttrs, tcContent) => {
      const colAddrMatch = tcContent.match(/colAddr="(\d+)"/);
      const rowAddrMatch = tcContent.match(/rowAddr="(\d+)"/);

      if (!colAddrMatch || !rowAddrMatch) {
        return tcMatch;
      }

      const colAddr = parseInt(colAddrMatch[1], 10);
      const rowAddr = parseInt(rowAddrMatch[1], 10);

      if (rowAddr === targetRow && colAddr === targetCol) {
        const escapedText = escapeXml(newText);
        let replaced = false;
        const newContent = tcMatch.replace(
          /(<hp:t>)[^<]*(<\/hp:t>)/g,
          (tMatch, openTag, closeTag) => {
            if (!replaced) {
              replaced = true;
              return `${openTag}${escapedText}${closeTag}`;
            }
            return tMatch;
          }
        );
        return newContent;
      }

      return tcMatch;
    }
  );

  return result;
}

generateHwpxFiles().catch(console.error);
