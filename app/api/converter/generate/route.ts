import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEST_API_URL || 'http://localhost:4000';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const targetUrl = `${API_BASE_URL}/api/generate`;
    console.log('[converter/generate] Forwarding to:', targetUrl);

    // Forward multipart form data to NestJS backend
    const res = await fetch(targetUrl, {
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
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[converter/generate] Error:', errMsg, 'API_BASE_URL:', API_BASE_URL);
    return NextResponse.json(
      { error: `보고서 생성 중 오류: ${errMsg}` },
      { status: 500 },
    );
  }
}
