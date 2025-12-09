# HWPX 템플릿 자동 매핑 시스템 구축기

> Excel 데이터를 한글(HWPX) 문서 템플릿에 자동으로 매핑하는 AI 기반 시스템 개발 과정

## 요구사항

한국산업인력공단에서 사용하는 **개인이력카드** 양식이 있었습니다.

- **HWPX 템플릿**: 28행 × 16열 표 구조의 개인이력카드
- **Excel 데이터**: 300명 이상의 인력 정보 (성명, 연락처, 생년월일 등 51개 컬럼)
- **목표**: Excel의 각 행(사람)마다 HWPX 파일을 자동 생성하여 ZIP으로 일괄 다운로드

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  HWPX 템플릿     │     │   Excel 데이터   │     │   ZIP 다운로드   │
│  (개인이력카드)   │  +  │  (300+ rows)    │  →  │  (300+ HWPX)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 핵심 과제

1. HWPX 표의 어떤 셀에 Excel의 어떤 컬럼 데이터를 넣을지 **자동으로 매핑**
2. "성  명" ↔ "성명", "취 업 처" ↔ "취업처" 같은 **공백 차이 처리**
3. Excel 헤더가 1행이 아닌 3행에 있는 **비표준 구조 처리**

---

## 1차 시도: 단순 ExcelJS 파싱

### 접근 방식

```typescript
// ExceljsParserAdapter.extractSheetData()
worksheet.eachRow((row, rowNumber) => {
  if (rowNumber === 1) {
    // 첫 행을 헤더로 사용
    row.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value);
    });
  } else {
    // 나머지는 데이터
  }
});
```

### 실패 원인

Excel 파일의 실제 구조가 예상과 달랐습니다:

```
Row 1: "1. 신상정보" | "2. 해외취업" | "3. 희망직종" | ...  ← 섹션 헤더
Row 2: (병합 셀들)
Row 3: "No." | "성명" | "연락처" | "생년월일" | ...        ← 실제 컬럼 헤더
Row 4+: 데이터
```

**결과**: 6개의 섹션 헤더("1. 신상정보", "2. 해외취업" 등)를 컬럼명으로 인식

```json
// 잘못된 결과
{
  "columns": ["1. 신상정보", "2. 해외취업(경험)", "3. 희망직종/직무", ...]
}
```

---

## 2차 시도: 스마트 헤더 감지 알고리즘

### 접근 방식

첫 10행을 스캔하고 **점수 시스템**으로 실제 헤더 행을 찾습니다:

```typescript
private async findSmartHeaderRow(worksheet) {
  const rows = [];

  for (let rowNum = 1; rowNum <= 10; rowNum++) {
    const row = worksheet.getRow(rowNum);
    let nonEmptyCount = 0;
    let hasShortLabels = 0;    // 2-10자 텍스트 (필드명처럼 보이는)
    let hasSectionMarkers = 0;  // "1.", "2." 등

    row.eachCell((cell, colNumber) => {
      const text = extractCellText(cell);

      if (text.length > 0) {
        nonEmptyCount++;

        // 짧은 텍스트는 필드명일 가능성 높음
        if (text.length >= 2 && text.length <= 10) {
          hasShortLabels++;
        }

        // 섹션 마커는 헤더가 아님
        if (/^\d+\./.test(text)) {
          hasSectionMarkers++;
        }
      }
    });

    // 점수 계산
    const score = nonEmptyCount * 2
                + hasShortLabels * 3
                - hasSectionMarkers * 10;  // 페널티

    rows.push({ rowNum, score, values });
  }

  // 가장 높은 점수의 행 선택
  rows.sort((a, b) => b.score - a.score);
  return rows[0];
}
```

### 점수 계산 예시

