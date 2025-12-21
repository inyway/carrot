import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // NestJS API로 프록시
    const res = await fetch(`${API_BASE_URL}/excel-formatter/hwpx/validate-mappings`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[validate-mappings] API error:', errorText);
      return NextResponse.json(
        { error: errorText || '검증 실패' },
        { status: res.status }
      );
    }

    const result = await res.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[validate-mappings] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '검증 실패' },
      { status: 500 }
    );
  }
}
