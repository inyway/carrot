/**
 * Verification Flow Test Script
 * 3-Way Diff 검증 시스템 성능 테스트
 */

const fs = require('fs');
const AdmZip = require('adm-zip');
const ExcelJS = require('exceljs');

// 파일 경로
const TEMPLATE_PATH = '/Users/gwangyunmoon/Documents/excel-report-formatter/개인이력카드(정아리아님) (1).hwpx';
const EXCEL_PATH = '/Users/gwangyunmoon/Documents/excel-report-formatter/한국산업인력공단 리턴업 명단 251209 최신버전.xlsx';
const GENERATED_ZIP_PATH = '/Users/gwangyunmoon/Downloads/1.4.zip';

// 매핑 정보 (실제 사용 매핑 일부)
const MAPPINGS = [
  { excelColumn: '성명', hwpxRow: 2, hwpxCol: 1 },
  { excelColumn: '연락처', hwpxRow: 3, hwpxCol: 3 },
  { excelColumn: '이메일', hwpxRow: 4, hwpxCol: 3 },
  { excelColumn: '5. 취업현황_4분기_회사명', hwpxRow: 34, hwpxCol: 1 },
  { excelColumn: '5. 취업현황_4분기_담당직무', hwpxRow: 34, hwpxCol: 3 },
  { excelColumn: '3. 프로그램 참여현황_핵심 세미나_날짜', hwpxRow: 23, hwpxCol: 1 },
];

// 타이밍 유틸
function timer(label) {
  const start = Date.now();
  return {
    stop: () => {
      const elapsed = Date.now() - start;
      console.log(`  [${label}] ${elapsed}ms`);
      return elapsed;
    }
  };
}

// XML에서 셀 값 추출
function extractCellsFromXml(xmlContent) {
  const cells = new Map();
  const tcRegex = /<hp:tc[^>]*>([\s\S]*?)<\/hp:tc>/g;
  let match;

  while ((match = tcRegex.exec(xmlContent)) !== null) {
    const tcContent = match[1];
    const colAddrMatch = tcContent.match(/colAddr="(\d+)"/);
    const rowAddrMatch = tcContent.match(/rowAddr="(\d+)"/);

    if (!colAddrMatch || !rowAddrMatch) continue;

    const col = parseInt(colAddrMatch[1], 10);
    const row = parseInt(rowAddrMatch[1], 10);

    const textMatches = tcContent.match(/<hp:t>([^<]*)<\/hp:t>/g);
    let text = '';
    if (textMatches) {
      text = textMatches
        .map((t) => t.replace(/<hp:t>|<\/hp:t>/g, ''))
        .join('')
        .trim();
    }

    cells.set(`${row}-${col}`, text);
  }

  return cells;
}

// Step 1: 템플릿 파싱
async function parseTemplate(buffer) {
  const t = timer('parseTemplate');
  const cells = new Map();

  const zip = new AdmZip(buffer);
  const sectionEntry = zip.getEntry('Contents/section0.xml');

  if (sectionEntry) {
    const xmlContent = sectionEntry.getData().toString('utf-8');
    const parsed = extractCellsFromXml(xmlContent);
    parsed.forEach((v, k) => cells.set(k, v));
  }

  t.stop();
  return cells;
}

// Step 2: Excel 파싱
async function parseExcel(buffer) {
  const t = timer('parseExcel');
  const rows = [];

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return rows;

  // 헤더 탐지 (간단 버전)
  const headerRow = worksheet.getRow(1);
  const columnMap = [];
  headerRow.eachCell((cell, colNum) => {
    const value = String(cell.value || '').trim();
    if (value) {
      columnMap.push({ colIndex: colNum, name: value });
    }
  });

  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= 1) return;

    const data = {};
    let hasData = false;

    for (const { colIndex, name } of columnMap) {
      const cell = row.getCell(colIndex);
      let value = '';
      if (cell.value !== null && cell.value !== undefined) {
        if (cell.value instanceof Date) {
          value = cell.value.toISOString().split('T')[0];
        } else if (typeof cell.value === 'object' && cell.value.richText) {
          value = cell.value.richText.map(t => t.text).join('');
        } else {
          value = String(cell.value);
        }
      }
      if (value) {
        hasData = true;
        data[name] = value;
      }
    }

    if (hasData) {
      const personName = data['성명'] || data['이름'] || `Row${rowNum}`;
      rows.push({ rowIndex: rowNum, personName, data });
    }
  });

  t.stop();
  return rows;
}