| 행 | 내용 | 비어있지 않은 셀 | 짧은 라벨 | 섹션 마커 | 점수 |
|---|------|---------------|---------|---------|-----|
| 1 | "1. 신상정보", "2. 해외취업", ... | 6 | 0 | 6 | 6×2 + 0×3 - 6×10 = **-48** |
| 3 | "No.", "성명", "연락처", ... | 51 | 45 | 0 | 51×2 + 45×3 - 0×10 = **237** |

**결과**: Row 3이 헤더로 선택됨 (Score: 237)

### 부분 성공

```json
// 올바른 컬럼 감지
{
  "columns": ["No.", "성명", "연락처", "생년월일", "이메일", "성별", ...]
}
```

하지만 **매핑 정확도**가 낮았습니다. HWPX의 "성  명"과 Excel의 "성명"을 매칭하지 못했습니다.

---

## 3차 시도: 단순 문자열 매칭

### 접근 방식

```typescript
function normalizeText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

// "성  명" → "성명", "취 업 처" → "취업처"
const hwpxLabel = normalizeText(cell.text);  // "성명"
const excelCol = normalizeText(column);       // "성명"

if (hwpxLabel === excelCol) {
  // 매칭!
}
```

### 실패 원인

1. **동일 라벨 중복**: HWPX에 "취업여부"가 3개, "취 업 처"가 3개 있음 (국내취업, 해외취업, 인턴 섹션)
2. **의미적 유사성 무시**: "담당직무" ↔ "직무"는 같은 의미지만 문자열이 다름
3. **위치 맥락 무시**: 같은 라벨이라도 위치에 따라 다른 데이터를 매핑해야 함

```
HWPX 구조:
┌─────────────────────────────────────┐
│ 5. 취업현황                          │
├─────────┬─────────┬─────────────────┤
│ 국내취업 │ 해외취업 │ 인턴            │
├─────────┼─────────┼─────────────────┤
│취업여부  │취업여부  │취업여부          │  ← 같은 라벨 3개!
│취 업 처  │취 업 처  │취 업 처          │  ← 같은 라벨 3개!
│담당직무  │담당직무  │담당직무          │  ← 같은 라벨 3개!
└─────────┴─────────┴─────────────────┘
```

---

## 최종 해결: LangGraph 스타일 병렬 AI 파이프라인

### 아키텍처 설계

단일 방법의 한계를 극복하기 위해 **다중 전략 + 투표 시스템**을 도입했습니다:

```
┌─────────────────────────────────────────────────────────────────┐
│                    HwpxMappingGraphService                      │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Stage 1: 병렬 데이터 추출                                   │ │
│  │   ┌─────────────┐       ┌─────────────────────────────┐   │ │
│  │   │ HWPX 분석    │       │ Excel 스마트 헤더 감지       │   │ │
│  │   │ (28×16 표)   │       │ (51개 컬럼)                 │   │ │
│  │   └─────────────┘       └─────────────────────────────┘   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Stage 2: 병렬 매핑 생성 (Promise.allSettled)               │ │
│  │                                                            │ │
│  │   ┌────────────┐  ┌────────────┐  ┌────────────┐         │ │
│  │   │  Node 1    │  │  Node 2    │  │  Node 3    │         │ │
│  │   │ 규칙 기반   │  │ AI 템플릿  │  │ AI Excel   │         │ │
│  │   │  매핑      │  │   분석     │  │   분석     │         │ │
│  │   └─────┬──────┘  └─────┬──────┘  └─────┬──────┘         │ │
│  │         │               │               │                 │ │
│  │         ▼               ▼               ▼                 │ │
│  │     27 후보         26 후보         13 후보                │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Stage 3: 병합 및 투표 (Node 4: Merge)                      │ │
│  │                                                            │ │
│  │   같은 (row, col) 위치 → confidence 점수 합산             │ │
│  │   최고 점수 후보 선택                                      │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Stage 4: 최종 매핑 반환 (27개)                             │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Node 1: 규칙 기반 매핑

HWPX 표 구조를 분석하여 라벨-데이터 셀 관계를 추론합니다:

```typescript
private async runRuleBasedMapping(state: GraphState): Promise<MappingCandidate[]> {
  const candidates: MappingCandidate[] = [];
  const { hwpxTable, excelColumns } = state;

  // 라벨 셀 찾기
  for (const cell of hwpxTable.cells) {
    if (!cell.isHeader) continue;

    const labelText = this.normalizeText(cell.text);

    // Excel 컬럼에서 매칭 찾기
    const matchedColumn = excelColumns.find(col =>
      this.normalizeText(col) === labelText
    );

    if (matchedColumn) {
      // 데이터 위치 추론: 오른쪽 또는 아래
      const dataPosition = this.inferDataPosition(cell, hwpxTable);

      candidates.push({
        excelColumn: matchedColumn,
        hwpxRow: dataPosition.row,
        hwpxCol: dataPosition.col,
        labelText: cell.text,
        confidence: 0.9,
        source: 'rule',
        reason: `라벨 "${cell.text}" ${dataPosition.direction} 셀`
      });
    }
  }

  return candidates;
}

