import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface MappingRequest {
  templateColumns: string[];
  dataColumns: string[];
  templateSampleData?: Record<string, unknown>[];
  dataSampleData?: Record<string, unknown>[];
}

interface MappingResult {
  templateField: string;
  dataColumn: string;
  confidence: number;
  reason: string;
}

// 동의어 사전 (한국어 비즈니스 컬럼 매핑)
const SYNONYM_GROUPS: string[][] = [
  ['이름', '성명', '한글이름', '성함', 'name', 'full_name', '이름(한글)', '직원명', '사원명', '참가자명', '학생명'],
  ['번호', 'No', 'No.', '순번', '연번', 'number', 'num', '#', '순서'],
  ['이메일', 'email', 'e-mail', '전자메일', '메일', '이메일주소', 'email_address'],
  ['전화번호', '연락처', '핸드폰', '휴대폰', 'phone', 'tel', '전화', '폰번호', '핸드폰번호', '휴대전화'],
  ['부서', '부서명', 'department', 'dept', '소속', '소속부서'],
  ['직급', '직위', '직책', 'position', 'title', 'rank', '직함'],
  ['날짜', '일자', 'date', '기준일', '작성일', '등록일', '일시'],
  ['금액', '비용', '가격', '단가', 'price', 'amount', 'cost', '매출', '매출액', '판매금액'],
  ['수량', '개수', '건수', 'quantity', 'qty', 'count', '갯수'],
  ['주소', '주소지', 'address', '거주지', '소재지'],
  ['회사', '회사명', '업체', '업체명', '거래처', 'company', '기관', '기관명', '소속기관'],
  ['출석', '출결', '참석', 'attendance', '출석률', '출결현황', '참석여부'],
  ['점수', '성적', '평점', 'score', 'grade', '등급', '평가'],
  ['비고', '메모', '기타', '참고', 'note', 'notes', 'memo', 'remark', '비고사항'],
  ['시작일', '시작', '시작날짜', 'start', 'start_date', '개시일', '시작일자'],
  ['종료일', '종료', '마감일', 'end', 'end_date', '완료일', '종료일자', '마감'],
  ['기간', '주차', '회차', '월회차', 'week', 'period', '차수'],
  ['합계', '총계', '소계', 'total', 'sum', '총합'],
  ['평균', '평균값', 'average', 'avg', '평균치'],
  ['상품', '상품명', '제품', '제품명', '품명', '품목', 'product', 'item', '물품'],
  ['카테고리', '분류', '구분', 'category', '종류', '유형', 'type'],
  ['생년월일', '생일', 'birthday', 'birth_date', 'dob'],
  ['성별', '성', 'gender', 'sex'],
  ['ID', '아이디', 'id', 'identifier', '사번', '학번', '사원번호'],
];

// 동의어 기반 규칙 매핑
function findSynonymMatch(
  templateCol: string,
  dataColumns: string[]
): { dataColumn: string; confidence: number; reason: string } | null {
  const templateLower = templateCol.toLowerCase().trim();

  for (const group of SYNONYM_GROUPS) {
    const templateInGroup = group.some(
      syn => syn.toLowerCase() === templateLower || templateLower.includes(syn.toLowerCase()) || syn.toLowerCase().includes(templateLower)
    );

    if (templateInGroup) {
      for (const dataCol of dataColumns) {
        const dataLower = dataCol.toLowerCase().trim();
        const dataInGroup = group.some(
          syn => syn.toLowerCase() === dataLower || dataLower.includes(syn.toLowerCase()) || syn.toLowerCase().includes(dataLower)
        );

        if (dataInGroup) {
          return {
            dataColumn: dataCol,
            confidence: templateLower === dataLower ? 1.0 : 0.8,
            reason: `동의어 매칭 (${group[0]} 그룹)`,
          };
        }
      }
    }
  }

  return null;
}

// 규칙 기반 fallback 매핑
function fallbackRuleMapping(
  templateColumns: string[],
  dataColumns: string[]
): MappingResult[] {
  const results: MappingResult[] = [];
  const usedDataColumns = new Set<string>();

  for (const templateCol of templateColumns) {
    const templateLower = templateCol.toLowerCase().trim();

    // 1. 정확 매칭
    const exactMatch = dataColumns.find(
      dc => dc.toLowerCase().trim() === templateLower && !usedDataColumns.has(dc)
    );
    if (exactMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: exactMatch,
        confidence: 1.0,
        reason: '정확 일치',
      });
      usedDataColumns.add(exactMatch);
      continue;
    }

    // 2. 부분 매칭
    const partialMatch = dataColumns.find(
      dc => !usedDataColumns.has(dc) && (
        dc.toLowerCase().includes(templateLower) ||
        templateLower.includes(dc.toLowerCase())
      )
    );
    if (partialMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: partialMatch,
        confidence: 0.7,
        reason: '부분 일치',
      });
      usedDataColumns.add(partialMatch);
      continue;
    }

    // 3. 동의어 매칭
    const synonymMatch = findSynonymMatch(
      templateCol,
      dataColumns.filter(dc => !usedDataColumns.has(dc))
    );
    if (synonymMatch) {
      results.push({
        templateField: templateCol,
        dataColumn: synonymMatch.dataColumn,
        confidence: synonymMatch.confidence,
        reason: synonymMatch.reason,
      });
      usedDataColumns.add(synonymMatch.dataColumn);
      continue;
    }
  }

  return results;
}

