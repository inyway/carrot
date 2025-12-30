import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy initialization - 빌드 타임에 에러 방지
let supabaseServerInstance: SupabaseClient | null = null

function getSupabaseServer(): SupabaseClient {
  if (!supabaseServerInstance) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase environment variables')
    }
    
    supabaseServerInstance = createClient(supabaseUrl, supabaseAnonKey)
  }
  return supabaseServerInstance
}

// 서버 사이드용 Supabase 클라이언트 getter (API Routes에서 사용)
export { getSupabaseServer }

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
  const { data, error } = await getSupabaseServer()
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
  const client = getSupabaseServer()
  
  // Insert template
  const { data: templateData, error: templateError } = await client
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

    const { error: columnsError } = await client
      .from('template_columns')
      .insert(columnsWithTemplateId)

    if (columnsError) throw columnsError
  }

  return templateData
}

export async function deleteTemplateServer(id: string) {
  const { error } = await getSupabaseServer()
    .from('templates')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// NestJS API: Generate Mapping
const NEST_API_URL = process.env.NEST_API_URL || 'http://localhost:4000/api'

export async function generateMappingServer(
  templateColumns: string[],
  dataColumns: string[],
  command?: string
) {
  const response = await fetch(`${NEST_API_URL}/excel-formatter/mapping/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ templateColumns, dataColumns, command }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || `API error: ${response.status}`)
  }

  return response.json()
}
