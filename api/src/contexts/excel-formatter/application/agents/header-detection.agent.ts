import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';

/**
 * 계층적 컬럼 정보 (슬림 버전)
 */
export interface HierarchicalColumn {
  name: string;           // 최종 컬럼명 (예: "전문가 컨설팅_1회")
  colIndex: number;       // 실제 Excel 컬럼 인덱스
  depth: number;          // 헤더 깊이 (0 = 최상위)
}

/**
 * 헤더 분석 결과 (슬림 버전)
 */
export interface HeaderAnalysisResult {
  headerRows: number[];           // 헤더 행 번호들 [8, 9, 10]
  dataStartRow: number;           // 실제 데이터 시작 행
  columns: HierarchicalColumn[];  // 계층적 컬럼 정보
  metaInfo?: Record<string, string>; // 메타 정보 (Class Name, Book Name 등)
}

/**
 * 셀 병합 정보 (슬림 버전)
 */
interface MergeInfo {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  text: string;
}

/**
 * Header Detection Agent
 *
 * 복잡한 다중 헤더 Excel 파일 처리:
 * - 메타 행 감지 (Class Name: xxx)
 * - 다중 헤더 행 감지 (병합 셀 기반)
 * - 계층적 컬럼명 생성
 */
@Injectable()
export class HeaderDetectionAgent {
  private readonly apiKey: string | undefined;
  private readonly apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY');
  }

  /**
   * Excel 워크시트 분석 (메인 진입점)
   */
  async analyze(buffer: Buffer, sheetName?: string): Promise<HeaderAnalysisResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

      const targetSheetName = sheetName?.trim() || workbook.worksheets[0]?.name;
      const worksheet = workbook.getWorksheet(targetSheetName);

      if (!worksheet) {
        throw new Error(`Sheet "${targetSheetName}" not found`);
      }

      console.log('[HeaderAgent] Analyzing worksheet:', targetSheetName);

      // Step 1: 메타 행 감지
      const metaResult = this.detectMetaRows(worksheet);
      console.log('[HeaderAgent] Meta rows:', metaResult.metaRows);

      // Step 2: 헤더 행 감지
      const headerResult = this.detectHeaderRows(worksheet, metaResult.metaRows);
      console.log('[HeaderAgent] Header rows:', headerResult.headerRows);
      console.log('[HeaderAgent] Data start row:', headerResult.dataStartRow);

      // Step 3: 병합 셀 정보 추출 (슬림하게)
      const merges = this.extractMergeInfo(worksheet, headerResult.headerRows);
      console.log('[HeaderAgent] Merge count:', merges.length);

      // Step 4: 계층적 컬럼명 생성
      const columns = this.generateHierarchicalColumns(
        worksheet,
        headerResult.headerRows,
        merges
      );
      console.log('[HeaderAgent] Columns generated:', columns.length);

      return {
        headerRows: headerResult.headerRows,
        dataStartRow: headerResult.dataStartRow,
        columns,
        metaInfo: metaResult.metaInfo,
      };
    } finally {
      // 메모리 릭 방지: workbook 정리
      workbook.worksheets.length = 0;
    }
  }

  /**
   * Step 1: 메타 행 감지
   * "Class Name : xxx", "Book Name : xxx" 같은 패턴
   */
  private detectMetaRows(worksheet: ExcelJS.Worksheet): {
    metaRows: number[];
    metaInfo: Record<string, string>;
  } {
    const metaRows: number[] = [];
    const metaInfo: Record<string, string> = {};
    const metaPattern = /^([A-Za-z\s]+)\s*:\s*(.+)$/;

    // 최대 10행까지만 검사 (메타 정보는 보통 상단에 있음)
    for (let rowNum = 1; rowNum <= 10; rowNum++) {
      const row = worksheet.getRow(rowNum);
      let isMetaRow = false;

      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = this.getCellText(cell).trim();
        const match = text.match(metaPattern);

        if (match) {
          isMetaRow = true;
          const key = match[1].trim();
          const value = match[2].trim();
          metaInfo[key] = value;
        }
      });

      if (isMetaRow) {
        metaRows.push(rowNum);
      }
    }

    return { metaRows, metaInfo };
  }

  /**
   * Step 2: 헤더 행 감지
   * 점수 기반으로 가장 가능성 높은 헤더 행 찾기
   */
  private detectHeaderRows(
    worksheet: ExcelJS.Worksheet,
    metaRows: number[]
  ): {
    headerRows: number[];
    dataStartRow: number;
  } {
    interface RowScore {
      rowNum: number;
      score: number;
      cellCount: number;
      hasNumberCol: boolean;
      hasNameCol: boolean;
    }

    const scores: RowScore[] = [];
    const metaRowSet = new Set(metaRows);

    // 최대 15행까지 검사
    for (let rowNum = 1; rowNum <= 15; rowNum++) {
      if (metaRowSet.has(rowNum)) continue;

      const row = worksheet.getRow(rowNum);
      let cellCount = 0;
      let shortLabelCount = 0;
      let hasNumberCol = false;
      let hasNameCol = false;
      let hasMetaPattern = false;

      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = this.getCellText(cell).trim();
        if (text.length === 0) return;

        cellCount++;

        // 짧은 라벨 (2-15자)
        if (text.length >= 2 && text.length <= 15) {
          shortLabelCount++;
        }

        // 번호 컬럼
        if (/^(No\.?|번호|순번)$/i.test(text)) {
          hasNumberCol = true;
        }

        // 이름 컬럼
        if (/^(이름|성명|한글이름|영문이름|Name)$/i.test(text)) {
          hasNameCol = true;
        }

        // 메타 패턴
        if (/^[A-Za-z\s]+\s*:\s*.+/.test(text)) {
          hasMetaPattern = true;
        }
      });

      if (cellCount < 3) continue;

      // 점수 계산
      let score = cellCount * 2 + shortLabelCount * 3;
      if (hasNumberCol) score += 30;
      if (hasNameCol) score += 30;
      if (hasMetaPattern) score -= 20;

      scores.push({
        rowNum,
        score,
        cellCount,
        hasNumberCol,
        hasNameCol,
      });
    }

    if (scores.length === 0) {
      return { headerRows: [1], dataStartRow: 2 };
    }

    // 점수순 정렬
    scores.sort((a, b) => b.score - a.score);
    const mainHeaderRow = scores[0].rowNum;

    // 다중 헤더 감지: 메인 헤더 위/아래에 추가 헤더 행들
    const headerRows: number[] = [];

    // 메인 헤더 위의 행들 중 셀이 있는 것들 (최대 2개)
    for (let r = mainHeaderRow - 1; r >= Math.max(1, mainHeaderRow - 2); r--) {
      if (metaRowSet.has(r)) continue;

      const row = worksheet.getRow(r);
      let hasCells = false;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (this.getCellText(cell).trim().length > 0) {
          hasCells = true;
        }
      });

      if (hasCells) {
        headerRows.unshift(r);
      }
    }

    headerRows.push(mainHeaderRow);

    // 메인 헤더 아래에도 추가 헤더 행이 있는지 확인 (최대 2개)
    // 데이터 행은 숫자로 시작하는 행 (No. 컬럼에 숫자 데이터)
    let dataStartRow = mainHeaderRow + 1;

    for (let r = mainHeaderRow + 1; r <= mainHeaderRow + 3; r++) {
      const row = worksheet.getRow(r);
      let cellCount = 0;
      let hasNumericFirst = false;
      let hasHeaderPattern = false;

      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const text = this.getCellText(cell).trim();
        if (text.length === 0) return;

        cellCount++;

        // 첫 번째 컬럼이 숫자인지 (데이터 행 특징)
        if (colNum <= 2 && /^\d+$/.test(text)) {
          hasNumericFirst = true;
        }

        // 회차, 날짜 패턴 등 헤더 패턴
        if (/^\d+회차$/.test(text) || // 1회차, 2회차
            /^\d{1,2}\s*\([A-Za-z]{2,3}\)$/.test(text) || // 04 (Mo), 06 (Wed)
            /^[A-Za-z]{3,}$/.test(text)) { // Mon, Tue, ...
          hasHeaderPattern = true;
        }
      });

      if (cellCount < 3) break;

      // 데이터 행 특징: 첫 컬럼이 숫자
      if (hasNumericFirst) {
        dataStartRow = r;
        break;
      }

      // 헤더 패턴이 있으면 헤더 행으로 추가
      if (hasHeaderPattern) {
        headerRows.push(r);
        dataStartRow = r + 1;
      }
    }

    console.log('[HeaderAgent] Detected header rows:', headerRows, 'Data starts at:', dataStartRow);

    return { headerRows, dataStartRow };
  }

  /**
   * Step 3: 병합 셀 정보 추출 (슬림하게)
   */
  private extractMergeInfo(
    worksheet: ExcelJS.Worksheet,
    headerRows: number[]
  ): MergeInfo[] {
    const merges: MergeInfo[] = [];
    const headerRowSet = new Set(headerRows);

    // worksheet의 병합 정보 접근
    const mergedCells = (worksheet as unknown as { _merges: Record<string, string> })._merges || {};

    for (const range of Object.keys(mergedCells)) {
      // "A1:C3" 형태 파싱
      const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (!match) continue;

      const startCol = this.colLetterToIndex(match[1]);
      const startRow = parseInt(match[2], 10);
      const endCol = this.colLetterToIndex(match[3]);
      const endRow = parseInt(match[4], 10);

      // 헤더 행에 있는 병합만 관심
      if (!headerRowSet.has(startRow)) continue;

      const cell = worksheet.getCell(startRow, startCol);
      const text = this.getCellText(cell).trim();

      if (text.length > 0) {
        merges.push({
          startRow,
          endRow,
          startCol,
          endCol,
          text,
        });
      }
    }

    return merges;
  }

  /**
   * Step 4: 계층적 컬럼명 생성 (다중 헤더 행 지원)
   *
   * 리턴업 파일 같은 구조 지원:
   * - Row 1: 4. 프로그램 참여현황, 4. 프로그램 참여현황, ...
   * - Row 2: 전문가 강연, 전문가 강연, ..., 전문가 컨설팅, 전문가 컨설팅, ...
   * - Row 3: 1회, 2회, 3회, ..., 1회, 2회, 3회, ...
   *
   * 결과: "4. 프로그램 참여현황_전문가 강연_1회" 형태의 계층적 컬럼명
   */
  private generateHierarchicalColumns(
    worksheet: ExcelJS.Worksheet,
    headerRows: number[],
    merges: MergeInfo[]
  ): HierarchicalColumn[] {
    if (headerRows.length === 0) {
      return [];
    }

    const columns: HierarchicalColumn[] = [];
    const mainHeaderRow = headerRows[headerRows.length - 1];

    // 각 헤더 행에서 컬럼별 값 수집 (행 순서 유지)
    // Map<colNumber, {rowNum: value}>
    const columnValuesPerRow = new Map<number, Map<number, string>>();

    for (const rowNum of headerRows) {
      const row = worksheet.getRow(rowNum);
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const text = this.getCellText(cell).trim();
        if (text.length === 0 || text === 'undefined') return;

        if (!columnValuesPerRow.has(colNumber)) {
          columnValuesPerRow.set(colNumber, new Map());
        }
        columnValuesPerRow.get(colNumber)!.set(rowNum, text);
      });
    }

    // 병합 셀 처리: 병합된 범위의 모든 컬럼에 값 전파
    for (const merge of merges) {
      for (let col = merge.startCol; col <= merge.endCol; col++) {
        if (!columnValuesPerRow.has(col)) {
          columnValuesPerRow.set(col, new Map());
        }
        const colMap = columnValuesPerRow.get(col)!;
        // 해당 행에 값이 없으면 병합 셀 값 추가
        if (!colMap.has(merge.startRow)) {
          colMap.set(merge.startRow, merge.text);
        }
      }
    }

    // 기본 컬럼 패턴 (단일 값만 사용해야 하는 컬럼)
    const basicColumnPatterns = [
      /^No\.?$/i, /^번호$/, /^순번$/,
      /^이름$/, /^성명$/, /^한글이름$/, /^영문이름$/,
      /^이메일$/, /^연락처$/, /^전화번호$/,
      /^생년월일$/, /^성별$/, /^거주지$/,
    ];

    // 각 컬럼에 대해 계층적 이름 생성
    const seenNames = new Set<string>();
    const sortedCols = Array.from(columnValuesPerRow.keys()).sort((a, b) => a - b);

    for (const colNumber of sortedCols) {
      const rowValues = columnValuesPerRow.get(colNumber)!;

      // 행 순서대로 정렬하여 값 배열 생성
      const sortedRowNums = Array.from(rowValues.keys()).sort((a, b) => a - b);
      const orderedValues = sortedRowNums.map(r => rowValues.get(r)!);

      // 기본 컬럼인지 확인 (어떤 행이든 기본 패턴에 매칭되면)
      const isBasicColumn = orderedValues.some(v =>
        basicColumnPatterns.some(pattern => pattern.test(v))
      );

      let finalName: string;

      if (isBasicColumn) {
        // 기본 컬럼: 마지막 행의 값 사용 (가장 구체적인 이름)
        finalName = orderedValues[orderedValues.length - 1];
      } else {
        // 다중 헤더 컬럼: 모든 계층을 조합
        // 중복 제거하면서 순서 유지
        const uniqueValues: string[] = [];
        for (const v of orderedValues) {
          // 날짜 형식 (04 (Mo)) 제외
          if (/^\d{2}\s*\([A-Za-z]{2,3}\)$/.test(v)) continue;
          // 단순 숫자만 있는 것 제외 (단, "1회", "2회" 등은 포함)
          if (/^\d+$/.test(v)) continue;
          // 중복 제외
          if (!uniqueValues.includes(v)) {
            uniqueValues.push(v);
          }
        }

        if (uniqueValues.length === 0) {
          // 필터 후 빈 경우 원본 마지막 값 사용
          finalName = orderedValues[orderedValues.length - 1];
        } else {
          // 계층 조합: "4. 프로그램 참여현황_전문가 강연_1회"
          finalName = uniqueValues.join('_');
        }
      }

      // 중복 이름 처리 (동일 이름이 있으면 _2, _3 추가)
      let uniqueName = finalName;
      let counter = 1;
      while (seenNames.has(uniqueName)) {
        counter++;
        uniqueName = `${finalName}_${counter}`;
      }
      seenNames.add(uniqueName);

      columns.push({
        name: uniqueName,
        colIndex: colNumber,
        depth: headerRows.indexOf(mainHeaderRow),
      });
    }

    console.log('[HeaderAgent] Generated columns (first 15):',
      columns.slice(0, 15).map(c => c.name));

    return columns;
  }

  /**
   * AI 폴백: 복잡한 구조일 때 Gemini에게 질문
   */
  async analyzeWithAI(
    rowsPreview: string[][], // 처음 15행만 전달
    maxCols: number
  ): Promise<HeaderAnalysisResult | null> {
    if (!this.apiKey) {
      console.log('[HeaderAgent] No API key, skipping AI analysis');
      return null;
    }

    const prompt = `Excel 파일의 헤더 구조를 분석해주세요.

## 데이터 (처음 15행, 최대 ${maxCols}열)
${rowsPreview.map((row, i) => `Row ${i + 1}: ${row.slice(0, 20).join(' | ')}`).join('\n')}

## 작업
1. 메타 정보 행 (Class Name: xxx 같은 패턴) 찾기
2. 실제 헤더 행 번호 찾기 (다중 헤더일 수 있음)
3. 데이터 시작 행 번호 찾기

JSON 형식으로 응답:
{
  "metaRows": [1, 2],
  "headerRows": [8, 9],
  "dataStartRow": 10,
  "confidence": 0.9
}`;

    try {
      const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        headerRows: parsed.headerRows || [],
        dataStartRow: parsed.dataStartRow || 1,
        columns: [], // AI 분석은 행 번호만 반환
      };
    } catch (error) {
      console.error('[HeaderAgent] AI analysis failed:', error);
      return null;
    }
  }

  /**
   * 헬퍼: 셀 텍스트 추출
   */
  private getCellText(cell: ExcelJS.Cell): string {
    const value = cell.value;
    if (value === null || value === undefined) return '';

    if (typeof value === 'object' && 'richText' in value) {
      return (value.richText || []).map((t: { text: string }) => t.text).join('');
    }
    if (typeof value === 'object' && 'result' in value) {
      return String((value as { result: unknown }).result);
    }
    return String(value);
  }

  /**
   * 헬퍼: 컬럼 문자 -> 인덱스 (A=1, B=2, ...)
   */
  private colLetterToIndex(letter: string): number {
    let index = 0;
    for (let i = 0; i < letter.length; i++) {
      index = index * 26 + (letter.charCodeAt(i) - 64);
    }
    return index;
  }
}
