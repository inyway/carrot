import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

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
