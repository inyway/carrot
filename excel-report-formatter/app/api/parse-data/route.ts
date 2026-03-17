import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

interface ApiResponse<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

type DataRow = Record<string, string | number | boolean | null>;

interface ParsedData {
  headers: string[];
  rows: DataRow[];
}

// 이메일 컬럼 자동 감지
function detectEmailColumn(headers: string[], rows: DataRow[]): string | null {
  const emailPatterns = ['이메일', 'email', 'e-mail', 'e_mail', 'mail'];
  // 1. 헤더 이름으로 감지
  for (const header of headers) {
    const normalized = header.replace(/\s+/g, '').toLowerCase();
    if (emailPatterns.some(p => normalized.includes(p))) {
      return header;
    }
  }
  // 2. 첫 번째 데이터 행 값이 이메일 패턴 헤더명인 경우 (멀티로우 헤더)
  if (rows.length > 0) {
    for (const header of headers) {
      const val = String(rows[0][header] || '').replace(/\s+/g, '').toLowerCase();
      if (emailPatterns.some(p => val.includes(p))) {
        return header;
      }
    }
  }
  // 3. 셀 값에 이메일 주소가 있는 컬럼 (2행 교대 패턴 고려: 짝수 행만 이메일일 수 있음)
  const sample = rows.slice(0, Math.min(10, rows.length));
  for (const header of headers) {
    const emailCount = sample.filter(row => {
      const val = String(row[header] || '').trim();
      return val.includes('@') && val.includes('.');
    }).length;
    if (emailCount >= Math.ceil(sample.length * 0.3)) {
      return header;
    }
  }
  return null;
}