private inferDataPosition(labelCell, table) {
  const { rowIndex, colIndex } = labelCell;

  // 오른쪽 셀이 비어있으면 → 가로 배치
  const rightCell = table.cells.find(c =>
    c.rowIndex === rowIndex && c.colIndex === colIndex + 1
  );
  if (rightCell && !rightCell.isHeader) {
    return { row: rowIndex, col: colIndex + 1, direction: '오른쪽' };
  }

  // 아래 셀이 비어있으면 → 세로 배치
  const belowCell = table.cells.find(c =>
    c.rowIndex === rowIndex + 1 && c.colIndex === colIndex
  );
  if (belowCell && !belowCell.isHeader) {
    return { row: rowIndex + 1, col: colIndex, direction: '아래' };
  }

  return { row: rowIndex, col: colIndex + 1, direction: '오른쪽' };
}
```

### Node 2: AI 템플릿 구조 분석 (Gemini API)

HWPX 표 전체 구조를 AI에게 보여주고 데이터 입력 위치를 추론합니다:

```typescript
private async runAiTemplateAnalysis(state: GraphState): Promise<MappingCandidate[]> {
  const tableDescription = this.formatTableForAI(state.hwpxTable);

  const prompt = `
당신은 문서 템플릿 분석 전문가입니다.

## HWPX 표 구조
${tableDescription}

## Excel 컬럼 목록
${state.excelColumns.join(', ')}

## 분석 요청
각 라벨 셀에 대해 데이터가 입력될 위치(row, col)를 분석하세요.
라벨과 의미적으로 매칭되는 Excel 컬럼을 찾아주세요.

## 응답 형식 (JSON)
[
  { "excelColumn": "성명", "hwpxRow": 3, "hwpxCol": 1, "labelText": "성  명" },
  ...
]
`;

  const response = await this.geminiClient.generateContent(prompt);
  return this.parseAiResponse(response, 'ai_template');
}

