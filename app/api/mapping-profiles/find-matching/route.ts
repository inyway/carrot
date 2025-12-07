import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * POST /api/mapping-profiles/find-matching
 * 헤더 기반 최적 매핑 프로필 찾기
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE_URL}/api/mapping-profiles/find-matching`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Find matching profile proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to find matching profile' },
      { status: 500 }
    );
  }
}
