import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

interface ColumnMapping {
  templateColumn: string;
  dataColumn: string | null;
  status: 'matched' | 'unmatched' | 'manual';
}

interface ApiResponse<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ReportData {
  name: string;
  templateId: string;
  templateName: string;
  dataFileName: string;
  mappings: ColumnMapping[];
  rowCount: number;
  headers: string[];
  previewData: Record<string, string | number | boolean | null>[];
  fullData: Record<string, string | number | boolean | null>[];
}

// GET: 저장된 보고서 목록 조회
export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json<ApiResponse<typeof data>>({
      success: true,
      data: data || [],
    });
  } catch (error) {
    console.error('Get reports error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: error instanceof Error ? error.message : '보고서 목록 조회 실패' },
      { status: 500 }
    );
  }
}

// POST: 보고서 저장
export async function POST(request: NextRequest) {
  try {
    const body: ReportData = await request.json();

    const { name, templateId, templateName, dataFileName, mappings, rowCount, headers, previewData, fullData } = body;

    if (!name || !templateId || !mappings) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '필수 필드가 누락되었습니다.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseServer
      .from('reports')
      .insert({
        name,
        template_id: templateId,
        template_name: templateName,
        data_file_name: dataFileName,
        mappings,
        row_count: rowCount,
        matched_count: mappings.filter(m => m.dataColumn !== null).length,
        headers: headers || [],
        preview_data: previewData || [],
        full_data: fullData || [],
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json<ApiResponse<typeof data>>({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Save report error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: error instanceof Error ? error.message : '보고서 저장 실패' },
      { status: 500 }
    );
  }
}

// DELETE: 보고서 삭제
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '보고서 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    const { error } = await supabaseServer
      .from('reports')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    return NextResponse.json<ApiResponse>({
      success: true,
    });
  } catch (error) {
    console.error('Delete report error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: error instanceof Error ? error.message : '보고서 삭제 실패' },
      { status: 500 }
    );
  }
}
