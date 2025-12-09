import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')

interface MappingRequest {
  templateColumns: string[]
  dataColumns: string[]
  command?: string // 사용자 명령 (예: "날짜 컬럼을 date에 매핑해줘")
}

interface ColumnMapping {
  templateColumn: string
  dataColumn: string | null
  confidence: number
  reason: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { templateColumns, dataColumns, command }: MappingRequest = await req.json()

    if (!templateColumns || !dataColumns) {
      return new Response(
        JSON.stringify({ error: 'templateColumns and dataColumns are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Gemini API 호출
    const prompt = buildPrompt(templateColumns, dataColumns, command)
    const mappings = await callGeminiAPI(prompt)

    return new Response(
      JSON.stringify({ success: true, mappings }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function buildPrompt(templateColumns: string[], dataColumns: string[], command?: string): string {
  const basePrompt = `당신은 엑셀 데이터 매핑 전문가입니다.
템플릿 컬럼과 데이터 컬럼을 매핑해주세요.

템플릿 컬럼 (보고서 양식):
${templateColumns.map((c, i) => `${i + 1}. ${c}`).join('\n')}

데이터 컬럼 (원본 데이터):
${dataColumns.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${command ? `사용자 요청: ${command}\n` : ''}

각 템플릿 컬럼에 대해 가장 적합한 데이터 컬럼을 매핑해주세요.
매핑이 불가능한 경우 null로 표시하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "mappings": [
    {
      "templateColumn": "템플릿 컬럼명",
      "dataColumn": "매핑된 데이터 컬럼명 또는 null",
      "confidence": 0.0-1.0 사이의 신뢰도,
      "reason": "매핑 이유 (한국어로 간단히)"
    }
  ]
}
`
  return basePrompt
}

async function callGeminiAPI(prompt: string): Promise<ColumnMapping[]> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set')
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        }
      })
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!textContent) {
    throw new Error('No response from Gemini')
  }

  // JSON 추출 (마크다운 코드 블록 제거)
  const jsonMatch = textContent.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Could not parse JSON from response')
  }

  const parsed = JSON.parse(jsonMatch[0])
  return parsed.mappings || []
}
