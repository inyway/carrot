import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const response = await fetch(`${API_BASE_URL}/generate/analyze`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { success: false, error: error || 'Analysis failed' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[converter/analyze] Proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
