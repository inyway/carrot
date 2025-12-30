const XLSX = require('xlsx');

const wb = XLSX.readFile('/Users/gwangyunmoon/Downloads/export (1).xlsx');
const ws = wb.Sheets['Sheet1'];

console.log('=== 취업현황 관련 컬럼 찾기 ===');

// Get headers from row 2 and 3
const range = XLSX.utils.decode_range(ws['!ref']);

const headers2 = {};
const headers3 = {};

for (let C = range.s.c; C <= range.e.c; ++C) {
  const cell2 = ws[XLSX.utils.encode_cell({ r: 1, c: C })];  // row 2
  const cell3 = ws[XLSX.utils.encode_cell({ r: 2, c: C })];  // row 3
  headers2[C] = cell2 ? cell2.v : '';
  headers3[C] = cell3 ? cell3.v : '';
}

const employmentCols = [];
for (let C = range.s.c; C <= range.e.c; ++C) {
  const h2 = headers2[C] || '';
  const h3 = headers3[C] || '';

  if (String(h2).includes('분기') || String(h3).includes('취업')) {
    console.log(`  Col ${C}: group='${h2}', field='${h3}'`);
    employmentCols.push({ col: C, h2, h3 });
  }
}

console.log('\n=== 첫 5행의 취업현황 데이터 (데이터가 있는 것만) ===');

for (let R = 3; R <= 7; R++) {  // rows 4-8
  console.log(`\nRow ${R + 1}:`);

  for (const { col, h2, h3 } of employmentCols.slice(0, 15)) {
    const cell = ws[XLSX.utils.encode_cell({ r: R, c: col })];
    const val = cell ? cell.v : '';
    if (val && String(val).trim()) {
      console.log(`  ${h2}_${h3}: '${val}'`);
    }
  }
}
