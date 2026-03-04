import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // Forward multipart form data to NestJS backend
    const res = await fetch(`${API_BASE_URL}/generate`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[converter/generate] Backend error:', res.status, errorText);
      return NextResponse.json(
        { error: errorText || '보고서 생성 실패' },
        { status: res.status },
      );
    }

    // Forward binary response (zip/excel)
    const buffer = await res.arrayBuffer();
    const contentDisposition = res.headers.get('Content-Disposition') || '';
    const contentType =
      res.headers.get('Content-Type') || 'application/octet-stream';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...(contentDisposition && { 'Content-Disposition': contentDisposition }),
      },
    });
  } catch (error) {
    console.error('[converter/generate] Error:', error);
    return NextResponse.json(
      { error: '보고서 생성 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
