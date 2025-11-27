import { NextRequest, NextResponse } from 'next/server';
import { analyzeTemplate } from '@/lib/excel-processor';
import { ApiResponse, AnalyzeTemplateResponse } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '파일이 필요합니다.' },
        { status: 400 }
      );
    }

    // 파일 형식 확인
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Excel 파일(.xlsx, .xls)만 지원합니다.' },
        { status: 400 }
      );
    }

    // 파일을 Buffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 템플릿 분석
    const result = await analyzeTemplate(buffer);

    return NextResponse.json<ApiResponse<AnalyzeTemplateResponse>>({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Template analysis error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
