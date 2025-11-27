import { NextRequest, NextResponse } from 'next/server';
import { loadTemplateFile, loadTemplateConfig, templateExists } from '@/lib/file-storage';
import { parseDataFile, processData } from '@/lib/excel-processor';
import { ApiResponse } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const templateId = formData.get('templateId') as string | null;
    const dataFile = formData.get('dataFile') as File | null;

    if (!templateId || !dataFile) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '템플릿 ID와 데이터 파일이 필요합니다.' },
        { status: 400 }
      );
    }

    // 템플릿 존재 확인
    const exists = await templateExists(templateId);
    if (!exists) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '템플릿을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 템플릿 및 설정 로드
    const templateBuffer = await loadTemplateFile(templateId);
    const config = await loadTemplateConfig(templateId);

    // 데이터 파일 파싱
    const dataArrayBuffer = await dataFile.arrayBuffer();
    const dataBuffer = Buffer.from(dataArrayBuffer);
    const data = await parseDataFile(dataBuffer, dataFile.name);

    if (data.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '데이터 파일이 비어있습니다.' },
        { status: 400 }
      );
    }

    // 데이터 변환
    const resultBuffer = await processData(templateBuffer, config, data);

    // 파일 이름 생성
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = `${config.name}_${dateStr}.xlsx`;

    // 파일 응답
    return new NextResponse(new Uint8Array(resultBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error('Process data error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: error instanceof Error ? error.message : '데이터 변환 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