// Step 3: 생성된 ZIP 파싱
async function parseGenerated(zipBuffer) {
  const t = timer('parseGenerated');
  const files = [];

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  for (const entry of entries) {
    if (!entry.entryName.endsWith('.hwpx')) continue;

    try {
      const hwpxBuffer = entry.getData();
      const hwpxZip = new AdmZip(hwpxBuffer);
      const sectionEntry = hwpxZip.getEntry('Contents/section0.xml');

      if (!sectionEntry) continue;

      const xmlContent = sectionEntry.getData().toString('utf-8');
      const cells = extractCellsFromXml(xmlContent);

      const fileName = entry.entryName;
      const personName = fileName.replace('.hwpx', '');

      files.push({ fileName, personName, cells });
    } catch (e) {
      // skip
    }
  }

  t.stop();
  return files;
}

// Step 4: Unified Model 생성
function buildUnifiedModel(templateCells, excelRows, generatedFiles, mappings, sampleSize) {
  const t = timer('buildUnifiedModel');

  const totalCount = excelRows.length;
  const size = Math.min(sampleSize, totalCount);

  // 랜덤 샘플링
  const indices = Array.from({ length: totalCount }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const sampledIndices = indices.slice(0, size);

  const unifiedCells = new Map();

  for (const idx of sampledIndices) {
    const excelRow = excelRows[idx];
    if (!excelRow) continue;

    const generatedFile = generatedFiles.find(
      (f) => f.personName === excelRow.personName ||
             f.personName.includes(excelRow.personName) ||
             excelRow.personName.includes(f.personName)
    );

    const cells = [];

    for (const mapping of mappings) {
      const cellKey = `${mapping.hwpxRow}-${mapping.hwpxCol}`;

      const templateValue = templateCells.get(cellKey) || '';
      const excelValue = excelRow.data[mapping.excelColumn] || '';
      const generatedValue = generatedFile?.cells.get(cellKey) || '';

      // 상태 결정
      let status;
      const normalize = (v) => (v || '').trim();
      const tpl = normalize(templateValue);
      const excel = normalize(excelValue);
      const gen = normalize(generatedValue);

      if (!excel && !gen) status = 'empty_ok';
      else if (excel === gen) status = 'match';
      else if (!excel && tpl && gen === tpl) status = 'template_leak';
      else if (excel && !gen) status = 'missing';
      else status = 'mismatch';

      cells.push({
        hwpxRow: mapping.hwpxRow,
        hwpxCol: mapping.hwpxCol,
        fieldName: mapping.excelColumn,
        excelColumn: mapping.excelColumn,
        templateValue,
        excelValue,
        generatedValue,
        status,
      });
    }

    unifiedCells.set(idx, cells);
  }

  t.stop();
  return { sampledIndices, unifiedCells };
}

// Step 5: Agent 실행
function runAgents(sampledIndices, unifiedCells, excelRows) {
  const t = timer('runAgents');

  const issues = [];

  // ValueMatch Agent
  for (const idx of sampledIndices) {
    const cells = unifiedCells.get(idx);
    const excelRow = excelRows[idx];
    if (!cells || !excelRow) continue;

    for (const cell of cells) {
      if (cell.status === 'mismatch') {
        issues.push({
          personName: excelRow.personName,
          personIndex: idx,
          cell,
          severity: 'critical',
          message: `값 불일치: Excel="${cell.excelValue}" vs Generated="${cell.generatedValue}"`,
          agentName: 'ValueMatchAgent',
        });
      }
    }
  }

  // TemplateLeak Agent
  for (const idx of sampledIndices) {
    const cells = unifiedCells.get(idx);
    const excelRow = excelRows[idx];
    if (!cells || !excelRow) continue;

    for (const cell of cells) {
      if (cell.status === 'template_leak') {
        issues.push({
          personName: excelRow.personName,
          personIndex: idx,
          cell,
          severity: 'critical',
          message: `템플릿 값 누수: "${cell.templateValue}"이 그대로 남아있음`,
          agentName: 'TemplateLeakAgent',
        });
      }
    }
  }

  // Pattern Agent (간단 버전)
  const phoneRegex = /^0\d{1,2}-?\d{3,4}-?\d{4}$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  for (const idx of sampledIndices) {
    const cells = unifiedCells.get(idx);
    const excelRow = excelRows[idx];
    if (!cells || !excelRow) continue;

    for (const cell of cells) {
      if (cell.fieldName.includes('연락처') && cell.generatedValue) {
        if (!phoneRegex.test(cell.generatedValue.replace(/-/g, '').replace(/^0/, '0'))) {
          // 패턴 체크 (경고만)
        }
      }
      if (cell.fieldName.includes('이메일') && cell.generatedValue) {
        if (!emailRegex.test(cell.generatedValue)) {
          // 패턴 체크 (경고만)
        }
      }
    }
  }

  t.stop();
  return issues;
}

// 메인 테스트
async function main() {
  console.log('='.repeat(60));
  console.log('3-Way Diff Verification Flow Test');
  console.log('='.repeat(60));

  // 파일 로드
  console.log('\n[Loading files...]');
  const templateBuffer = fs.readFileSync(TEMPLATE_PATH);
  const excelBuffer = fs.readFileSync(EXCEL_PATH);
  const generatedZipBuffer = fs.readFileSync(GENERATED_ZIP_PATH);
  console.log(`  Template: ${(templateBuffer.length / 1024).toFixed(1)}KB`);
  console.log(`  Excel: ${(excelBuffer.length / 1024).toFixed(1)}KB`);
  console.log(`  Generated ZIP: ${(generatedZipBuffer.length / 1024).toFixed(1)}KB`);

  // 전체 시간 측정
  const totalTimer = timer('TOTAL');

  // Step 1-3: 병렬 파싱
  console.log('\n[Step 1-3: Parallel Parsing]');
  const parallelTimer = timer('parallelParsing');
  const [templateCells, excelRows, generatedFiles] = await Promise.all([
    parseTemplate(templateBuffer),
    parseExcel(excelBuffer),
    parseGenerated(generatedZipBuffer),
  ]);
  const parallelTime = parallelTimer.stop();

  console.log(`\n  Results:`);
  console.log(`    Template cells: ${templateCells.size}`);
  console.log(`    Excel rows: ${excelRows.length}`);
  console.log(`    Generated files: ${generatedFiles.length}`);

  // 샘플 사이즈별 테스트
  const sampleSizes = [10, 30, 50, 100, excelRows.length];

  for (const sampleSize of sampleSizes) {
    if (sampleSize > excelRows.length) continue;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[Sample Size: ${sampleSize}]`);

    const stepTimer = timer(`sample_${sampleSize}`);

    // Step 4: Unified Model
    console.log('\n[Step 4: Build Unified Model]');
    const { sampledIndices, unifiedCells } = buildUnifiedModel(
      templateCells, excelRows, generatedFiles, MAPPINGS, sampleSize
    );

    // Step 5: Run Agents
    console.log('\n[Step 5: Run Agents]');
    const issues = runAgents(sampledIndices, unifiedCells, excelRows);

    const stepTime = stepTimer.stop();

    // 결과
    const totalChecks = sampledIndices.length * MAPPINGS.length;
    const accuracy = totalChecks > 0
      ? ((totalChecks - issues.length) / totalChecks * 100).toFixed(1)
      : 100;

    console.log(`\n  Results:`);
    console.log(`    Sampled: ${sampledIndices.length} people`);
    console.log(`    Total checks: ${totalChecks}`);
    console.log(`    Issues found: ${issues.length}`);
    console.log(`    Accuracy: ${accuracy}%`);
    console.log(`    Time: ${stepTime}ms`);

    // 이슈 샘플 출력
    if (issues.length > 0) {
      console.log(`\n  Sample Issues:`);
      issues.slice(0, 3).forEach((issue, i) => {
        console.log(`    ${i + 1}. [${issue.agentName}] ${issue.personName}: ${issue.message.slice(0, 60)}...`);
      });
    }
  }

  // 순차 vs 병렬 비교
  console.log(`\n${'='.repeat(60)}`);
  console.log('[Sequential vs Parallel Comparison]');

  console.log('\n  Sequential parsing:');
  const seqTimer = timer('sequential');
  await parseTemplate(templateBuffer);
  await parseExcel(excelBuffer);
  await parseGenerated(generatedZipBuffer);
  const seqTime = seqTimer.stop();

  console.log(`\n  Parallel parsing: ${parallelTime}ms`);
  console.log(`  Sequential parsing: ${seqTime}ms`);
  console.log(`  Speedup: ${(seqTime / parallelTime).toFixed(2)}x`);

  const totalTime = totalTimer.stop();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Final Summary]`);
  console.log(`  Total execution time: ${totalTime}ms`);
  console.log('='.repeat(60));
}

main().catch(console.error);
