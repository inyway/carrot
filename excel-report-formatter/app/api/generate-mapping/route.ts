import { NextRequest, NextResponse } from 'next/server';
import { generateMappingServer } from '@/lib/supabase-server';

interface ApiResponse<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

// POST: LLM을 사용한 매핑 생성
export async function POST(request: NextRequest) {
  try {
    const { templateColumns, dataColumns, command } = await request.json();

    if (!templateColumns || !dataColumns) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'templateColumns와 dataColumns가 필요합니다.' },
        { status: 400 }
      );
    }

    const result = await generateMappingServer(templateColumns, dataColumns, command);

    return NextResponse.json<ApiResponse<typeof result>>({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Generate mapping error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: error instanceof Error ? error.message : '매핑 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
