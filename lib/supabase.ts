import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// 클라이언트 생성 (환경변수가 없으면 빈 문자열로 생성 - 런타임에서 에러 처리)
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

// getSupabase는 호환성을 위해 유지
export function getSupabase() {
  return supabase
}

// Auth Functions
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  })
  if (error) throw error
  return data
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  return user
}

export function onAuthStateChange(callback: (event: string, session: unknown) => void) {
  return supabase.auth.onAuthStateChange(callback)
}

// Types
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

export interface MappingHistory {
  id: string
  template_id: string
  data_file_name: string
  mappings: Record<string, string | null>
  status: string
  created_at: string
}

// Template Functions
export async function getTemplates() {
  const { data, error } = await supabase
    .from('templates')
    .select(`
      *,
      template_columns (*)
    `)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getTemplate(id: string) {
  const { data, error } = await supabase
    .from('templates')
    .select(`
      *,
      template_columns (*)
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createTemplate(
  template: Omit<Template, 'id' | 'created_at' | 'updated_at'>,
  columns: Omit<TemplateColumn, 'id' | 'template_id' | 'created_at'>[]
) {
  // Insert template
  const { data: templateData, error: templateError } = await supabase
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

    const { error: columnsError } = await supabase
      .from('template_columns')
      .insert(columnsWithTemplateId)

    if (columnsError) throw columnsError
  }

  return templateData
}

export async function deleteTemplate(id: string) {
  const { error } = await supabase
    .from('templates')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Storage Functions
export async function uploadTemplateFile(file: File, templateId: string) {
  const filePath = `${templateId}/${file.name}`

  const { error } = await supabase.storage
    .from('templates')
    .upload(filePath, file)

  if (error) throw error

  const { data: urlData } = supabase.storage
    .from('templates')
    .getPublicUrl(filePath)

  return urlData.publicUrl
}

// NestJS API: Generate Mapping
const NEST_API_URL = process.env.NEXT_PUBLIC_NEST_API_URL || 'http://localhost:4000/api'

export async function generateMapping(
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

// Mapping History
export async function saveMappingHistory(
  templateId: string,
  dataFileName: string,
  mappings: Record<string, string | null>
) {
  const { data, error } = await supabase
    .from('mapping_history')
    .insert({
      template_id: templateId,
      data_file_name: dataFileName,
      mappings,
      status: 'completed'
    })
    .select()
    .single()

  if (error) throw error
  return data
}
