import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/mapping-profiles/:id
 * 특정 프로필 조회
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    const response = await fetch(`${API_BASE_URL}/api/mapping-profiles/${id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Get mapping profile proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch mapping profile' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/mapping-profiles/:id
 * 프로필 업데이트
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    const response = await fetch(`${API_BASE_URL}/api/mapping-profiles/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Update mapping profile proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update mapping profile' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/mapping-profiles/:id
 * 프로필 삭제
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    const response = await fetch(`${API_BASE_URL}/api/mapping-profiles/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Delete mapping profile proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete mapping profile' },
      { status: 500 }
    );
  }
}
