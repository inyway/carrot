import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HwpxParserAdapter,
  type HwpxTableInfo,
  type HwpxCellInfo,
  type CellMapping,
} from '../../infrastructure/adapters/hwpx-parser.adapter';
import { EXCEL_PARSER_PORT, type ExcelParserPort } from '../ports';

/**
 * 매핑 후보 인터페이스
 */
interface MappingCandidate {
  excelColumn: string;
  hwpxRow: number;
  hwpxCol: number;
  labelText: string;
  confidence: number;
  source: 'rule' | 'ai_template' | 'ai_excel';
  reason: string;
}

/**
 * 검증 제안 인터페이스
 */
interface MappingSuggestion {
  excelColumn: string;
  hwpxRow: number;
  hwpxCol: number;
  labelText: string;
  reason: string;
}

/**
 * 검증 결과 인터페이스
 */
interface ValidationResult {
  isValid: boolean;
  totalFields: number;
  mappedFields: number;
  missingFields: number;
  issues: Array<{
    type: 'missing' | 'warning' | 'info';
    field: string;
    message: string;
    hwpxRow?: number;
    hwpxCol?: number;
    suggestedExcelColumn?: string;
  }>;
  suggestions: MappingSuggestion[];
}

/**
 * 도메인 컨텍스트 인터페이스
 * AI 매핑 시 참고할 도메인 특화 정보
 */
export interface MappingContext {
  // 사용자가 제공한 추가 컨텍스트 설명
  description?: string;

  // 필드 간의 관계 설명 (예: "핵심 세미나 = 전문가 강연 + 해외 경력자 멘토링")
  fieldRelations?: Array<{
    targetField: string;           // HWPX 템플릿의 필드명
    sourceFields: string[];        // Excel에서 매핑할 컬럼들
    mergeStrategy?: 'concat' | 'first' | 'all';  // 병합 전략
    description?: string;          // 관계 설명
  }>;

  // 동의어/대체 용어 매핑
  synonyms?: Record<string, string[]>;  // 예: { "핵심 세미나": ["전문가 강연", "해외 경력자 멘토링"] }

  // 특수 매핑 규칙
  specialRules?: Array<{
    condition: string;             // 조건 설명
    action: string;                // 수행할 작업
  }>;
}

/**
 * 노드 상태 인터페이스
 */
interface GraphState {
  // 입력
  hwpxTable: HwpxTableInfo;
  excelColumns: string[];

  // 도메인 컨텍스트
  context?: MappingContext;

  // 각 노드의 출력
  ruleMappings: MappingCandidate[];
  aiTemplateMappings: MappingCandidate[];
  aiExcelMappings: MappingCandidate[];

  // 최종 결과
  mergedCandidates: MappingCandidate[];
  finalMappings: CellMapping[];
  validationIssues: string[];

  // 검증 결과
  validationResult: ValidationResult | null;
}

/**
 * LangGraph 스타일 병렬 매핑 파이프라인
 *
 * 노드 구성:
 * 1. Rule-based: 라벨 셀 → 데이터 셀 위치 추론 (동기)
 * 2. AI Template: HWPX 구조 이해 (비동기)
 * 3. AI Excel: 컬럼 의미 분석 (비동기)
 * 4. Merge: 후보 병합 및 충돌 해결
 * 5. Finalize: 최종 매핑 확정
 */
