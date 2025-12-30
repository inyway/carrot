const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const API_BASE = 'http://localhost:4000/api';

async function testFullFlow() {
  console.log('=== Full Flow Test ===\n');

  const templatePath = path.join(__dirname, '개인이력카드(정아리아님) (1).hwpx');
  const excelPath = path.join(__dirname, '한국산업인력공단 리턴업 명단 251209 최신버전.xlsx');

  // Check files exist
  if (!fs.existsSync(templatePath)) {
    console.error('Template file not found:', templatePath);
    return;
  }
  if (!fs.existsSync(excelPath)) {
    console.error('Excel file not found:', excelPath);
    return;
  }

  console.log('1. Testing HWPX Analyze...');
  try {
    const analyzeForm = new FormData();
    analyzeForm.append('file', fs.createReadStream(templatePath));

    const analyzeRes = await fetch(`${API_BASE}/hwpx/analyze`, {
      method: 'POST',
      body: analyzeForm,
    });

    if (!analyzeRes.ok) {
      console.error('Analyze failed:', await analyzeRes.text());
      return;
    }

    const analyzeData = await analyzeRes.json();
    console.log('   ✓ Template analyzed:', {
      tables: analyzeData.tables?.length || 0,
      sections: analyzeData.sections?.length || 0,
    });
  } catch (err) {
    console.error('   ✗ Analyze error:', err.message);
    return;
  }

  console.log('\n2. Testing Excel Columns...');
  let excelColumns = [];
  try {
    const columnsForm = new FormData();
    columnsForm.append('file', fs.createReadStream(excelPath));

    const columnsRes = await fetch(`${API_BASE}/hwpx/excel-columns`, {
      method: 'POST',
      body: columnsForm,
    });

    if (!columnsRes.ok) {
      console.error('Excel columns failed:', await columnsRes.text());
      return;
    }

    const columnsData = await columnsRes.json();
    excelColumns = columnsData.columns || [];
    console.log('   ✓ Excel columns:', excelColumns.slice(0, 5).join(', ') + '...');
    console.log('   ✓ Sheet name:', columnsData.sheetName);
    console.log('   ✓ Row count:', columnsData.rowCount);
  } catch (err) {
    console.error('   ✗ Excel columns error:', err.message);
    return;
  }

  console.log('\n3. Testing HWPX Generate (3 people sample)...');
  let generatedZip = null;
  const mappings = [
    { hwpxRow: 0, hwpxCol: 1, dataColumn: '이름', templateText: '' },
    { hwpxRow: 1, hwpxCol: 1, dataColumn: '생년월일', templateText: '' },
    { hwpxRow: 2, hwpxCol: 1, dataColumn: '연락처', templateText: '' },
  ];

  try {
    const generateForm = new FormData();
    generateForm.append('template', fs.createReadStream(templatePath));
    generateForm.append('excel', fs.createReadStream(excelPath));
    generateForm.append('mappings', JSON.stringify(mappings));
    generateForm.append('limit', '3');

    const generateRes = await fetch(`${API_BASE}/hwpx/generate`, {
      method: 'POST',
      body: generateForm,
    });

    if (!generateRes.ok) {
      console.error('Generate failed:', await generateRes.text());
      return;
    }

    generatedZip = Buffer.from(await generateRes.arrayBuffer());
    console.log('   ✓ Generated ZIP size:', (generatedZip.length / 1024).toFixed(1), 'KB');

    // Save for inspection
    fs.writeFileSync('/tmp/generated_test.zip', generatedZip);
    console.log('   ✓ Saved to /tmp/generated_test.zip');
  } catch (err) {
    console.error('   ✗ Generate error:', err.message);
    return;
  }

  console.log('\n4. Testing 3-Way Diff Verification...');
  try {
    const verifyForm = new FormData();
    verifyForm.append('template', fs.createReadStream(templatePath));
    verifyForm.append('excel', fs.createReadStream(excelPath));
    verifyForm.append('generatedZip', generatedZip, { filename: 'generated.zip' });
    verifyForm.append('mappings', JSON.stringify(mappings));
    verifyForm.append('sampleSize', '3');

    const verifyRes = await fetch(`${API_BASE}/hwpx/verify`, {
      method: 'POST',
      body: verifyForm,
    });

    if (!verifyRes.ok) {
      const errorText = await verifyRes.text();
      console.error('Verify failed:', errorText);
      return;
    }

    const verifyData = await verifyRes.json();
    console.log('   ✓ Verification Result:');
    console.log('     - Status:', verifyData.status);
    console.log('     - Accuracy:', verifyData.accuracy?.toFixed(1) + '%');
    console.log('     - Sampled:', verifyData.sampledCount, '/', verifyData.totalCount);
    console.log('     - Issues:', verifyData.allIssues?.length || 0);

    if (verifyData.agentResults) {
      console.log('     - Agent Results:');
      verifyData.agentResults.forEach(agent => {
        console.log(`       · ${agent.agentName}: ${agent.passed ? '✓' : '✗'} (${agent.accuracy?.toFixed(0)}%)`);
      });
    }

    if (verifyData.aiSummary) {
      console.log('     - AI Summary:', verifyData.aiSummary.slice(0, 100) + '...');
    }
  } catch (err) {
    console.error('   ✗ Verify error:', err.message);
    return;
  }

  console.log('\n=== Full Flow Test Complete ===');
}

testFullFlow().catch(console.error);
