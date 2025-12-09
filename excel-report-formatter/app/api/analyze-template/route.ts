import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

// POST: 템플릿 분석 → NestJS로 프록시
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: '파일이 필요합니다.' },
        { status: 400 }
      );
    }

    // 파일 형식 확인
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      return NextResponse.json(
        { success: false, error: 'Excel 파일(.xlsx, .xls)만 지원합니다.' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/analyze-template`, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Proxy POST /analyze-template error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
