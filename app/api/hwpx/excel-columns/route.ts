import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

// POST: Excel 파일 컬럼 정보 조회 → NestJS로 프록시
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const response = await fetch(`${API_BASE_URL}/hwpx/excel-columns`, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Proxy POST /hwpx/excel-columns error:', error);
    return NextResponse.json(
      { success: false, error: 'Excel 컬럼 정보를 가져오는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