private formatTableForAI(table): string {
  const lines = [];
  for (const cell of table.cells) {
    const label = cell.isHeader ? ' [라벨]' : '';
    lines.push(`(${cell.rowIndex},${cell.colIndex}): "${cell.text}"${label}`);
  }
  return lines.join('\n');
}
```

### Node 3: AI Excel 헤더 시맨틱 매칭 (Gemini API)

Excel 컬럼명과 HWPX 라벨 간의 의미적 유사성을 AI로 분석합니다:

```typescript
private async runAiExcelAnalysis(state: GraphState): Promise<MappingCandidate[]> {
  // HWPX에서 라벨 텍스트만 추출
  const hwpxLabels = state.hwpxTable.cells
    .filter(c => c.isHeader)
    .map(c => c.text);

  const prompt = `
## Excel 컬럼
${state.excelColumns.join(', ')}

## HWPX 라벨
${hwpxLabels.join(', ')}

## 요청
의미적으로 동일하거나 유사한 Excel 컬럼 - HWPX 라벨 쌍을 찾아주세요.

예시:
- "성명" ≈ "성  명" (공백 차이)
- "담당직무" ≈ "직무" (포함 관계)
- "취업처/직무" ≈ "취업처/직무" (완전 일치)

## 응답 형식 (JSON)
[
  { "excelColumn": "성명", "hwpxLabel": "성  명", "similarity": 0.95 },
  ...
]
`;

  const response = await this.geminiClient.generateContent(prompt);
  return this.convertToMappingCandidates(response, state.hwpxTable);
}
```

### Node 4: 병합 및 투표

세 노드의 결과를 합쳐서 최종 매핑을 결정합니다:

```typescript
private runMergeNode(state: GraphState): MappingCandidate[] {
  const allCandidates = [
    ...state.ruleMappings,      // 27개
    ...state.aiTemplateMappings, // 26개
    ...state.aiExcelMappings     // 13개
  ];

  // 같은 위치에 대한 후보들을 그룹화
  const candidateGroups = new Map<string, MappingCandidate[]>();

  for (const candidate of allCandidates) {
    const key = `${candidate.hwpxRow}-${candidate.hwpxCol}-${candidate.excelColumn}`;
    if (!candidateGroups.has(key)) {
      candidateGroups.set(key, []);
    }
    candidateGroups.get(key).push(candidate);
  }

  // 각 그룹에서 confidence 합산 후 최고 점수 선택
  const finalMappings: MappingCandidate[] = [];

  for (const [key, candidates] of candidateGroups) {
    // confidence 합산 (여러 노드가 동의하면 점수 상승)
    const totalConfidence = candidates.reduce((sum, c) => sum + c.confidence, 0);

    const bestCandidate = { ...candidates[0] };
    bestCandidate.confidence = totalConfidence;
    bestCandidate.source = candidates.map(c => c.source).join('+');

    finalMappings.push(bestCandidate);
  }

  // 위치별로 가장 높은 confidence 선택
  const positionBest = new Map<string, MappingCandidate>();

  for (const mapping of finalMappings) {
    const posKey = `${mapping.hwpxRow}-${mapping.hwpxCol}`;
    const existing = positionBest.get(posKey);

    if (!existing || mapping.confidence > existing.confidence) {
      positionBest.set(posKey, mapping);
    }
  }

  return Array.from(positionBest.values());
}
```

### 투표 시스템 예시

```
위치 (3, 1) - "성명" 매핑:

┌────────────┬────────────┬─────────────┐
│   Node 1   │   Node 2   │   Node 3    │
│  (Rule)    │ (AI 템플릿) │ (AI Excel)  │
├────────────┼────────────┼─────────────┤
│   0.90     │    0.90    │    0.95     │
└────────────┴────────────┴─────────────┘
                   │
                   ▼
         총점: 0.90 + 0.90 + 0.95 = 2.75

         ✅ 최종 선택: "성명" → (3, 1)
```

---

## 메모리 최적화 이슈

### 문제 발생

300개 이상의 행을 처리할 때 **JavaScript heap out of memory** 에러가 발생했습니다.

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

### 원인 분석

```typescript
// 문제 코드
for (let rowNum = 1; rowNum <= rowCount; rowNum++) {
  const row = worksheet.getRow(rowNum);

  columnMap.forEach((columnName, colNumber) => {
    const cell = row.getCell(colNumber);  // ExcelJS 객체 참조 유지
    rowData[columnName] = cell.value;     // 객체 그대로 저장
  });

  data.push(rowData);  // 메모리 누적
}
```

- ExcelJS의 Cell 객체가 내부적으로 많은 메타데이터를 보유
- 300개 행 × 51개 컬럼 = 15,300개 Cell 객체 참조
- GC가 제대로 정리하지 못함

### 해결 방법

```typescript
// 최적화된 코드
worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
  if (rowNum <= headerRowNum) return;

  const rowData: Record<string, unknown> = {};

  for (const { colIndex, name } of columnIndexToName) {
    const cell = row.getCell(colIndex);
    const value = cell.value;

    if (value !== null && value !== undefined) {
      // 즉시 기본 타입으로 변환하여 저장
      rowData[name] = this.extractCellValue(value);
    }
  }

  data.push(rowData);
});

