import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

interface ApiResponse<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ParsedData {
  headers: string[];
  rows: Record<string, string | number | boolean | null>[];
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
      const lines = text.split('\n').filter(line => line.trim());

      if (lines.length > 0) {
        // 헤더 추출
        headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

        // 데이터 행 추출
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row: Record<string, string | number | boolean | null> = {};

          headers.forEach((header, index) => {
            const value = values[index] || '';
            // 숫자 변환 시도
            const num = Number(value);
            if (!isNaN(num) && value !== '') {
              row[header] = num;
            } else if (value.toLowerCase() === 'true') {
              row[header] = true;
            } else if (value.toLowerCase() === 'false') {
              row[header] = false;
            } else {
              row[header] = value || null;
            }
          });

          rows.push(row);
        }
      }
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      // Excel 파싱
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // JSON으로 변환 (첫 행을 헤더로 사용)
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

      if (jsonData.length > 0) {
        headers = Object.keys(jsonData[0]);
        rows = jsonData.map(row => {
          const newRow: Record<string, string | number | boolean | null> = {};
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
      }
    } else {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'CSV 또는 Excel 파일(.xlsx, .xls)만 지원합니다.' },
        { status: 400 }
      );
    }

    return NextResponse.json<ApiResponse<ParsedData>>({
      success: true,
      data: { headers, rows },
    });
  } catch (error) {
    console.error('Parse data error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: error instanceof Error ? error.message : '파일 파싱 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
