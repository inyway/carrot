import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// 서버 사이드용 Supabase 클라이언트 (API Routes에서 사용)
export const supabaseServer = createClient(supabaseUrl, supabaseAnonKey)

// Types (re-export from main supabase file for convenience)
export interface Template {
  id: string
  name: string
  file_name: string
  sheet_name?: string
  header_row: number
  data_start_row: number
  file_url?: string
  created_at: string
  updated_at: string
}

export interface TemplateColumn {
  id: string
  template_id: string
  column_name: string
  column_type: string
  column_index: number
  is_required?: boolean
  created_at: string
}

// Template Functions for Server
export async function getTemplatesServer() {
  const { data, error } = await supabaseServer
    .from('templates')
    .select(`
      *,
      template_columns (*)
    `)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function createTemplateServer(
  template: Omit<Template, 'id' | 'created_at' | 'updated_at'>,
  columns: Omit<TemplateColumn, 'id' | 'template_id' | 'created_at'>[]
) {
  // Insert template
  const { data: templateData, error: templateError } = await supabaseServer
    .from('templates')
    .insert(template)
    .select()
    .single()

  if (templateError) throw templateError

  // Insert columns
  if (columns.length > 0) {
    const columnsWithTemplateId = columns.map((col) => ({
      ...col,
      template_id: templateData.id,
    }))

    const { error: columnsError } = await supabaseServer
      .from('template_columns')
      .insert(columnsWithTemplateId)

    if (columnsError) throw columnsError
  }

  return templateData
}

export async function deleteTemplateServer(id: string) {
  const { error } = await supabaseServer
    .from('templates')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Edge Function: Generate Mapping
export async function generateMappingServer(
  templateColumns: string[],
  dataColumns: string[],
  command?: string
) {
  const { data, error } = await supabaseServer.functions.invoke('generate-mapping', {
    body: { templateColumns, dataColumns, command }
  })

  if (error) throw error
  return data
}