@Injectable()
export class HwpxMappingGraphService {
  private readonly apiKey: string | undefined;
  private readonly apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  constructor(
    private readonly hwpxParser: HwpxParserAdapter,
    private readonly configService: ConfigService,
    @Inject(EXCEL_PARSER_PORT)
    private readonly excelParser: ExcelParserPort,
  ) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY');
  }

  /**
   * 메인 실행 함수 - 그래프 실행
   * @param templateBuffer HWPX 템플릿 버퍼
   * @param dataBuffer Excel 데이터 버퍼
   * @param sheetName 시트 이름
   * @param context 도메인 컨텍스트 (선택)
   */
  async execute(
    templateBuffer: Buffer,
    dataBuffer: Buffer,
    sheetName: string,
    context?: MappingContext,
  ): Promise<{
    mappings: CellMapping[];
    validationIssues: string[];
    validationResult: ValidationResult;
  }> {
    console.log('[MappingGraph] Starting parallel mapping pipeline...');
    if (context) {
      console.log('[MappingGraph] Context provided:', JSON.stringify(context, null, 2));
    }

    // HWPX 분석
    const template = await this.hwpxParser.analyzeTemplate(templateBuffer, 'template.hwpx');
    if (template.tables.length === 0) {
      throw new Error('HWPX 파일에 테이블이 없습니다.');
    }

    // Excel 컬럼 추출 (스마트 헤더 감지)
    const excelColumns = await this.extractSmartColumns(dataBuffer, sheetName);

    if (excelColumns.length === 0) {
      throw new Error('Excel 파일에 컬럼이 없습니다.');
    }

    // 초기 상태
    const state: GraphState = {
      hwpxTable: template.tables[0],
      excelColumns,
      context,  // 도메인 컨텍스트 추가
      ruleMappings: [],
      aiTemplateMappings: [],
      aiExcelMappings: [],
      mergedCandidates: [],
      finalMappings: [],
      validationIssues: [],
      validationResult: null,
    };

    console.log('[MappingGraph] Table:', state.hwpxTable.rowCount, 'rows x', state.hwpxTable.colCount, 'cols');
    console.log('[MappingGraph] Excel columns:', excelColumns.length);

    // Step 1: 병렬 노드 실행 (Node 1, 2, 3)
    console.log('[MappingGraph] Running parallel nodes...');
    const [ruleResult, aiTemplateResult, aiExcelResult] = await Promise.allSettled([
      this.nodeRuleBased(state),
      this.nodeAiTemplate(state),
      this.nodeAiExcel(state),
    ]);

    // 결과 수집
    if (ruleResult.status === 'fulfilled') {
      state.ruleMappings = ruleResult.value;
      console.log('[MappingGraph] Rule-based mappings:', state.ruleMappings.length);
    } else {
      console.error('[MappingGraph] Rule-based node failed:', ruleResult.reason);
    }

    if (aiTemplateResult.status === 'fulfilled') {
      state.aiTemplateMappings = aiTemplateResult.value;
      console.log('[MappingGraph] AI template mappings:', state.aiTemplateMappings.length);
    } else {
      console.error('[MappingGraph] AI template node failed:', aiTemplateResult.reason);
    }

    if (aiExcelResult.status === 'fulfilled') {
      state.aiExcelMappings = aiExcelResult.value;
      console.log('[MappingGraph] AI Excel mappings:', state.aiExcelMappings.length);
    } else {
      console.error('[MappingGraph] AI Excel node failed:', aiExcelResult.reason);
    }

    // Step 2: 병합 노드 (Node 4)
    console.log('[MappingGraph] Running merge node...');
    state.mergedCandidates = this.nodeMerge(state);
    console.log('[MappingGraph] Merged candidates:', state.mergedCandidates.length);

    // Step 3: 최종 확정 노드 (Node 5)
    console.log('[MappingGraph] Running finalize node...');
    const { mappings, issues } = this.nodeFinalize(state);
    state.finalMappings = mappings;
    state.validationIssues = issues;

    console.log('[MappingGraph] Final mappings:', state.finalMappings.length);
    console.log('[MappingGraph] Validation issues:', state.validationIssues.length);

    // Step 4: 검증 노드 (Node 6) - 누락된 필수 필드 검사 및 제안 생성
    console.log('[MappingGraph] Running validation node...');
    state.validationResult = this.nodeValidate(state);
    console.log('[MappingGraph] Validation result:', {
      isValid: state.validationResult.isValid,
      mappedFields: state.validationResult.mappedFields,
      missingFields: state.validationResult.missingFields,
      suggestions: state.validationResult.suggestions.length,
    });

    return {
      mappings: state.finalMappings,
      validationIssues: state.validationIssues,
      validationResult: state.validationResult,
    };
  }

  /**
   * Node 1: 규칙 기반 매핑
   * - 라벨 셀(isHeader=true) 찾기
   * - 라벨의 오른쪽/아래에서 데이터 셀(isHeader=false) 찾기
   * - Excel 컬럼과 라벨 텍스트 매칭
   */
  private async nodeRuleBased(state: GraphState): Promise<MappingCandidate[]> {
    console.log('[Node1:Rule] Starting rule-based mapping...');
    const candidates: MappingCandidate[] = [];
    const { hwpxTable, excelColumns } = state;

    // 셀 맵 생성
    const cellMap = new Map<string, HwpxCellInfo>();
    for (const cell of hwpxTable.cells) {
      cellMap.set(`${cell.rowIndex}-${cell.colIndex}`, cell);
    }

    // 정규화 함수
    const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase();

    // 섹션/제목 필터 (라벨 셀 판별용)
    // 참고: 데이터 값(이메일, 전화번호 등)은 길이 제한에서 제외
    const isSectionOrTitle = (text: string) => {
      const trimmed = text.trim();
      // 섹션 제목 패턴: "1. 신상정보" 등
      if (/^\d+\./.test(trimmed)) return true;
      // 문서 제목
      if (trimmed === '개인이력카드') return true;
      // 데이터 값 패턴 (이메일, 전화번호, 날짜)은 제외
      if (/@/.test(trimmed)) return false;  // 이메일
      if (/^\d{10,}$/.test(trimmed.replace(/[-\s]/g, ''))) return false;  // 전화번호
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;  // 날짜
      // 너무 긴 텍스트는 섹션/제목으로 간주 (데이터가 아님)
      return trimmed.length > 20;
    };

    // 라벨 셀 필터링 (isHeader 또는 텍스트가 있는 셀 중 필드명처럼 보이는 것)
    const labelCells = hwpxTable.cells.filter(cell => {
      const text = cell.text?.trim() || '';
      if (text.length < 2) return false;
      if (isSectionOrTitle(text)) return false;
      // isHeader=true이거나, 짧은 텍스트(필드명처럼 보임)
      return cell.isHeader || (text.length >= 2 && text.length <= 15);
    });

    console.log('[Node1:Rule] Found', labelCells.length, 'label cells');
    console.log('[Node1:Rule] Label cells (first 20):', labelCells.slice(0, 20).map(c => `[${c.rowIndex},${c.colIndex}]"${c.text}"(span=${c.colSpan})`).join(', '));

    // 사용된 Excel 컬럼 추적
    const usedExcelCols = new Set<string>();
    const usedCellKeys = new Set<string>();

    // 알려진 라벨 패턴 (데이터 셀이 아닌 것)
    const knownLabelPatterns = [
      '성명', '성 명', '생년월일', '성별', '성 별', '연락처', '이메일', '거주지',
      '참여분야', '수행기관', '사업명', '참여기간', '국가', '직무',
      '희망직종', '희망직무', '구 분', '구분',
      '취업여부', '취업처', '취 업 처', '담당직무',
      '핵심 세미나', '전문가 컨설팅', '실전 모의면접',
      '1회', '2회', '3회', '4회', '5회', '6회', '7회',
      '1분기', '2분기', '3분기', '4분기',
      '해외취업', '사전참여여부',
    ];

    const isLabelPattern = (text: string): boolean => {
      const trimmed = text.trim();
      const normalized = trimmed.replace(/\s+/g, '');
      return knownLabelPatterns.some(pattern =>
        trimmed === pattern || normalized === pattern.replace(/\s+/g, '')
      );
    };

    // 데이터 셀 찾기 헬퍼 함수 (더 유연하게 검색)
    // 핵심: isHeader=false인 셀이 데이터 셀 (hwpx-parser에서 borderFillIDRef=10으로 판별)
    const findDataCell = (labelCell: HwpxCellInfo): HwpxCellInfo | null => {
      const labelText = labelCell.text?.trim() || '';

      // 디버깅: 연락처, 이메일 등 문제가 있는 라벨
      const isDebugLabel = ['연락처', '이메일', '성명', '생년월일', '성별', '거주지'].some(l => labelText.includes(l));

      // 1. 오른쪽 셀 (colSpan 고려) - isHeader=false인 셀 찾기
      const startCol = labelCell.colIndex + (labelCell.colSpan || 1);

      if (isDebugLabel) {
        console.log(`[findDataCell:DEBUG] Processing "${labelText}" at [${labelCell.rowIndex},${labelCell.colIndex}], colSpan=${labelCell.colSpan}, startCol=${startCol}`);
        // 해당 행의 모든 셀 출력
        const rowCells: string[] = [];
        for (let c = 0; c < 16; c++) {
          const cell = cellMap.get(`${labelCell.rowIndex}-${c}`);
          if (cell) {
            rowCells.push(`[${c}]"${cell.text?.substring(0, 10) || ''}"(h=${cell.isHeader})`);
          }
        }
        console.log(`[findDataCell:DEBUG] Row ${labelCell.rowIndex} cells:`, rowCells.join(', '));
      }

      // 오른쪽 방향 탐색: isHeader=false인 셀 우선 찾기
      for (let col = startCol; col <= startCol + 8; col++) {
        const rightCell = cellMap.get(`${labelCell.rowIndex}-${col}`);
        if (rightCell) {
          const rightText = rightCell.text?.trim() || '';

          // **핵심 수정**: isHeader=false인 셀은 데이터 셀로 확정 (hwpx-parser에서 borderFillIDRef=10)
          // 섹션 제목이 아닌지만 추가 확인
          const isNotSectionTitle = !isSectionOrTitle(rightText);

          if (isDebugLabel) {
            console.log(`[findDataCell:DEBUG] Checking [${labelCell.rowIndex},${col}]: text="${rightText}", isHeader=${rightCell.isHeader}`);
          }

          // isHeader=false면 데이터 셀로 확정
          if (!rightCell.isHeader && isNotSectionTitle) {
            console.log(`[findDataCell] "${labelText}" → found DATA cell at [${labelCell.rowIndex},${col}] = "${rightText}" (isHeader=false)`);
            return rightCell;
          }

          // 라벨 셀이면 계속 오른쪽으로 탐색
          if (rightCell.isHeader) {
            if (isDebugLabel) {
              console.log(`[findDataCell:DEBUG] "${labelText}" → skip LABEL cell at [${labelCell.rowIndex},${col}] = "${rightText}"`);
            }
            continue;
          }
        }
      }

      // 2. 아래 셀 (rowSpan 고려) - isHeader=false인 셀 찾기
      const startRow = labelCell.rowIndex + (labelCell.rowSpan || 1);
      for (let row = startRow; row <= startRow + 2; row++) {
        const belowCell = cellMap.get(`${row}-${labelCell.colIndex}`);
        if (belowCell) {
          const belowText = belowCell.text?.trim() || '';
          const isNotSectionTitle = !isSectionOrTitle(belowText);

          // isHeader=false면 데이터 셀
          if (!belowCell.isHeader && isNotSectionTitle) {
            console.log(`[findDataCell] "${labelText}" → found DATA cell BELOW at [${row},${labelCell.colIndex}] = "${belowText}"`);
            return belowCell;
          }
        }
      }

      console.log(`[findDataCell] "${labelText}" → NO DATA CELL FOUND (startCol=${startCol}, startRow=${startRow})`);
      return null;
    };

    // 분기별 취업현황 특수 매핑 규칙
    // HWPX 구조: Row 17 = 헤더(2분기/3분기/4분기), Row 18-20 = 데이터
    // Excel 컬럼: "N분기_취업여부", "N분기_취업처", "N분기_담당직무"
    const quarterMappingRules: Array<{
      pattern: RegExp;
      field: string;
      quarter: string;
      hwpxRow: number;
      hwpxCol: number;
    }> = [
      // 취업여부 (Row 18)
      { pattern: /^2분기[_\s]?취업여부$/, field: '취업여부', quarter: '2분기', hwpxRow: 18, hwpxCol: 2 },
      { pattern: /^3분기[_\s]?취업여부$/, field: '취업여부', quarter: '3분기', hwpxRow: 18, hwpxCol: 6 },
      { pattern: /^4분기[_\s]?취업여부$/, field: '취업여부', quarter: '4분기', hwpxRow: 18, hwpxCol: 11 },
      // 취업처 (Row 19)
      { pattern: /^2분기[_\s]?취업처$/, field: '취업처', quarter: '2분기', hwpxRow: 19, hwpxCol: 2 },
      { pattern: /^3분기[_\s]?취업처$/, field: '취업처', quarter: '3분기', hwpxRow: 19, hwpxCol: 6 },
      { pattern: /^4분기[_\s]?취업처$/, field: '취업처', quarter: '4분기', hwpxRow: 19, hwpxCol: 11 },
      // 담당직무 (Row 20)
      { pattern: /^2분기[_\s]?담당직무$/, field: '담당직무', quarter: '2분기', hwpxRow: 20, hwpxCol: 2 },
      { pattern: /^3분기[_\s]?담당직무$/, field: '담당직무', quarter: '3분기', hwpxRow: 20, hwpxCol: 6 },
      { pattern: /^4분기[_\s]?담당직무$/, field: '담당직무', quarter: '4분기', hwpxRow: 20, hwpxCol: 11 },
      // 근무형태 - Excel에만 있는 필드 (3분기, 4분기)
      // 참고: HWPX에는 근무형태 셀이 없을 수 있음. 필요시 담당직무 행 아래에 매핑
    ];

    // 분기별 매핑 먼저 처리
    for (const excelCol of excelColumns) {
      if (usedExcelCols.has(excelCol)) continue;

      for (const rule of quarterMappingRules) {
        if (rule.pattern.test(excelCol)) {
          const cellKey = `${rule.hwpxRow}-${rule.hwpxCol}`;
          if (!usedCellKeys.has(cellKey)) {
            candidates.push({
              excelColumn: excelCol,
              hwpxRow: rule.hwpxRow,
              hwpxCol: rule.hwpxCol,
              labelText: `${rule.quarter} ${rule.field}`,
              confidence: 0.98,
              source: 'rule',
              reason: `분기별 매핑: "${excelCol}" → [${rule.hwpxRow},${rule.hwpxCol}]`,
            });
            console.log(`[Node1:Rule] ✓ Quarter Matched: "${excelCol}" → [${rule.hwpxRow},${rule.hwpxCol}]`);
            usedExcelCols.add(excelCol);
            usedCellKeys.add(cellKey);
          }
          break;
        }
      }
    }

    // 각 Excel 컬럼에 대해 매칭 시도
    for (const excelCol of excelColumns) {
      const normalizedExcel = normalize(excelCol);
      if (normalizedExcel.length < 2 || usedExcelCols.has(excelCol)) continue;

      for (const labelCell of labelCells) {
        const normalizedLabel = normalize(labelCell.text || '');

        // 매칭 조건 (더 정밀하게)
        const exactMatch = normalizedLabel === normalizedExcel;
        const partialMatch =
          (normalizedLabel.length >= 2 && normalizedExcel.includes(normalizedLabel)) ||
          (normalizedExcel.length >= 2 && normalizedLabel.includes(normalizedExcel));

        const isMatch = exactMatch || partialMatch;

        if (!isMatch) continue;

        console.log(`[Node1:Rule] Trying to match Excel "${excelCol}" with label "${labelCell.text}" at [${labelCell.rowIndex},${labelCell.colIndex}]`);

        // 데이터 셀 찾기
        const dataCell = findDataCell(labelCell);

        if (dataCell) {
          const cellKey = `${dataCell.rowIndex}-${dataCell.colIndex}`;
          if (!usedCellKeys.has(cellKey)) {
            const confidence = exactMatch ? 0.95 : 0.85;
            candidates.push({
              excelColumn: excelCol,
              hwpxRow: dataCell.rowIndex,
              hwpxCol: dataCell.colIndex,
              labelText: labelCell.text || '',
              confidence,
              source: 'rule',
              reason: `라벨 "${labelCell.text}" → 데이터 셀 [${dataCell.rowIndex},${dataCell.colIndex}]`,
            });
            console.log(`[Node1:Rule] ✓ Matched: "${excelCol}" → "${labelCell.text}" at [${dataCell.rowIndex},${dataCell.colIndex}]`);
            usedExcelCols.add(excelCol);
            usedCellKeys.add(cellKey);
            break;
          }
        }
      }
    }

    console.log('[Node1:Rule] Generated', candidates.length, 'candidates');
    return candidates;
  }

  /**
   * Node 2: AI 템플릿 분석
   * - HWPX 테이블 구조를 이해
   * - 어떤 셀이 데이터 플레이스홀더인지 파악
   */
  private async nodeAiTemplate(state: GraphState): Promise<MappingCandidate[]> {
    if (!this.apiKey) {
      console.log('[Node2:AITemplate] No API key, skipping');
      return [];
    }

    console.log('[Node2:AITemplate] Analyzing template structure...');

    // 테이블 구조 설명 생성
    const tableDesc = this.buildTableDescription(state.hwpxTable);

    const prompt = `HWPX 문서 템플릿의 표 구조를 분석합니다.

## 표 구조
${tableDesc}

## 분석 규칙
- [라벨] = 색칠된 셀 = 필드명 (예: "성명", "연락처")
- [라벨] 없음 = 데이터가 들어갈 빈 셀

## 작업
각 라벨 옆/아래의 데이터 셀 위치를 찾아주세요.
무시: "1. 신상정보" 같은 섹션 제목, "개인이력카드" 같은 문서 제목

JSON 형식으로 응답:
{
  "dataSlots": [
    {"labelText": "라벨텍스트", "dataRow": 행번호, "dataCol": 열번호, "confidence": 0.9}
  ]
}`;

    try {
      const response = await this.callGemini(prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const slots = parsed.dataSlots || [];

      // Excel 컬럼과 매칭
      const candidates: MappingCandidate[] = [];
      const normalize = (t: string) => t.replace(/\s+/g, '').toLowerCase();

      for (const slot of slots) {
        const normalizedLabel = normalize(slot.labelText || '');

        for (const excelCol of state.excelColumns) {
          const normalizedExcel = normalize(excelCol);

          if (normalizedLabel === normalizedExcel ||
              normalizedLabel.includes(normalizedExcel) ||
              normalizedExcel.includes(normalizedLabel)) {
            candidates.push({
              excelColumn: excelCol,
              hwpxRow: slot.dataRow,
              hwpxCol: slot.dataCol,
              labelText: slot.labelText,
              confidence: slot.confidence || 0.7,
              source: 'ai_template',
              reason: `AI가 "${slot.labelText}" 라벨의 데이터 위치로 판단`,
            });
            break;
          }
        }
      }

      console.log('[Node2:AITemplate] Generated', candidates.length, 'candidates');
      return candidates;
    } catch (error) {
      console.error('[Node2:AITemplate] Error:', error);
      return [];
    }
  }

  /**
   * Node 3: AI Excel 헤더 분석
   * - Excel 컬럼명의 의미 파악
   * - HWPX 라벨과의 시맨틱 매칭
   * - 도메인 컨텍스트를 활용한 정교한 매칭
   */
  private async nodeAiExcel(state: GraphState): Promise<MappingCandidate[]> {
    if (!this.apiKey) {
      console.log('[Node3:AIExcel] No API key, skipping');
      return [];
    }

    console.log('[Node3:AIExcel] Analyzing Excel headers...');

    // HWPX 라벨 목록
    const labels = state.hwpxTable.cells
      .filter(c => c.isHeader && c.text && c.text.trim().length >= 2)
      .map(c => ({ text: c.text!.trim(), row: c.rowIndex, col: c.colIndex }))
      .filter(l => !/^\d+\./.test(l.text) && l.text !== '개인이력카드');

    // 컨텍스트 기반 추가 정보 구성
    let contextSection = '';
    if (state.context) {
      contextSection = '\n## 도메인 컨텍스트 (매핑 시 반드시 참고)\n';

      if (state.context.description) {
        contextSection += `### 설명\n${state.context.description}\n\n`;
      }

      if (state.context.fieldRelations && state.context.fieldRelations.length > 0) {
        contextSection += '### 필드 관계\n';
        for (const relation of state.context.fieldRelations) {
          contextSection += `- "${relation.targetField}" (템플릿 필드) = ${relation.sourceFields.map(s => `"${s}"`).join(' + ')} (Excel 컬럼들)\n`;
          if (relation.description) {
            contextSection += `  설명: ${relation.description}\n`;
          }
          if (relation.mergeStrategy) {
            contextSection += `  병합 전략: ${relation.mergeStrategy === 'concat' ? '연결' : relation.mergeStrategy === 'all' ? '모두 매핑' : '첫번째만'}\n`;
          }
        }
        contextSection += '\n';
      }

      if (state.context.synonyms && Object.keys(state.context.synonyms).length > 0) {
        contextSection += '### 동의어/대체 용어\n';
        for (const [key, values] of Object.entries(state.context.synonyms)) {
          contextSection += `- "${key}" = ${values.map(v => `"${v}"`).join(', ')}\n`;
        }
        contextSection += '\n';
      }

      if (state.context.specialRules && state.context.specialRules.length > 0) {
        contextSection += '### 특수 규칙\n';
        for (const rule of state.context.specialRules) {
          contextSection += `- 조건: ${rule.condition}\n  작업: ${rule.action}\n`;
        }
        contextSection += '\n';
      }
    }

    const prompt = `Excel 컬럼과 HWPX 라벨을 시맨틱 매칭합니다.

## Excel 컬럼
${state.excelColumns.map((c, i) => `${i + 1}. "${c}"`).join('\n')}

## HWPX 라벨
${labels.map((l, i) => `${i + 1}. "${l.text}" (위치: ${l.row}, ${l.col})`).join('\n')}
${contextSection}
## 작업
같은 의미의 Excel 컬럼-HWPX 라벨 쌍을 찾아주세요.
예: "핸드폰" = "연락처", "이름" = "성명"

${state.context?.fieldRelations ? `
중요: 도메인 컨텍스트의 필드 관계를 반드시 우선 적용하세요.
예: 필드 관계에서 "핵심 세미나" = "전문가 강연" + "해외 경력자 멘토링"으로 정의되었다면,
Excel의 "전문가 강연"과 "해외 경력자 멘토링" 컬럼을 모두 HWPX의 "핵심 세미나" 라벨에 매핑해야 합니다.
` : ''}
JSON 형식:
{
  "matches": [
    {"excelColumn": "컬럼명", "labelText": "라벨텍스트", "labelRow": 행, "labelCol": 열, "confidence": 0.8}
  ]
}`;

    try {
      const response = await this.callGemini(prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const matches = parsed.matches || [];

      // 라벨 위치에서 데이터 셀 위치 추론
      const candidates: MappingCandidate[] = [];
      const cellMap = new Map<string, HwpxCellInfo>();
      for (const cell of state.hwpxTable.cells) {
        cellMap.set(`${cell.rowIndex}-${cell.colIndex}`, cell);
      }

      for (const match of matches) {
        // 라벨 셀 찾기
        const labelCell = cellMap.get(`${match.labelRow}-${match.labelCol}`);
        if (!labelCell) continue;

        // 데이터 셀 찾기 (오른쪽)
        const rightCol = match.labelCol + (labelCell.colSpan || 1);
        const rightCell = cellMap.get(`${match.labelRow}-${rightCol}`);

        if (rightCell && !rightCell.isHeader) {
          candidates.push({
            excelColumn: match.excelColumn,
            hwpxRow: rightCell.rowIndex,
            hwpxCol: rightCell.colIndex,
            labelText: match.labelText,
            confidence: match.confidence || 0.7,
            source: 'ai_excel',
            reason: `AI 시맨틱 매칭: "${match.excelColumn}" ≈ "${match.labelText}"`,
          });
        }
      }

      console.log('[Node3:AIExcel] Generated', candidates.length, 'candidates');
      return candidates;
    } catch (error) {
      console.error('[Node3:AIExcel] Error:', error);
      return [];
    }
  }

  /**
   * Node 4: 매핑 후보 병합
   * - 세 노드의 결과 통합
   * - 중복 제거 및 충돌 해결
   */
  private nodeMerge(state: GraphState): MappingCandidate[] {
    console.log('[Node4:Merge] Merging candidates...');
    console.log('[Node4:Merge] Rule mappings:', JSON.stringify(state.ruleMappings, null, 2));
    console.log('[Node4:Merge] AI Template mappings:', JSON.stringify(state.aiTemplateMappings, null, 2));
    console.log('[Node4:Merge] AI Excel mappings:', JSON.stringify(state.aiExcelMappings, null, 2));

    const allCandidates = [
      ...state.ruleMappings,
      ...state.aiTemplateMappings,
      ...state.aiExcelMappings,
    ];

    // 같은 Excel 컬럼에 대한 후보들을 그룹화
    const byExcelColumn = new Map<string, MappingCandidate[]>();
    for (const candidate of allCandidates) {
      const key = candidate.excelColumn;
      if (!byExcelColumn.has(key)) {
        byExcelColumn.set(key, []);
      }
      byExcelColumn.get(key)!.push(candidate);
    }

    // 각 Excel 컬럼에 대해 최적 후보 선택
    const merged: MappingCandidate[] = [];

    for (const [excelColumn, candidates] of byExcelColumn) {
      if (candidates.length === 1) {
        merged.push(candidates[0]);
        continue;
      }

      // 여러 후보가 있는 경우: 투표 + 신뢰도
      const cellVotes = new Map<string, { count: number; totalConfidence: number; best: MappingCandidate }>();

      for (const c of candidates) {
        const key = `${c.hwpxRow}-${c.hwpxCol}`;
        const existing = cellVotes.get(key);

        if (existing) {
          existing.count++;
          existing.totalConfidence += c.confidence;
          if (c.confidence > existing.best.confidence) {
            existing.best = c;
          }
        } else {
          cellVotes.set(key, { count: 1, totalConfidence: c.confidence, best: c });
        }
      }

      // 가장 많은 투표 + 높은 신뢰도
      let bestVote: { count: number; totalConfidence: number; best: MappingCandidate } | null = null;
      for (const vote of cellVotes.values()) {
        if (!bestVote ||
            vote.count > bestVote.count ||
            (vote.count === bestVote.count && vote.totalConfidence > bestVote.totalConfidence)) {
          bestVote = vote;
        }
      }

      if (bestVote) {
        // 신뢰도 보정: 여러 소스에서 동의하면 신뢰도 증가
        const adjustedConfidence = Math.min(1.0, bestVote.best.confidence + (bestVote.count - 1) * 0.1);
        merged.push({
          ...bestVote.best,
          confidence: adjustedConfidence,
          reason: bestVote.count > 1
            ? `${bestVote.count}개 소스 동의: ${bestVote.best.reason}`
            : bestVote.best.reason,
        });
      }
    }

    console.log('[Node4:Merge] Merged to', merged.length, 'candidates');
    return merged;
  }

  /**
   * Node 5: 최종 매핑 확정
   * - 신뢰도 기반 필터링
   * - 셀 중복 검사
   * - 범위 검증
   */
  private nodeFinalize(state: GraphState): { mappings: CellMapping[]; issues: string[] } {
    console.log('[Node5:Finalize] Finalizing mappings...');

    const issues: string[] = [];
    const usedCells = new Set<string>();
    const finalMappings: CellMapping[] = [];

    // 신뢰도 순 정렬
    const sorted = [...state.mergedCandidates].sort((a, b) => b.confidence - a.confidence);

    for (const candidate of sorted) {
      const cellKey = `${candidate.hwpxRow}-${candidate.hwpxCol}`;

      // 중복 셀 검사
      if (usedCells.has(cellKey)) {
        issues.push(`셀 (${candidate.hwpxRow}, ${candidate.hwpxCol})이 이미 사용됨 - "${candidate.excelColumn}" 스킵`);
        continue;
      }

      // 범위 검사
      if (candidate.hwpxRow < 0 || candidate.hwpxRow >= state.hwpxTable.rowCount) {
        issues.push(`행 범위 초과: ${candidate.hwpxRow}`);
        continue;
      }
      if (candidate.hwpxCol < 0 || candidate.hwpxCol >= state.hwpxTable.colCount) {
        issues.push(`열 범위 초과: ${candidate.hwpxCol}`);
        continue;
      }

      // 신뢰도 필터 (0.5 이상)
      if (candidate.confidence < 0.5) {
        issues.push(`낮은 신뢰도 (${candidate.confidence}): "${candidate.excelColumn}"`);
        continue;
      }

      finalMappings.push({
        excelColumn: candidate.excelColumn,
        hwpxRow: candidate.hwpxRow,
        hwpxCol: candidate.hwpxCol,
      });
      usedCells.add(cellKey);
    }

    console.log('[Node5:Finalize] Final mappings:', finalMappings.length);
    return { mappings: finalMappings, issues };
  }

  /**
   * Gemini API 호출 헬퍼
   */
  private async callGemini(prompt: string): Promise<string> {
    const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  /**
   * 테이블 구조 설명 생성
   */
  private buildTableDescription(table: HwpxTableInfo): string {
    const lines: string[] = [];
    lines.push(`크기: ${table.rowCount}행 x ${table.colCount}열\n`);

    const rowMap = new Map<number, HwpxCellInfo[]>();
    for (const cell of table.cells) {
      if (!rowMap.has(cell.rowIndex)) rowMap.set(cell.rowIndex, []);
      rowMap.get(cell.rowIndex)!.push(cell);
    }

    const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b).slice(0, 25);
    for (const rowIdx of sortedRows) {
      const cells = rowMap.get(rowIdx)!.sort((a, b) => a.colIndex - b.colIndex);
      for (const cell of cells) {
        const text = cell.text?.trim() || '(빈셀)';
        const label = cell.isHeader ? ' [라벨]' : '';
        lines.push(`(${cell.rowIndex},${cell.colIndex}): "${text}"${label}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 스마트 Excel 컬럼 추출
   * - 섹션 헤더(예: "1. 신상정보")가 있는 행은 건너뛰고
   * - 실제 필드명(예: "성명", "연락처")이 있는 행을 헤더로 사용
   * - 그룹 헤더(예: "2분기", "3분기")가 있으면 필드명과 조합하여 고유 컬럼명 생성
   */
  private async extractSmartColumns(
    buffer: Buffer,
    sheetName: string,
  ): Promise<string[]> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    // 셀 값 추출 헬퍼 함수
    const getCellText = (cell: { value?: unknown }): string => {
      const value = cell?.value;
      if (value === null || value === undefined) return '';

      const valueObj = value as unknown;
      if (typeof valueObj === 'object' && valueObj !== null && 'richText' in (valueObj as object)) {
        const richTextVal = valueObj as { richText: Array<{ text: string }> };
        return (richTextVal.richText || []).map((t) => t.text).join('').trim();
      } else if (typeof valueObj === 'object' && valueObj !== null && 'result' in (valueObj as object)) {
        const resultVal = valueObj as { result: unknown };
        return String(resultVal.result).trim();
      }
      return String(value).trim();
    };

    // 처음 10행까지 스캔하여 실제 헤더 행 찾기
    const rows: Array<{ rowNum: number; values: string[]; score: number }> = [];

    for (let rowNum = 1; rowNum <= 10; rowNum++) {
      const row = worksheet.getRow(rowNum);
      const values: string[] = [];
      let nonEmptyCount = 0;
      let hasShortLabels = 0;  // 짧은 텍스트(필드명처럼 보이는) 개수
      let hasSectionMarkers = 0;  // "1.", "2." 등 섹션 마커

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const trimmed = getCellText(cell);
        values[colNumber - 1] = trimmed;

        if (trimmed.length > 0) {
          nonEmptyCount++;

          // 짧은 텍스트 (2-10자)는 필드명일 가능성 높음
          if (trimmed.length >= 2 && trimmed.length <= 10) {
            hasShortLabels++;
          }

          // "1.", "2." 등으로 시작하면 섹션 헤더
          if (/^\d+\./.test(trimmed)) {
            hasSectionMarkers++;
          }
        }
      });

      // 스코어 계산: 짧은 라벨이 많고, 섹션 마커가 없으며, 비어있지 않은 셀이 많을수록 높음
      const score = nonEmptyCount * 2 + hasShortLabels * 3 - hasSectionMarkers * 10;

      if (nonEmptyCount >= 3) {  // 최소 3개 이상의 값이 있어야 헤더로 간주
        rows.push({ rowNum, values, score });
      }
    }

    // 가장 높은 점수의 행을 헤더로 선택
    rows.sort((a, b) => b.score - a.score);

    if (rows.length === 0) {
      console.log('[SmartColumns] No suitable header row found, using row 1');
      const data = await this.excelParser.extractSheetData(buffer, sheetName);
      return data.length > 0 ? Object.keys(data[0]) : [];
    }

    const headerRow = rows[0];
    console.log('[SmartColumns] Selected header row:', headerRow.rowNum, 'Score:', headerRow.score);

    // 그룹 헤더 행 (헤더 행 바로 위) 읽기
    const groupHeaderRowNum = headerRow.rowNum - 1;
    const groupHeaders: string[] = [];

    if (groupHeaderRowNum >= 1) {
      const groupRow = worksheet.getRow(groupHeaderRowNum);
      groupRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        groupHeaders[colNumber - 1] = getCellText(cell);
      });
      console.log('[SmartColumns] Group header row:', groupHeaderRowNum);
    }

    // 컬럼명 생성: 중복 필드명은 그룹 헤더와 조합
    const fieldNameCount = new Map<string, number>();
    const fieldNameFirstIndex = new Map<string, number>();

    // 먼저 중복 필드명 카운트
    headerRow.values.forEach((value, index) => {
      if (value && value.length > 0 && value !== 'undefined') {
        fieldNameCount.set(value, (fieldNameCount.get(value) || 0) + 1);
        if (!fieldNameFirstIndex.has(value)) {
          fieldNameFirstIndex.set(value, index);
        }
      }
    });

    // 분기 관련 그룹 헤더 패턴
    const quarterPattern = /^[1-4]분기$/;

    // 최종 컬럼명 생성
    const columns: string[] = [];
    const seenNames = new Set<string>();

    headerRow.values.forEach((value, index) => {
      if (!value || value.length === 0 || value === 'undefined') {
        return;
      }

      let finalName = value;
      const count = fieldNameCount.get(value) || 1;

      // 중복 필드명이고 그룹 헤더가 있으면 조합
      if (count > 1 && groupHeaders[index]) {
        const groupHeader = groupHeaders[index];

        // 그룹 헤더가 분기 패턴이면 "N분기_필드명" 형태로 조합
        if (quarterPattern.test(groupHeader)) {
          finalName = `${groupHeader}_${value}`;
          console.log(`[SmartColumns] Combined column: "${groupHeader}" + "${value}" = "${finalName}"`);
        }
        // 그룹 헤더가 섹션 제목이 아니고 필드명과 다르면 조합
        else if (!/^\d+\./.test(groupHeader) && groupHeader !== value) {
          finalName = `${groupHeader}_${value}`;
          console.log(`[SmartColumns] Combined column: "${groupHeader}" + "${value}" = "${finalName}"`);
        }
      }

      // 여전히 중복이면 인덱스 추가
      if (seenNames.has(finalName)) {
        const suffix = index + 1;
        finalName = `${finalName}_${suffix}`;
      }

      seenNames.add(finalName);
      columns.push(finalName);
    });

    console.log('[SmartColumns] Header values (first 20):', columns.slice(0, 20));
    console.log('[SmartColumns] Final columns:', columns.length);

    // 취업현황 관련 컬럼 디버깅
    const employmentCols = columns.filter(c => c.includes('취업') || c.includes('분기'));
    if (employmentCols.length > 0) {
      console.log('[SmartColumns] Employment related columns:', employmentCols);
    }

    return columns;
  }

  /**
   * Node 6: 검증 노드
   * - 필수 필드 매핑 검사
   * - 누락된 필드에 대한 제안 생성
   * - Excel 컬럼과 HWPX 라벨의 유사도 기반 추천
   */
  private nodeValidate(state: GraphState): ValidationResult {
    console.log('[Node6:Validate] Starting validation...');

    // 개인이력카드 필수 필드 정의
    const requiredFields = [
      { name: '성명', aliases: ['이름', '성 명', '성  명', 'name', '성명 '] },
      { name: '연락처', aliases: ['전화번호', '핸드폰', '휴대폰', '휴대전화', '전화', 'phone', 'tel', '연 락 처'] },
      { name: '생년월일', aliases: ['생일', '출생일', '생년 월일', 'birthday', 'birth', '생년월일 '] },
      { name: '이메일', aliases: ['email', 'e-mail', '메일', '이 메 일'] },
      { name: '성별', aliases: ['sex', 'gender', '성 별'] },
      { name: '거주지', aliases: ['주소', '거주주소', '현거주지', '거 주 지', 'address'] },
      { name: '참여분야', aliases: ['분야', '참여 분야'] },
      { name: '수행기관', aliases: ['기관', '수행 기관', '기관명'] },
      { name: '사업명', aliases: ['사업', '프로젝트', '사 업 명'] },
      { name: '참여기간', aliases: ['기간', '참여 기간'] },
      { name: '국가', aliases: ['국 가', '나라', 'country'] },
      { name: '직무', aliases: ['직 무', '업무', 'job', 'position'] },
      { name: '희망직종', aliases: ['희망 직종', '직종'] },
      { name: '희망직무', aliases: ['희망 직무'] },
      // 프로그램 참여현황 분기 필드
      { name: '1분기', aliases: ['1분기 ', '1 분기'] },
      { name: '2분기', aliases: ['2분기 ', '2 분기'] },
      { name: '3분기', aliases: ['3분기 ', '3 분기'] },
      { name: '4분기', aliases: ['4분기 ', '4 분기'] },
    ];

    const issues: ValidationResult['issues'] = [];
    const suggestions: MappingSuggestion[] = [];

    // 이미 매핑된 Excel 컬럼 추적
    const mappedExcelColumns = new Set(state.finalMappings.map(m => m.excelColumn));
    const mappedCellKeys = new Set(state.finalMappings.map(m => `${m.hwpxRow}-${m.hwpxCol}`));

    // 셀 맵 생성
    const cellMap = new Map<string, HwpxCellInfo>();
    for (const cell of state.hwpxTable.cells) {
      cellMap.set(`${cell.rowIndex}-${cell.colIndex}`, cell);
    }

    // HWPX 라벨 셀 추출
    const labelCells = state.hwpxTable.cells.filter(cell =>
      cell.isHeader &&
      cell.text &&
      cell.text.trim().length >= 2 &&
      !/^\d+\./.test(cell.text.trim()) &&
      cell.text.trim() !== '개인이력카드'
    );

    // 각 필수 필드 검사
    let mappedCount = 0;
    const normalize = (t: string) => t.replace(/\s+/g, '').toLowerCase();

    for (const field of requiredFields) {
      // 이 필드가 이미 매핑되었는지 확인
      const allNames = [field.name, ...field.aliases];
      const isMapped = allNames.some(name => {
        const normalizedName = normalize(name);
        return Array.from(mappedExcelColumns).some(col =>
          normalize(col) === normalizedName ||
          normalize(col).includes(normalizedName) ||
          normalizedName.includes(normalize(col))
        );
      });

      if (isMapped) {
        mappedCount++;
        continue;
      }

      // 필드가 매핑되지 않음 - HWPX에서 해당 라벨 셀 찾기
      let targetLabelCell: HwpxCellInfo | null = null;
      for (const labelCell of labelCells) {
        const normalizedLabel = normalize(labelCell.text || '');
        if (allNames.some(name => normalize(name) === normalizedLabel)) {
          targetLabelCell = labelCell;
          break;
        }
      }

      // 데이터 셀 위치 찾기
      let dataRow = -1;
      let dataCol = -1;

      if (targetLabelCell) {
        // 라벨 오른쪽 셀 찾기
        const rightCol = targetLabelCell.colIndex + (targetLabelCell.colSpan || 1);
        const rightCell = cellMap.get(`${targetLabelCell.rowIndex}-${rightCol}`);

        if (rightCell && !rightCell.isHeader) {
          dataRow = rightCell.rowIndex;
          dataCol = rightCell.colIndex;
        } else {
          // 아래 셀 시도
          const belowRow = targetLabelCell.rowIndex + (targetLabelCell.rowSpan || 1);
          const belowCell = cellMap.get(`${belowRow}-${targetLabelCell.colIndex}`);

          if (belowCell && !belowCell.isHeader) {
            dataRow = belowCell.rowIndex;
            dataCol = belowCell.colIndex;
          }
        }
      }

      // 적합한 Excel 컬럼 찾기
      let suggestedExcelColumn: string | undefined;
      let bestScore = 0;

      for (const excelCol of state.excelColumns) {
        if (mappedExcelColumns.has(excelCol)) continue;

        const normalizedExcel = normalize(excelCol);
        let score = 0;

        for (const name of allNames) {
          const normalizedName = normalize(name);
          if (normalizedExcel === normalizedName) {
            score = 100;
            break;
          } else if (normalizedExcel.includes(normalizedName) || normalizedName.includes(normalizedExcel)) {
            score = Math.max(score, 70);
          }
        }

        if (score > bestScore) {
          bestScore = score;
          suggestedExcelColumn = excelCol;
        }
      }

      // Issue 추가
      issues.push({
        type: 'missing',
        field: field.name,
        message: `"${field.name}" 필드가 매핑되지 않았습니다.`,
        hwpxRow: dataRow >= 0 ? dataRow : undefined,
        hwpxCol: dataCol >= 0 ? dataCol : undefined,
        suggestedExcelColumn,
      });

      // Suggestion 추가 (Excel 컬럼과 HWPX 셀 위치가 모두 있는 경우)
      if (suggestedExcelColumn && dataRow >= 0 && dataCol >= 0) {
        const cellKey = `${dataRow}-${dataCol}`;
        if (!mappedCellKeys.has(cellKey)) {
          suggestions.push({
            excelColumn: suggestedExcelColumn,
            hwpxRow: dataRow,
            hwpxCol: dataCol,
            labelText: field.name,
            reason: `"${suggestedExcelColumn}" → "${field.name}" 자동 제안`,
          });
        }
      }
    }

    const totalFields = requiredFields.length;
    const missingFields = totalFields - mappedCount;
    const isValid = missingFields === 0;

    console.log('[Node6:Validate] Validation complete:', {
      totalFields,
      mappedFields: mappedCount,
      missingFields,
      issues: issues.length,
      suggestions: suggestions.length,
    });

    return {
      isValid,
      totalFields,
      mappedFields: mappedCount,
      missingFields,
      issues,
      suggestions,
    };
  }
}
