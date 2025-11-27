import { NextRequest, NextResponse } from 'next/server';

interface ColumnMapping {
  templateColumn: string;
  dataColumn: string | null;
  status: 'matched' | 'unmatched' | 'manual';
}

interface MappingAction {
  type: 'map' | 'unmap' | 'auto_map' | 'info' | 'confirm';
  templateColumn?: string;
  dataColumn?: string | null;
  mappings?: { templateColumn: string; dataColumn: string }[];
  message: string;
}

interface ApiResponse<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ChatResponse {
  message: string;
  actions: MappingAction[];
}

// POST: 자연어 명령을 Gemini API로 처리
export async function POST(request: NextRequest) {
  try {
    const {
      userMessage,
      mappings,
      templateColumns,
      dataColumns
    }: {
      userMessage: string;
      mappings: ColumnMapping[];
      templateColumns: string[];
      dataColumns: string[];
    } = await request.json();

    if (!userMessage) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '메시지가 필요합니다.' },
        { status: 400 }
      );
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      // Gemini API 키가 없으면 간단한 규칙 기반 처리
      const result = processWithRules(userMessage, mappings, templateColumns, dataColumns);
      return NextResponse.json<ApiResponse<ChatResponse>>({
        success: true,
        data: result,
      });
    }

    // Gemini API 호출
    const result = await processWithGemini(
      geminiApiKey,
      userMessage,
      mappings,
      templateColumns,
      dataColumns
    );

    return NextResponse.json<ApiResponse<ChatResponse>>({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Chat mapping error:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// Gemini API를 사용한 처리
async function processWithGemini(
  apiKey: string,
  userMessage: string,
  mappings: ColumnMapping[],
  templateColumns: string[],
  dataColumns: string[]
): Promise<ChatResponse> {
  const unmatchedTemplateColumns = mappings
    .filter(m => m.status === 'unmatched')
    .map(m => m.templateColumn);

  const matchedMappings = mappings
    .filter(m => m.dataColumn !== null)
    .map(m => `"${m.templateColumn}" → "${m.dataColumn}"`);

  const systemPrompt = `당신은 엑셀 데이터 매핑을 도와주는 AI 어시스턴트입니다.

## 현재 상황:
- 템플릿 컬럼 (총 ${templateColumns.length}개): ${templateColumns.map(c => `"${c}"`).join(', ')}
- 데이터 컬럼 (총 ${dataColumns.length}개): ${dataColumns.map(c => `"${c}"`).join(', ')}
- 매칭된 매핑 (${matchedMappings.length}개): ${matchedMappings.join(', ') || '없음'}
- 미매칭 템플릿 컬럼 (${unmatchedTemplateColumns.length}개): ${unmatchedTemplateColumns.map(c => `"${c}"`).join(', ') || '없음'}

## 당신의 역할:
사용자의 자연어 요청을 이해하고 JSON 형식으로 응답하세요.

## 응답 형식 (반드시 이 JSON 형식으로만 응답):
{
  "message": "사용자에게 보여줄 메시지",
  "actions": [
    {
      "type": "map",  // map(매핑), unmap(매핑해제), auto_map(자동매핑), info(정보), confirm(확인)
      "templateColumn": "템플릿컬럼명",
      "dataColumn": "데이터컬럼명",
      "message": "이 액션에 대한 설명"
    }
  ]
}

## 액션 타입:
- "map": 특정 템플릿 컬럼을 데이터 컬럼에 매핑
- "unmap": 특정 템플릿 컬럼의 매핑 해제
- "auto_map": 여러 컬럼을 한 번에 자동 매핑 (mappings 배열 사용)
- "info": 정보 제공만 (액션 없음)
- "confirm": 다운로드 확정 요청

## 자동 매핑 로직:
컬럼명이 비슷하거나 의미가 같으면 매핑하세요. 예:
- "이름" ↔ "name", "성명"
- "이메일" ↔ "email", "전자메일", "전자 메일"
- "시작 시간" ↔ "start_time", "시작시간"

## 주의사항:
- 존재하지 않는 컬럼은 매핑하지 마세요
- 항상 한국어로 친절하게 응답하세요
- JSON 외의 다른 텍스트는 출력하지 마세요`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: systemPrompt + '\n\n사용자 요청: ' + userMessage }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
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

    // JSON 파싱 시도
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        message: parsed.message || '처리되었습니다.',
        actions: parsed.actions || [],
      };
    }

    return {
      message: text,
      actions: [],
    };
  } catch (error) {
    console.error('Gemini API error:', error);
    // 폴백으로 규칙 기반 처리
    return processWithRules(userMessage, mappings, templateColumns, dataColumns);
  }
}

