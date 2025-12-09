import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

// POST: AI 기반 자동 매핑 생성 → NestJS로 프록시
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const response = await fetch(`${API_BASE_URL}/hwpx/ai-mapping`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('NestJS AI mapping error:', errorText);
      return NextResponse.json(
        { success: false, error: `AI 매핑 생성 실패: ${response.status}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    // success 필드 추가
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Proxy POST /hwpx/ai-mapping error:', error);
    return NextResponse.json(
      { success: false, error: 'AI 매핑 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
