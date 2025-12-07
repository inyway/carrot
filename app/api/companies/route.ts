import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

/**
 * GET /api/companies
 * 회사 목록 조회
 */
export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/companies`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Proxy GET /companies error:', error);
    return NextResponse.json(
      { success: false, error: '회사 목록을 불러오는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/companies
 * 새 회사 등록
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE_URL}/companies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Proxy POST /companies error:', error);
    return NextResponse.json(
      { success: false, error: '회사 등록 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