// 규칙 기반 처리 (Gemini API 키가 없거나 실패 시)
function processWithRules(
  userMessage: string,
  mappings: ColumnMapping[],
  templateColumns: string[],
  dataColumns: string[]
): ChatResponse {
  const message = userMessage.toLowerCase();
  const actions: MappingAction[] = [];

  // 자동 매핑 요청
  if (message.includes('자동') && (message.includes('매칭') || message.includes('매핑'))) {
    const autoMappings: { templateColumn: string; dataColumn: string }[] = [];

    // 유사도 기반 매핑
    const similarityMap: Record<string, string[]> = {
      '이름': ['name', '성명', '이름', 'full_name'],
      '이메일': ['email', '전자메일', '전자 메일', 'e-mail'],
      '시작': ['start', '시작 시간', '시작시간', 'start_time'],
      '완료': ['end', '완료 시간', '완료시간', 'end_time', 'complete'],
      'id': ['id', 'ID', '아이디', 'identifier'],
    };

    const unmatchedTemplates = mappings.filter(m => m.status === 'unmatched');

    for (const mapping of unmatchedTemplates) {
      const templateLower = mapping.templateColumn.toLowerCase();

      for (const dataCol of dataColumns) {
        const dataLower = dataCol.toLowerCase();

        // 직접 매칭
        if (templateLower === dataLower ||
            templateLower.includes(dataLower) ||
            dataLower.includes(templateLower)) {
          autoMappings.push({
            templateColumn: mapping.templateColumn,
            dataColumn: dataCol,
          });
          break;
        }

        // 유사도 매핑
        for (const [key, values] of Object.entries(similarityMap)) {
          if (templateLower.includes(key) || values.some(v => templateLower.includes(v))) {
            if (dataLower.includes(key) || values.some(v => dataLower.includes(v))) {
              autoMappings.push({
                templateColumn: mapping.templateColumn,
                dataColumn: dataCol,
              });
              break;
            }
          }
        }
      }
    }

    if (autoMappings.length > 0) {
      actions.push({
        type: 'auto_map',
        mappings: autoMappings,
        message: `${autoMappings.length}개 컬럼을 자동 매핑했습니다.`,
      });

      return {
        message: `${autoMappings.length}개의 컬럼을 자동으로 매핑했습니다:\n${autoMappings.map(m => `• "${m.templateColumn}" → "${m.dataColumn}"`).join('\n')}`,
        actions,
      };
    } else {
      return {
        message: '자동으로 매핑할 수 있는 컬럼을 찾지 못했습니다. 수동으로 매핑해주세요.',
        actions: [{ type: 'info', message: '자동 매핑 실패' }],
      };
    }
  }

  // 특정 컬럼 매핑 요청
  const mapMatch = message.match(/["']([^"']+)["'].*(?:을|를|컬럼).*["']([^"']+)["'].*(?:매핑|매칭|연결)/);
  if (mapMatch) {
    const [, templateCol, dataCol] = mapMatch;

    const templateExists = templateColumns.some(c => c.toLowerCase().includes(templateCol.toLowerCase()));
    const dataExists = dataColumns.some(c => c.toLowerCase().includes(dataCol.toLowerCase()));

    if (templateExists && dataExists) {
      const actualTemplate = templateColumns.find(c => c.toLowerCase().includes(templateCol.toLowerCase()))!;
      const actualData = dataColumns.find(c => c.toLowerCase().includes(dataCol.toLowerCase()))!;

      actions.push({
        type: 'map',
        templateColumn: actualTemplate,
        dataColumn: actualData,
        message: `"${actualTemplate}"을 "${actualData}"에 매핑합니다.`,
      });

      return {
        message: `"${actualTemplate}" 컬럼을 "${actualData}" 데이터에 매핑했습니다.`,
        actions,
      };
    } else {
      return {
        message: `죄송합니다. "${templateCol}" 또는 "${dataCol}" 컬럼을 찾을 수 없습니다.`,
        actions: [{ type: 'info', message: '컬럼을 찾을 수 없음' }],
      };
    }
  }

  // 매핑 해제 요청
  if (message.includes('해제') || message.includes('삭제') || message.includes('제거')) {
    const colMatch = message.match(/["']([^"']+)["']/);
    if (colMatch) {
      const colName = colMatch[1];
      const found = mappings.find(m =>
        m.templateColumn.toLowerCase().includes(colName.toLowerCase()) ||
        m.dataColumn?.toLowerCase().includes(colName.toLowerCase())
      );

      if (found) {
        actions.push({
          type: 'unmap',
          templateColumn: found.templateColumn,
          dataColumn: null,
          message: `"${found.templateColumn}" 매핑을 해제합니다.`,
        });

        return {
          message: `"${found.templateColumn}" 컬럼의 매핑을 해제했습니다.`,
          actions,
        };
      }
    }
  }

  // 다운로드/확정 요청
  if (message.includes('다운로드') || message.includes('확정') || message.includes('완료')) {
    const matchedCount = mappings.filter(m => m.dataColumn !== null).length;
    const unmatchedCount = mappings.filter(m => m.status === 'unmatched').length;

    actions.push({
      type: 'confirm',
      message: '다운로드를 진행합니다.',
    });

    return {
      message: `현재 ${matchedCount}개 컬럼이 매핑되어 있고, ${unmatchedCount}개가 미매핑 상태입니다.\n다운로드를 진행하시겠습니까?`,
      actions,
    };
  }

  // 현재 상태 확인
  if (message.includes('상태') || message.includes('현재') || message.includes('어떻게')) {
    const matchedCount = mappings.filter(m => m.dataColumn !== null).length;
    const unmatchedCount = mappings.filter(m => m.status === 'unmatched').length;
    const unmatchedCols = mappings.filter(m => m.status === 'unmatched').map(m => m.templateColumn);

    return {
      message: `📊 **현재 매핑 상태**\n\n` +
        `✅ 매핑 완료: ${matchedCount}개\n` +
        `❌ 미매핑: ${unmatchedCount}개\n\n` +
        (unmatchedCols.length > 0
          ? `미매핑 컬럼:\n${unmatchedCols.slice(0, 5).map(c => `• ${c}`).join('\n')}` +
            (unmatchedCols.length > 5 ? `\n... 외 ${unmatchedCols.length - 5}개` : '')
          : '모든 컬럼이 매핑되었습니다!'),
      actions: [{ type: 'info', message: '상태 확인' }],
    };
  }

  // 기본 응답
  return {
    message: '요청을 이해하지 못했습니다. 다음과 같이 말씀해주세요:\n\n' +
      '• "자동으로 매칭해줘"\n' +
      '• "\'이름\' 컬럼을 \'name\'에 매핑해줘"\n' +
      '• "\'이름\' 매핑 해제해줘"\n' +
      '• "현재 상태 알려줘"\n' +
      '• "다운로드해줘"',
    actions: [{ type: 'info', message: '도움말' }],
  };
}
