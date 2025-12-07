import { NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/report/supported-sources`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Supported sources proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch supported sources' },
      { status: 500 }
    );
  }
}
