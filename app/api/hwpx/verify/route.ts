import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

/**
 * POST: 3-Way Diff 검증 → NestJS로 프록시
 *
 * 생성된 HWPX 파일들을 템플릿 및 Excel 원본과 비교하여 검증
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    console.log('[verify route] Proxying to NestJS...');

    const response = await fetch(`${API_BASE_URL}/hwpx/verify`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[verify route] NestJS error:', errorText);
      return NextResponse.json(
        { success: false, error: `검증 실패: ${response.status}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log('[verify route] Verification result:', {
      status: result.status,
      accuracy: result.accuracy?.toFixed?.(1) + '%',
      issueCount: result.allIssues?.length || 0,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[verify route] Error:', error);
    return NextResponse.json(
      { success: false, error: '검증 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
