import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiMappingPort } from '../../application/ports';
import { ColumnMappingVO } from '../../domain/value-objects';
import type { HwpxTableInfo, HwpxCellInfo, CellMapping } from './hwpx-parser.adapter';

export interface HwpxMappingResult {
  mappings: CellMapping[];
  validationIssues: string[];
}

@Injectable()
export class GeminiAiMappingAdapter implements AiMappingPort {
  private readonly apiKey: string | undefined;
  private readonly apiUrl =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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

  /**
   * HWPX 테이블 셀과 Excel 컬럼 간 AI 매핑 생성
   * LangGraph 스타일: Generate -> Validate -> Correct
   */
  async generateHwpxMappings(
    table: HwpxTableInfo,
    excelColumns: string[],
  ): Promise<HwpxMappingResult> {
    if (!this.apiKey) {
      throw new HttpException(
        'GEMINI_API_KEY is not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Step 1: Generate - AI로 초기 매핑 생성
    const initialMappings = await this.generateInitialHwpxMappings(table, excelColumns);

    // Step 2: Validate - 매핑 유효성 검증
    const validationResult = this.validateHwpxMappings(initialMappings, table, excelColumns);

    // Step 3: Correct - 문제가 있으면 수정 요청
    if (validationResult.issues.length > 0) {
      const correctedMappings = await this.correctHwpxMappings(
        initialMappings,
        validationResult.issues,
        table,
        excelColumns,
      );
      return {
        mappings: correctedMappings,
        validationIssues: [],
      };
    }

    return {
      mappings: initialMappings,
      validationIssues: [],
    };
  }

  /**
   * Step 1: Generate - 초기 HWPX 매핑 생성
   */
  private async generateInitialHwpxMappings(
    table: HwpxTableInfo,
    excelColumns: string[],
  ): Promise<CellMapping[]> {
    console.log('[GeminiAdapter] Generating initial HWPX mappings...');
    console.log('[GeminiAdapter] Table info:', { rowCount: table.rowCount, colCount: table.colCount, cellCount: table.cells.length });
    console.log('[GeminiAdapter] Excel columns:', excelColumns);

    // 테이블 구조를 텍스트로 변환
    const tableDescription = this.buildTableDescription(table);
    console.log('[GeminiAdapter] Table description length:', tableDescription.length);

    const prompt = `당신은 HWPX(한글 문서) 템플릿과 Excel 데이터를 매핑하는 전문가입니다.

## 중요: 셀 구분 규칙
- **[라벨]** 표시가 있는 셀 = 색칠된 셀 = 필드명(예: "성명", "생년월일")
- **[라벨]** 표시가 없는 셀 = 색칠 안 된 셀 = 데이터가 들어갈 placeholder

## 매핑 방법
1. 먼저 [라벨] 표시가 있는 셀에서 필드명을 찾습니다.
2. 그 라벨 셀의 **오른쪽** 또는 **아래**에 있는 **[라벨] 표시가 없는 셀**을 데이터 셀로 지정합니다.
3. Excel 컬럼 중 라벨과 의미가 같은 것을 찾아 매핑합니다.

## 무시해야 할 셀
- "1. 신상정보", "2. 해외취업" 같은 섹션 제목 (숫자로 시작)
- "개인이력카드" 같은 문서 제목
- 빈 셀

## HWPX 테이블 구조
${tableDescription}

## Excel 컬럼 목록
${excelColumns.map((c, i) => `${i + 1}. "${c}"`).join('\n')}

## 매핑 예시
Excel "성명" → 테이블에서 "성명" [라벨] 찾기 → 그 오른쪽의 [라벨]이 없는 셀 좌표를 hwpxRow, hwpxCol에 지정

반드시 아래 JSON 형식으로만 응답하세요:
{
  "mappings": [
    {
      "excelColumn": "Excel 컬럼명",
      "hwpxRow": 데이터가_들어갈_행_인덱스(0부터),
      "hwpxCol": 데이터가_들어갈_열_인덱스(0부터),
      "labelText": "매핑_기준이_된_라벨_텍스트",
      "reason": "매핑 이유"
    }
  ]
}`;

    try {
      console.log('[GeminiAdapter] Calling Gemini API...');
      const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 4096,
          },
        }),
      });

      console.log('[GeminiAdapter] Gemini response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GeminiAdapter] Gemini API error response:', errorText);
        throw new HttpException(`Gemini API error: ${response.status} - ${errorText}`, HttpStatus.BAD_GATEWAY);
      }

      const data = await response.json();
      console.log('[GeminiAdapter] Gemini response data candidates:', data.candidates?.length || 0);
      const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) {
        console.error('[GeminiAdapter] No text content in Gemini response:', JSON.stringify(data));
        throw new HttpException('No response from Gemini', HttpStatus.BAD_GATEWAY);
      }

      console.log('[GeminiAdapter] Gemini text response length:', textContent.length);
      console.log('[GeminiAdapter] Gemini text response preview:', textContent.substring(0, 500));

      const mappings = this.parseHwpxMappingResponse(textContent);
      console.log('[GeminiAdapter] Parsed mappings count:', mappings.length);
      return mappings;
    } catch (error) {
      console.error('[GeminiAdapter] Error in generateInitialHwpxMappings:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(`Failed to call Gemini API: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Step 2: Validate - 매핑 유효성 검증
   */
  private validateHwpxMappings(
    mappings: CellMapping[],
    table: HwpxTableInfo,
    excelColumns: string[],
  ): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // 중복 셀 매핑 검사
    const cellKeys = new Set<string>();
    for (const mapping of mappings) {
      const key = `${mapping.hwpxRow}-${mapping.hwpxCol}`;
      if (cellKeys.has(key)) {
        issues.push(`중복 매핑: 셀(${mapping.hwpxRow}, ${mapping.hwpxCol})에 여러 컬럼이 매핑됨`);
      }
      cellKeys.add(key);
    }

    // 범위 초과 검사
    for (const mapping of mappings) {
      if (mapping.hwpxRow < 0 || mapping.hwpxRow >= table.rowCount) {
        issues.push(`범위 초과: 행 ${mapping.hwpxRow}는 테이블 범위(0-${table.rowCount - 1})를 벗어남`);
      }
      if (mapping.hwpxCol < 0 || mapping.hwpxCol >= table.colCount) {
        issues.push(`범위 초과: 열 ${mapping.hwpxCol}는 테이블 범위(0-${table.colCount - 1})를 벗어남`);
      }
    }

    // Excel 컬럼 존재 여부 검사
    for (const mapping of mappings) {
      if (!excelColumns.includes(mapping.excelColumn)) {
        issues.push(`존재하지 않는 Excel 컬럼: "${mapping.excelColumn}"`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Step 3: Correct - 문제가 있는 매핑 수정
   */
  private async correctHwpxMappings(
    originalMappings: CellMapping[],
    issues: string[],
    table: HwpxTableInfo,
    excelColumns: string[],
  ): Promise<CellMapping[]> {
    const tableDescription = this.buildTableDescription(table);

    const prompt = `이전에 생성한 HWPX 매핑에 문제가 발견되었습니다. 수정해주세요.

## 기존 매핑
${JSON.stringify(originalMappings, null, 2)}

## 발견된 문제
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

## HWPX 테이블 구조
${tableDescription}

## Excel 컬럼 목록
${excelColumns.map((c, i) => `${i + 1}. "${c}"`).join('\n')}

문제를 수정한 매핑을 JSON 형식으로 응답하세요:
{
  "mappings": [
    {
      "excelColumn": "Excel 컬럼명",
      "hwpxRow": 행_인덱스,
      "hwpxCol": 열_인덱스
    }
  ]
}`;

    try {
      const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 4096,
          },
        }),
      });

      if (!response.ok) {
        // 수정 실패 시 원본 반환
        console.warn('Failed to correct mappings, returning original');
        return originalMappings;
      }

      const data = await response.json();
      const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) {
        return originalMappings;
      }

      return this.parseHwpxMappingResponse(textContent);
    } catch {
      return originalMappings;
    }
  }

  /**
   * 테이블 구조를 설명 텍스트로 변환
   * [라벨] = 색칠된 셀 (필드명)
   * [라벨] 없음 = 색칠 안 된 셀 (데이터 placeholder)
   */
  private buildTableDescription(table: HwpxTableInfo): string {
    const lines: string[] = [];
    lines.push(`테이블 크기: ${table.rowCount}행 x ${table.colCount}열`);
    lines.push('');
    lines.push('셀 내용 형식: (행, 열): "텍스트" [라벨] 또는 (행, 열): "텍스트"');
    lines.push('[라벨] = 색칠된 셀(필드명), [라벨] 없음 = 데이터 들어갈 빈 셀');
    lines.push('');

    // 셀을 행별로 그룹화
    const rowMap = new Map<number, HwpxCellInfo[]>();
    for (const cell of table.cells) {
      if (!rowMap.has(cell.rowIndex)) {
        rowMap.set(cell.rowIndex, []);
      }
      rowMap.get(cell.rowIndex)!.push(cell);
    }

    // 정렬된 행 순서로 출력 (최대 30행)
    const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b).slice(0, 30);
    for (const rowIdx of sortedRows) {
      const cells = rowMap.get(rowIdx)!.sort((a, b) => a.colIndex - b.colIndex);
      for (const cell of cells) {
        const text = cell.text?.trim() || '(빈 셀)';
        // [라벨] 표시 = 색칠된 셀 = 필드명
        // 표시 없음 = 색칠 안 된 셀 = 데이터 placeholder
        const labelMark = cell.isHeader ? ' [라벨]' : '';
        const spanInfo = (cell.colSpan > 1 || cell.rowSpan > 1)
          ? ` [colspan=${cell.colSpan}, rowspan=${cell.rowSpan}]`
          : '';
        lines.push(`  (${cell.rowIndex}, ${cell.colIndex}): "${text}"${labelMark}${spanInfo}`);
      }
    }

    if (table.rowCount > 30) {
      lines.push(`  ... (${table.rowCount - 30}개 행 생략)`);
    }

    return lines.join('\n');
  }

  /**
   * HWPX 매핑 응답 파싱
   */
  private parseHwpxMappingResponse(textContent: string): CellMapping[] {
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new HttpException('Could not parse JSON from Gemini response', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const mappings = parsed.mappings || [];

      return mappings.map((m: { excelColumn: string; hwpxRow: number; hwpxCol: number }) => ({
        excelColumn: m.excelColumn,
        hwpxRow: Number(m.hwpxRow),
        hwpxCol: Number(m.hwpxCol),
      }));
    } catch {
      throw new HttpException('Invalid JSON in Gemini response', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
