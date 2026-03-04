import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEST_API_URL || 'http://localhost:4000';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const incomingForm = await request.formData();
    const targetUrl = `${API_BASE_URL}/api/attendance/generate`;
    console.log('[converter/attendance-generate] Forwarding to:', targetUrl);

    // Rebuild FormData with proper filenames
    const outgoingForm = new FormData();
    incomingForm.forEach((value, key) => {
      if (value instanceof Blob) {
        const filename = (value as File).name || `${key}.bin`;
        outgoingForm.append(key, value, filename);
        console.log(`[converter/attendance-generate] File: ${key} = ${filename} (${value.size} bytes)`);
      } else {
        outgoingForm.append(key, String(value));
      }
    });

    const res = await fetch(targetUrl, {
      method: 'POST',
      body: outgoingForm,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[converter/attendance-generate] Backend error:', res.status, errorText.slice(0, 500));
      return NextResponse.json(
        { error: errorText.slice(0, 200) || '출결 보고서 생성 실패' },
        { status: res.status },
      );
    }

    // Forward binary response
    const buffer = await res.arrayBuffer();
    const contentDisposition = res.headers.get('Content-Disposition') || '';
    const contentType =
      res.headers.get('Content-Type') || 'application/octet-stream';

    console.log('[converter/attendance-generate] Success:', buffer.byteLength, 'bytes');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...(contentDisposition && { 'Content-Disposition': contentDisposition }),
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[converter/attendance-generate] Error:', errMsg);
    return NextResponse.json(
      { error: `출결 보고서 생성 중 오류: ${errMsg}` },
      { status: 500 },
    );
  }
}
