import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

// POST: HWPX 일괄 생성 → NestJS로 프록시
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const response = await fetch(`${API_BASE_URL}/hwpx/generate`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { success: false, error: errorText || 'HWPX 생성 중 오류가 발생했습니다.' },
        { status: response.status }
      );
    }

    // ZIP 파일 바이너리 응답
    const zipBuffer = await response.arrayBuffer();
    const contentDisposition = response.headers.get('Content-Disposition') || 'attachment; filename="hwpx_output.zip"';

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition,
      },
    });
  } catch (error) {
    console.error('Proxy POST /hwpx/generate error:', error);
    return NextResponse.json(
      { success: false, error: 'HWPX 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