// Gemini API를 사용한 AI 매핑
async function aiMapping(
  apiKey: string,
  templateColumns: string[],
  dataColumns: string[],
  templateSampleData?: Record<string, unknown>[],
  dataSampleData?: Record<string, unknown>[]
): Promise<MappingResult[]> {
  // 샘플 데이터 포맷
  const templateSampleStr = templateSampleData && templateSampleData.length > 0
    ? '\n\n템플릿 샘플 데이터 (첫 2행):\n' + templateSampleData.slice(0, 2).map(
        (row, i) => `행 ${i + 1}: ${Object.entries(row).map(([k, v]) => `${k}="${v}"`).join(', ')}`
      ).join('\n')
    : '';

  const dataSampleStr = dataSampleData && dataSampleData.length > 0
    ? '\n\n데이터 파일 샘플 (첫 3행):\n' + dataSampleData.slice(0, 3).map(
        (row, i) => `행 ${i + 1}: ${Object.entries(row).map(([k, v]) => `${k}="${v}"`).join(', ')}`
      ).join('\n')
    : '';

  const prompt = `당신은 엑셀 데이터 매핑 전문가입니다.
두 개의 컬럼 목록을 의미론적으로 매칭해야 합니다.

## 템플릿 컬럼 (보고서 양식의 필드):
${templateColumns.map((c, i) => `${i + 1}. "${c}"`).join('\n')}
${templateSampleStr}

## 데이터 컬럼 (원본 데이터의 필드):
${dataColumns.map((c, i) => `${i + 1}. "${c}"`).join('\n')}
${dataSampleStr}

## 매핑 규칙:
1. 이름이 같으면 당연히 매칭 (confidence: 1.0)
2. 의미가 같은 한국어/영어 컬럼명 매칭 (예: "이름"↔"name", "번호"↔"No.")
3. 약어, 줄임말 인식 (예: "연락처"↔"전화번호", "금액"↔"price")
4. 날짜/기간 패턴 인식 (예: "주차"↔"Week", "기간"↔"period")
5. 비즈니스 도메인 유사성 (예: "출석률"↔"출결현황")
6. 샘플 데이터의 값 패턴으로 유추 (숫자만 있는 컬럼, 이메일 형식 등)
7. 매칭할 수 없는 컬럼은 포함하지 마세요
8. 하나의 데이터 컬럼은 하나의 템플릿 필드에만 매칭하세요

## 응답 형식 (반드시 JSON 배열만 출력):
[
  {"templateField": "템플릿필드명", "dataColumn": "데이터컬럼명", "confidence": 0.9, "reason": "매칭 이유"}
]

매칭 가능한 모든 쌍을 찾아 JSON 배열로 응답하세요. JSON 외의 텍스트는 출력하지 마세요.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini API returned empty response');
  }

  // JSON 파싱
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Failed to parse Gemini response as JSON array');
  }

  const parsed: MappingResult[] = JSON.parse(jsonMatch[0]);

  // 유효한 매핑만 필터링 (존재하는 컬럼명인지 확인)
  const templateSet = new Set(templateColumns);
  const dataSet = new Set(dataColumns);

  return parsed.filter(
    m => templateSet.has(m.templateField) && dataSet.has(m.dataColumn)
  );
}

export async function POST(request: NextRequest) {
  try {
    const body: MappingRequest = await request.json();
    const { templateColumns, dataColumns, templateSampleData, dataSampleData } = body;

    if (!templateColumns || !dataColumns || templateColumns.length === 0 || dataColumns.length === 0) {
      return NextResponse.json(
        { success: false, error: '템플릿 컬럼과 데이터 컬럼이 필요합니다.' },
        { status: 400 }
      );
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    let mappings: MappingResult[];

    if (geminiApiKey) {
      try {
        mappings = await aiMapping(
          geminiApiKey,
          templateColumns,
          dataColumns,
          templateSampleData,
          dataSampleData
        );

        // AI 결과가 부족하면 규칙 기반으로 보충
        const aiMappedTemplates = new Set(mappings.map(m => m.templateField));
        const unmappedTemplates = templateColumns.filter(t => !aiMappedTemplates.has(t));

        if (unmappedTemplates.length > 0) {
          const aiMappedDataCols = new Set(mappings.map(m => m.dataColumn));
          const remainingDataCols = dataColumns.filter(d => !aiMappedDataCols.has(d));
          const supplementary = fallbackRuleMapping(unmappedTemplates, remainingDataCols);
          mappings = [...mappings, ...supplementary];
        }
      } catch (error) {
        console.error('AI mapping failed, falling back to rules:', error);
        mappings = fallbackRuleMapping(templateColumns, dataColumns);
      }
    } else {
      // Gemini API 키 없으면 규칙 기반만 사용
      mappings = fallbackRuleMapping(templateColumns, dataColumns);
    }

    return NextResponse.json({
      success: true,
      mappings,
      totalTemplate: templateColumns.length,
      totalData: dataColumns.length,
      mappedCount: mappings.length,
    });
  } catch (error) {
    console.error('AI mapping error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'AI 매핑 실패' },
      { status: 500 }
    );
  }
}
