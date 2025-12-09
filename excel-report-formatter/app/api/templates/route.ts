import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

// GET: 템플릿 목록 조회 → NestJS로 프록시
export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/templates`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Proxy GET /templates error:', error);
    return NextResponse.json(
      { success: false, error: '템플릿 목록을 불러오는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// POST: 새 템플릿 등록 → NestJS로 프록시
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const response = await fetch(`${API_BASE_URL}/templates`, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Proxy POST /templates error:', error);
    return NextResponse.json(
      { success: false, error: '템플릿 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// DELETE: 템플릿 삭제 → NestJS로 프록시
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '템플릿 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/templates?id=${id}`, {
      method: 'DELETE',
    });

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Proxy DELETE /templates error:', error);
    return NextResponse.json(
      { success: false, error: '템플릿 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