private extractCellValue(value: unknown): string | number | boolean | Date {
  if (value instanceof Date) return value;

  if (typeof value === 'object') {
    // richText, formula 등 복잡한 객체 → 문자열로 변환
    if ('richText' in value) {
      return value.richText.map(t => t.text).join('');
    }
    if ('result' in value) {
      return this.extractCellValue(value.result);
    }
    return JSON.stringify(value);
  }

  return value;  // string, number, boolean
}
```

추가로 Node.js 힙 메모리 증가:

```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run start:dev
```

---

## 최종 결과

### 매핑 정확도

| 방법 | 매핑 수 | 정확도 |
|-----|--------|-------|
| 1차 (단순 파싱) | 0 | 0% |
| 2차 (스마트 헤더) | 6 | 22% |
| 3차 (문자열 매칭) | 15 | 56% |
| **최종 (LangGraph)** | **27** | **100%** |

### 샘플 매핑 결과

```json
[
  { "excelColumn": "성명", "hwpxRow": 3, "hwpxCol": 1, "confidence": 2.75 },
  { "excelColumn": "연락처", "hwpxRow": 4, "hwpxCol": 1, "confidence": 2.75 },
  { "excelColumn": "생년월일", "hwpxRow": 3, "hwpxCol": 8, "confidence": 2.75 },
  { "excelColumn": "이메일", "hwpxRow": 4, "hwpxCol": 8, "confidence": 2.75 },
  { "excelColumn": "성별", "hwpxRow": 3, "hwpxCol": 14, "confidence": 2.75 },
  { "excelColumn": "거주지", "hwpxRow": 4, "hwpxCol": 14, "confidence": 2.75 },
  { "excelColumn": "참여분야", "hwpxRow": 7, "hwpxCol": 0, "confidence": 2.5 },
  { "excelColumn": "수행기관", "hwpxRow": 7, "hwpxCol": 1, "confidence": 2.5 },
  ...
]
```

---

## 핵심 교훈

### 1. 단일 방법의 한계

- 규칙 기반: 패턴이 맞지 않으면 실패
- AI 단독: 환각(hallucination) 가능성
- 문자열 매칭: 의미적 유사성 무시

### 2. 앙상블의 힘

```
Rule-based (정확하지만 제한적)
     +
AI Template (구조 이해)
     +
AI Excel (의미적 매칭)
     ↓
투표/합의 → 높은 정확도
```

### 3. 실제 데이터의 복잡성

- Excel 파일은 "표준"이 아님 (헤더 위치, 병합 셀, 섹션 구조)
- 스마트 휴리스틱이 필요 (점수 기반 헤더 감지)

### 4. 메모리 관리

- 대량 데이터 처리 시 객체 참조 최소화
- 스트리밍 방식 (eachRow) 활용
- 조기 타입 변환으로 GC 부담 감소

---

## 기술 스택

- **Backend**: NestJS + TypeScript
- **Excel 파싱**: ExcelJS
- **HWPX 처리**: adm-zip + fast-xml-parser
- **AI**: Google Gemini API (gemini-2.0-flash)
- **아키텍처**: DDD + Clean Architecture
- **패턴**: LangGraph 스타일 병렬 파이프라인

---

## 참고 자료

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [ExcelJS GitHub](https://github.com/exceljs/exceljs)
- [HWPX 파일 형식 분석](https://www.hancom.com/)
- [Gemini API Documentation](https://ai.google.dev/docs)
