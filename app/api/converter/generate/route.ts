import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEST_API_URL || 'http://localhost:4000';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const incomingForm = await request.formData();
    const targetUrl = `${API_BASE_URL}/api/generate`;
    console.log('[converter/generate] Forwarding to:', targetUrl);

    // Rebuild FormData to ensure files are properly forwarded
    const outgoingForm = new FormData();
    for (const [key, value] of incomingForm.entries()) {
      if (value instanceof Blob) {
        // Preserve filename for file uploads
        const filename = (value as File).name || `${key}.bin`;
        outgoingForm.append(key, value, filename);
        console.log(`[converter/generate] File: ${key} = ${filename} (${value.size} bytes)`);
      } else {
        outgoingForm.append(key, value);
        const preview = String(value).slice(0, 100);
        console.log(`[converter/generate] Field: ${key} = ${preview}...`);
      }
    }

    const res = await fetch(targetUrl, {
      method: 'POST',
      body: outgoingForm,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[converter/generate] Backend error:', res.status, errorText.slice(0, 500));
      return NextResponse.json(
        { error: errorText.slice(0, 200) || '보고서 생성 실패' },
        { status: res.status },
      );
    }

    // Forward binary response (zip/excel)
    const buffer = await res.arrayBuffer();
    const contentDisposition = res.headers.get('Content-Disposition') || '';
    const contentType =
      res.headers.get('Content-Type') || 'application/octet-stream';

    console.log('[converter/generate] Success:', buffer.byteLength, 'bytes');

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