// 같은 사람의 여러 행(일정 행 + 출결 행 등)을 1행으로 병합
// 패턴: 이메일 있는 행(일정) 다음에 이메일 없는 행(출결)이 교대로 나오는 구조
function mergePairedRows(
  rows: DataRow[],
  headers: string[],
): { rows: DataRow[]; headers: string[] } {
  if (rows.length < 2) return { rows, headers };

  const emailCol = detectEmailColumn(headers, rows);
  if (!emailCol) return { rows, headers };

  // 그룹핑: 이메일 있는 행 + 뒤따르는 동일/빈 이메일 행을 같은 그룹으로
  const groups: DataRow[][] = [];
  let i = 0;
  while (i < rows.length) {
    const email = String(rows[i][emailCol] || '').trim().toLowerCase();
    if (email) {
      const group: DataRow[] = [rows[i]];
      while (i + 1 < rows.length) {
        const nextEmail = String(rows[i + 1][emailCol] || '').trim().toLowerCase();
        if (nextEmail === email || !nextEmail) {
          i++;
          group.push(rows[i]);
        } else {
          break;
        }
      }
      groups.push(group);
    } else {
      groups.push([rows[i]]);
    }
    i++;
  }

  // 병합 필요 여부 확인
  const hasMultiRow = groups.some(g => g.length > 1);
  if (!hasMultiRow) return { rows, headers };

  // 컬럼 분류: 전체 멀티 그룹 기준
  // 앞 학생에게 비어 있는 후반 회차 컬럼도, 뒤 학생에서 일정/출결 쌍이 보이면
  // differingCols로 승격시켜 "(출결)" 옵션이 유지되도록 한다.
  const multiRowGroups = groups.filter(g => g.length > 1);
  const sameCols: string[] = [];
  const fillCols: string[] = [];
  const differingCols: string[] = [];

  for (const h of headers) {
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
      // 한 행만 값이 있고 나머지는 빈값 → fill 컬럼
      fillCols.push(h);
    } else {
      sameCols.push(h);
    }
  }

  if (differingCols.length === 0) {
    // fill 컬럼만 있으면 비null 값으로 채워서 반환
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

  // 출결 패턴 감지로 행 타입 분류
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

  // 행 타입 라벨 결정
  const sampleGroup = multiRowGroups
    .map(group => ({
      group,
      score: differingCols.reduce((count, col) => {
        return count + (group.some(row => String(row[col] ?? '').trim().length > 0) ? 1 : 0);
      }, 0),
    }))
    .sort((a, b) => b.score - a.score || b.group.length - a.group.length)[0]?.group || multiRowGroups[0];

  const rowLabels = sampleGroup.map(row => isAttendanceRow(row) ? '출결' : '일정');
  const useLabels = new Set(rowLabels).size > 1;

  // 새 헤더: same + fill 컬럼 그대로, differing 컬럼만 접미사
  const baseCols = [...sameCols, ...fillCols];
  const newHeaders = [...baseCols];
  for (let idx = 0; idx < sampleGroup.length; idx++) {
    const suffix = useLabels ? rowLabels[idx] : `${idx + 1}`;
    for (const col of differingCols) {
      newHeaders.push(`${col}(${suffix})`);
    }
  }

  // 그룹별 병합
  const mergedRows: DataRow[] = [];
  for (const group of groups) {
    const merged: DataRow = {};
    // same + fill 컬럼: 비null 값 사용
    for (const col of baseCols) {
      merged[col] = group.reduce<DataRow[string]>((acc, row) => {
        const val = row[col];
        return (acc === null || acc === undefined || acc === '') ? val : acc;
      }, null);
    }
    // differing 컬럼: 접미사 붙여서 각 행 값 보존
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

  console.log(`[parse-data] Merged paired rows by "${emailCol}": ${rows.length} → ${mergedRows.length} rows, ${headers.length} → ${newHeaders.length} columns`);
  return { rows: mergedRows, headers: newHeaders };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '파일이 필요합니다.' },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    const arrayBuffer = await file.arrayBuffer();

    let headers: string[] = [];
    let rows: Record<string, string | number | boolean | null>[] = [];

    if (fileName.endsWith('.csv')) {
      // CSV 파싱
      const text = new TextDecoder('utf-8').decode(arrayBuffer);
      const result = Papa.parse<Record<string, unknown>>(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        transformHeader: (value) => value.trim(),
      });

      if (result.errors.length > 0) {
        return NextResponse.json<ApiResponse>(
          { success: false, error: `CSV 파싱 오류: ${result.errors[0].message}` },
          { status: 400 }
        );
      }

      headers = result.meta.fields ?? [];
      rows = result.data.map((row) => {
        const normalized: Record<string, string | number | boolean | null> = {};
        headers.forEach((header) => {
          const value = row[header];
          if (value === null || value === undefined || value === '') {
            normalized[header] = null;
          } else if (typeof value === 'number' || typeof value === 'boolean') {
            normalized[header] = value;
          } else {
            normalized[header] = String(value);
          }
        });
        return normalized;
      });
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      // Excel 파싱 (스마트 헤더 감지)
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // 스마트 헤더 행 탐색: 짧은 고유 텍스트가 많고 __EMPTY가 적은 행
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      let bestHeaderRow = 0; // 0-indexed
      let bestScore = -Infinity;

      for (let r = 0; r <= Math.min(range.e.r, 9); r++) {
        const testData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          header: 1,
          range: r,
          defval: null,
        });
        if (testData.length === 0) continue;

        const firstRow = testData[0] as unknown as unknown[];
        if (!Array.isArray(firstRow)) continue;

        let nonEmpty = 0;
        let shortLabels = 0;
        let emptyPlaceholders = 0;
        let sectionMarkers = 0;

        for (const val of firstRow) {
          const text = String(val ?? '').trim();
          if (!text || text === 'null') continue;
          nonEmpty++;
          if (text.length >= 2 && text.length <= 20) shortLabels++;
          if (text.startsWith('__EMPTY')) emptyPlaceholders++;
          if (/^\d+\./.test(text)) sectionMarkers++;
        }

        const score = nonEmpty * 2 + shortLabels * 3 - emptyPlaceholders * 5 - sectionMarkers * 10;
        if (nonEmpty >= 3 && score > bestScore) {
          bestScore = score;
          bestHeaderRow = r;
        }
      }

      console.log(`[parse-data] Smart header detection: using row ${bestHeaderRow + 1} as header`);

      // 감지된 헤더 행부터 JSON 변환
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        range: bestHeaderRow,
      });

      if (jsonData.length > 0) {
        // __EMPTY 컬럼 제거하고 유효한 헤더만 사용
        const rawHeaders = Object.keys(jsonData[0]);
        headers = rawHeaders.filter(h => !h.startsWith('__EMPTY'));

        rows = jsonData.map(row => {
          const newRow: DataRow = {};
          for (const key of headers) {
            const value = row[key];
            if (value === null || value === undefined) {
              newRow[key] = null;
            } else if (typeof value === 'number' || typeof value === 'boolean') {
              newRow[key] = value;
            } else {
              newRow[key] = String(value);
            }
          }
          return newRow;
        });

        // 서브 헤더 행 제거 (헤더와 동일한 값을 가진 행)
        rows = rows.filter(row => {
          const matchCount = headers.filter(h => String(row[h] || '') === h).length;
          return matchCount < headers.length * 0.5;
        });
      }
    } else {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'CSV 또는 Excel 파일(.xlsx, .xls)만 지원합니다.' },
        { status: 400 }
      );
    }

    // 같은 사람의 여러 행(일정+출결 등)을 1행으로 병합
    const merged = mergePairedRows(rows, headers);

    return NextResponse.json<ApiResponse<ParsedData>>({
      success: true,
      data: { headers: merged.headers, rows: merged.rows },
    });
  } catch (error) {
    console.error('Parse data error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: error instanceof Error ? error.message : '파일 파싱 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
