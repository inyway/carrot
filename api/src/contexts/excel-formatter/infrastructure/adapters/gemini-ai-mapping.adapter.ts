import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiMappingPort } from '../../application/ports';
import { ColumnMappingVO } from '../../domain/value-objects';

@Injectable()
export class GeminiAiMappingAdapter implements AiMappingPort {
  private readonly apiKey: string | undefined;
  private readonly apiUrl =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!this.apiKey) {
      console.warn('GEMINI_API_KEY is not set');
    }
  }

  async generateMappings(
    templateColumns: string[],
    dataColumns: string[],
    command?: string,
  ): Promise<ColumnMappingVO[]> {
    if (!this.apiKey) {
      throw new HttpException(
        'GEMINI_API_KEY is not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const prompt = this.buildPrompt(templateColumns, dataColumns, command);

    try {
      const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new HttpException(
          `Gemini API error: ${response.status} - ${errorText}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      const data = await response.json();
      const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) {
        throw new HttpException('No response from Gemini', HttpStatus.BAD_GATEWAY);
      }

      return this.parseResponse(textContent);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to call Gemini API: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private buildPrompt(
    templateColumns: string[],
    dataColumns: string[],
    command?: string,
  ): string {
    return `당신은 엑셀 데이터 매핑 전문가입니다.
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
}`;
  }

  private parseResponse(textContent: string): ColumnMappingVO[] {
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new HttpException(
        'Could not parse JSON from Gemini response',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const mappings = parsed.mappings || [];

      return mappings.map(
        (m: {
          templateColumn: string;
          dataColumn: string | null;
          confidence: number;
          reason: string;
        }) =>
          ColumnMappingVO.create({
            templateColumn: m.templateColumn,
            dataColumn: m.dataColumn,
            confidence: m.confidence,
            reason: m.reason,
          }),
      );
    } catch {
      throw new HttpException(
        'Invalid JSON in Gemini response',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
