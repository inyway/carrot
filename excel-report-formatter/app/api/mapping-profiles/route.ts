import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * GET /api/mapping-profiles?templateId=xxx&sourceType=xxx
 * 매핑 프로필 목록 조회
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();

    const response = await fetch(
      `${API_BASE_URL}/api/mapping-profiles${queryString ? `?${queryString}` : ''}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Mapping profiles list proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch mapping profiles' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mapping-profiles
 * 새 매핑 프로필 생성
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE_URL}/api/mapping-profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Create mapping profile proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create mapping profile' },
      { status: 500 }
    );
  }
}
