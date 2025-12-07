import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const response = await fetch(`${API_BASE_URL}/rag/clean-reports/${params.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to delete clean report' },
      { status: 500 }
    );
  }
}
