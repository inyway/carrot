import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, createTemplateServer, deleteTemplateServer } from '@/lib/supabase-server';

interface ApiResponse<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// GET: 템플릿 목록 조회
export async function GET() {
  try {
    const { data: templates, error } = await supabaseServer
      .from('templates')
      .select(`
        id,
        name,
        file_name,
        sheet_name,
        header_row,
        data_start_row,
        file_url,
        created_at,
        template_columns (
          id,
          column_name,
          column_type,
          column_index
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // 프론트엔드에서 사용하기 쉽게 변환
    const formattedTemplates = templates?.map((t) => ({
      id: t.id,
      name: t.name,
      fileName: t.file_name,
      columns: t.template_columns?.map((c: { column_name: string; column_type: string }) => ({
        name: c.column_name,
        type: c.column_type,
      })) || [],
      createdAt: t.created_at,
    })) || [];

    return NextResponse.json<ApiResponse<typeof formattedTemplates>>({
      success: true,
      data: formattedTemplates,
    });
  } catch (error) {
    console.error('Get templates error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: '템플릿 목록을 불러오는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// POST: 새 템플릿 등록
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const name = formData.get('name') as string | null;
    const columnsJson = formData.get('columns') as string | null;

    if (!file || !name) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '파일과 이름이 필요합니다.' },
        { status: 400 }
      );
    }

    // 컬럼 정보 파싱
    let columns: { column_name: string; column_type: string; column_index: number }[] = [];
    if (columnsJson) {
      try {
        const parsed = JSON.parse(columnsJson);
        columns = parsed.map((col: { name: string; type?: string }, index: number) => ({
          column_name: col.name,
          column_type: col.type || 'string',
          column_index: index,
          is_required: false,
        }));
      } catch {
        // 컬럼 파싱 실패 시 빈 배열 사용
      }
    }

    // 템플릿 생성
    const templateData = await createTemplateServer(
      {
        name,
        file_name: file.name,
        header_row: 1,
        data_start_row: 2,
      },
      columns
    );

    // 파일 Storage에 업로드 (선택사항)
    const filePath = `${templateData.id}/${file.name}`;
    const { error: uploadError } = await supabaseServer.storage
      .from('templates')
      .upload(filePath, file);

    if (!uploadError) {
      // 파일 URL 업데이트
      const { data: urlData } = supabaseServer.storage
        .from('templates')
        .getPublicUrl(filePath);

      await supabaseServer
        .from('templates')
        .update({ file_url: urlData.publicUrl })
        .eq('id', templateData.id);
    }

    return NextResponse.json<ApiResponse<{ id: string; name: string }>>({
      success: true,
      message: '템플릿이 등록되었습니다.',
      data: { id: templateData.id, name },
    });
  } catch (error) {
    console.error('Save template error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: error instanceof Error ? error.message : '템플릿 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// DELETE: 템플릿 삭제
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '템플릿 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    await deleteTemplateServer(id);

    return NextResponse.json<ApiResponse>({
      success: true,
      message: '템플릿이 삭제되었습니다.',
    });
  } catch (error) {
    console.error('Delete template error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: '템플릿 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
