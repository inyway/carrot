# Architecture Document

Excel Report Formatter 시스템 아키텍처 문서

## 개요

이 시스템은 **Multi-Agent Orchestration** 패턴을 적용한 문서 자동화 플랫폼입니다.
복잡한 Excel 헤더 구조와 HWPX 템플릿을 자동으로 분석하고, AI 기반 매핑을 통해 대량의 보고서를 일괄 생성합니다.

---

## 시스템 구성

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Layer                                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Next.js Frontend (Port 3000)                    │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │   │
│  │  │  템플릿 관리  │  │ HWPX 변환기 │  │  보고서 생성 │  │  매핑 설정  │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API Layer                                       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      NestJS Backend (Port 4000)                      │   │
│  │                                                                      │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │                     Interface Layer (HTTP)                      │ │   │
│  │  │  ┌──────────────────┐  ┌──────────────────┐                   │ │   │
│  │  │  │ HwpxController   │  │UnifiedGenerateCtrl│                   │ │   │
│  │  │  │ /api/hwpx/*      │  │ /api/generate     │                   │ │   │
│  │  │  └──────────────────┘  └──────────────────┘                   │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  │                              │                                       │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │                    Application Layer                            │ │   │
│  │  │                                                                 │ │   │
│  │  │  ┌─────────────────────────────────────────────────────────┐  │ │   │
│  │  │  │                  Agent Subsystem                         │  │ │   │
│  │  │  │  ┌─────────────────┐  ┌─────────────────────────────┐   │  │ │   │
│  │  │  │  │ Orchestrator    │  │ HeaderDetectionAgent         │   │  │ │   │
│  │  │  │  │    Agent        │─▶│ - detectMetaRows()           │   │  │ │   │
│  │  │  │  │                 │  │ - detectHeaderRows()         │   │  │ │   │
│  │  │  │  │                 │  │ - extractMergeInfo()         │   │  │ │   │
│  │  │  │  │                 │  │ - generateHierarchicalCols() │   │  │ │   │
│  │  │  │  └─────────────────┘  └─────────────────────────────┘   │  │ │   │
│  │  │  └─────────────────────────────────────────────────────────┘  │ │   │
│  │  │                              │                                  │ │   │
│  │  │  ┌─────────────────────────────────────────────────────────┐  │ │   │
│  │  │  │                  Service Subsystem                       │  │ │   │
│  │  │  │  ┌─────────────────┐  ┌─────────────────┐               │  │ │   │
│  │  │  │  │HwpxMappingGraph │  │ UnifiedGenerator │               │  │ │   │
│  │  │  │  │    Service      │  │    Service       │               │  │ │   │
│  │  │  │  │ - runRuleBased()│  │ - generateHwpx() │               │  │ │   │
│  │  │  │  │ - runAiTemplate()│ │ - generateExcel()│               │  │ │   │
│  │  │  │  │ - runAiExcel()  │  │ - generateCsv()  │               │  │ │   │
│  │  │  │  │ - mergeMappings()│ └─────────────────┘               │  │ │   │
│  │  │  │  └─────────────────┘                                     │  │ │   │
│  │  │  │                              │                           │  │ │   │
│  │  │  │  ┌─────────────────────────────────────────────────┐    │  │ │   │
│  │  │  │  │              HwpxGeneratorService                │    │  │ │   │
│  │  │  │  │  - analyzeTemplate()  - extractSmartSheetData() │    │  │ │   │
│  │  │  │  │  - generateFiles()    - fillTableCell()         │    │  │ │   │
│  │  │  │  └─────────────────────────────────────────────────┘    │  │ │   │
│  │  │  └─────────────────────────────────────────────────────────┘  │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            External Services                                 │
│  ┌─────────────────┐  ┌─────────────────┐                                   │
│  │  Google Gemini  │  │    Supabase     │                                   │
│  │      API        │  │   (Optional)    │                                   │
│  └─────────────────┘  └─────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Agent 아키텍처

### Agent vs Service 구분

| 구분 | Agent | Service |
|-----|-------|---------|
| **역할** | 자율적 판단 + 전략 선택 | 고정된 로직 실행 |
| **입출력** | 상황에 따라 다름 | 고정된 인터페이스 |
| **예시** | HeaderDetectionAgent | HwpxGeneratorService |

### HeaderDetectionAgent

복잡한 Excel 헤더 구조를 자율적으로 분석하는 전문 Agent입니다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       HeaderDetectionAgent                               │
│                                                                         │
│  Input: Excel Buffer                                                    │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Step 1: detectMetaRows()                                          │ │
│  │   "Class Name : xxx" 패턴 감지                                     │ │
│  │   → metaRows: [1, 2, 3, 4, 5, 6, 7, 8]                           │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Step 2: detectHeaderRows()                                        │ │
│  │   점수 기반 메인 헤더 탐지 + 상하 추가 헤더 감지                    │ │
│  │   → headerRows: [1, 2, 3]                                         │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Step 3: extractMergeInfo()                                        │ │
│  │   병합 셀 정보 추출                                                │ │
│  │   → merges: [{startCol:17, endCol:22, text:"전문가 강연"}]        │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Step 4: generateHierarchicalColumns()                             │ │
│  │   다중 헤더 → 계층적 컬럼명 조합                                   │ │
│  │   "4. 프로그램 참여현황" + "전문가 강연" + "1회"                    │ │
│  │   → "4. 프로그램 참여현황_전문가 강연_1회"                         │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  Output: HeaderAnalysisResult                                           │
│    - headerRows: number[]                                               │
│    - dataStartRow: number                                               │
│    - columns: HierarchicalColumn[]                                      │
│    - metaInfo?: Record<string, string>                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### OrchestratorAgent

다중 Agent와 Service를 조율하는 오케스트레이터입니다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        OrchestratorAgent                                 │
│                                                                         │
│  Agent Registry:                                                        │
│    - HeaderDetectionAgent                                               │
│    - (Future: PdfTemplateAgent, DocxTemplateAgent)                      │
│                                                                         │
│  Orchestration Flow:                                                    │
│                                                                         │
│    1. HeaderDetectionAgent.analyze(excelBuffer)                         │
│       └─→ { headerRows, dataStartRow, columns }                         │
│                                                                         │
│    2. Promise.allSettled([                                              │
│         runRuleBasedMapping(columns),      // 규칙 기반                 │
│         runAiTemplateAnalysis(hwpxTable),  // AI 템플릿                 │
│         runAiExcelAnalysis(columns)        // AI Excel                  │
│       ])                                                                │
│       └─→ 병렬 실행, 실패해도 계속 진행                                  │
│                                                                         │
│    3. mergeMappings(allCandidates)                                      │
│       └─→ 투표 기반 최종 매핑 결정                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 매핑 파이프라인 (LangGraph 스타일)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HwpxMappingGraphService                               │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Stage 1: 병렬 데이터 추출                                          │ │
│  │   ┌─────────────┐       ┌─────────────────────────────┐           │ │
│  │   │ HWPX 분석    │       │ Excel 스마트 헤더 감지       │           │ │
│  │   │ (28×16 표)   │       │ (HeaderDetectionAgent)      │           │ │
│  │   └─────────────┘       └─────────────────────────────┘           │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Stage 2: 병렬 매핑 생성 (Promise.allSettled)                       │ │
│  │                                                                    │ │
│  │   ┌────────────┐  ┌────────────┐  ┌────────────┐                  │ │
│  │   │  Node 1    │  │  Node 2    │  │  Node 3    │                  │ │
│  │   │ 규칙 기반   │  │ AI 템플릿  │  │ AI Excel   │                  │ │
│  │   │  매핑      │  │   분석     │  │   분석     │                  │ │
│  │   └─────┬──────┘  └─────┬──────┘  └─────┬──────┘                  │ │
│  │         │               │               │                          │ │
│  │         ▼               ▼               ▼                          │ │
│  │     27 후보         26 후보         13 후보                         │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Stage 3: 병합 및 투표 (Node 4: Merge)                              │ │
│  │                                                                    │ │
│  │   같은 (row, col) 위치 → confidence 점수 합산                      │ │
│  │   최고 점수 후보 선택                                               │ │
│  │                                                                    │ │
│  │   예: (3,1) 성명 매핑                                               │ │
│  │       Rule: 0.9 + AI Template: 0.9 + AI Excel: 0.95 = 2.75        │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Stage 4: 최종 매핑 반환                                            │ │
│  │   MappingCandidate[] (38개 필드)                                   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 통합 생성 서비스

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    UnifiedGeneratorService                               │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Node 1: Format Detection                                          │ │
│  │   detectFormat(templateFileName)                                  │ │
│  │   .hwpx | .xlsx | .xls | .csv → 형식 결정                          │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Router Node: Conditional Branch                                   │ │
│  │                                                                   │ │
│  │   case 'hwpx'  ──► generateHwpx()  ──► HwpxGeneratorService      │ │
│  │   case 'xlsx'  ──► generateExcel() ──► ExcelJS + JSZip           │ │
│  │   case 'csv'   ──► generateCsv()   ──► String Buffer             │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Shared Node: applyMergeMappings()                                 │ │
│  │   모든 형식에 공통으로 MappingContext 적용                         │ │
│  │   fieldRelations: sourceFields → targetField 머지                 │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Output Node: GenerateResult                                       │ │
│  │   { buffer: Buffer, contentType: string, fileName: string }       │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 디렉토리 구조 (DDD)

```
api/src/contexts/excel-formatter/
├── application/                    # Application Layer
│   ├── agents/                     # Agent 패턴
│   │   ├── header-detection.agent.ts   # Excel 헤더 분석 Agent
│   │   ├── orchestrator.agent.ts       # 다중 Agent 조율
│   │   └── index.ts
│   │
│   ├── services/                   # Application Services
│   │   ├── hwpx-generator.service.ts   # HWPX 생성
│   │   ├── hwpx-mapping-graph.service.ts  # AI 매핑 파이프라인
│   │   ├── unified-generator.service.ts   # 통합 생성
│   │   └── utils/
│   │       └── excel-utils.ts      # Excel 유틸리티
│   │
│   └── ports/                      # Ports (Interface)
│       └── ai-mapping.port.ts
│
├── domain/                         # Domain Layer
│   └── value-objects/
│       └── column-mapping.vo.ts
│
├── infrastructure/                 # Infrastructure Layer
│   └── adapters/
│       ├── gemini-ai-mapping.adapter.ts  # Gemini API 어댑터
│       ├── hwpx-parser.adapter.ts        # HWPX 파싱
│       └── index.ts
│
└── interface/                      # Interface Layer
    └── http/
        ├── controllers/
        │   ├── hwpx.controller.ts         # /api/hwpx/*
        │   ├── unified-generate.controller.ts  # /api/generate
        │   └── index.ts
        └── dto/
            └── hwpx.dto.ts
```

---

## 데이터 흐름

### 1. HWPX 일괄 생성 플로우

```
User Upload (Template + Excel)
        │
        ▼
┌─────────────────┐
│ HwpxController  │
│ /api/hwpx/      │
│   ai-mapping    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ HwpxMappingGraphService │
│ - HeaderDetectionAgent  │ ◄─── Excel 헤더 분석
│ - runRuleBasedMapping   │
│ - runAiTemplateAnalysis │ ◄─── Gemini API
│ - runAiExcelAnalysis    │ ◄─── Gemini API
│ - mergeMappings         │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ MappingCandidate[]      │ (38개 필드 매핑)
└────────┬────────────────┘
         │
         ▼
┌─────────────────┐
│ HwpxController  │
│ /api/hwpx/      │
│   generate      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ HwpxGeneratorService    │
│ - extractSmartSheetData │ ◄─── HeaderDetectionAgent 사용
│ - generateFiles         │
│ - fillTableCell         │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ ZIP (383개 HWPX 파일)   │
│ 강나희.hwpx             │
│ 김동환.hwpx             │
│ ...                     │
└─────────────────────────┘
```

### 2. 통합 생성 플로우

```
User Upload (Any Template + Data)
        │
        ▼
┌──────────────────────────┐
│ UnifiedGenerateController│
│ /api/generate            │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ UnifiedGeneratorService  │
│                          │
│ detectFormat()           │
│         │                │
│    ┌────┴────┬───────┐   │
│    ▼         ▼       ▼   │
│  HWPX     Excel    CSV   │
│    │         │       │   │
│    ▼         ▼       ▼   │
│ Hwpx    Excel    CSV     │
│ Generator Generator Gen  │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ ZIP (N개 파일)           │
└──────────────────────────┘
```

---

## 주요 인터페이스

### HeaderAnalysisResult

```typescript
interface HeaderAnalysisResult {
  headerRows: number[];           // [1, 2, 3]
  dataStartRow: number;           // 4
  columns: HierarchicalColumn[];  // 계층적 컬럼 정보
  metaInfo?: Record<string, string>;
}

interface HierarchicalColumn {
  name: string;     // "4. 프로그램 참여현황_전문가 강연_1회"
  colIndex: number; // 17 (1-based)
  depth: number;    // 헤더 깊이
}
```

### MappingCandidate

```typescript
interface MappingCandidate {
  excelColumn: string;  // "성명"
  hwpxRow: number;      // 3
  hwpxCol: number;      // 1
  labelText: string;    // "성  명"
  confidence: number;   // 2.75 (투표 합산)
  source: string;       // "rule+ai_template+ai_excel"
  reason: string;       // 매핑 이유
}
```

### GenerateResult

```typescript
interface GenerateResult {
  buffer: Buffer;       // ZIP 버퍼
  contentType: string;  // "application/zip"
  fileName: string;     // "output_20241211.zip"
}
```

---

## 설계 원칙

### 1. Agent Pattern
- 복잡한 판단이 필요한 작업은 Agent로 분리
- Agent는 자율적으로 전략을 선택하고 실행

### 2. 장애 격리
- `Promise.allSettled`로 병렬 처리
- 한 노드 실패해도 다른 노드 결과로 계속 진행

### 3. 투표 기반 신뢰도
- 여러 방법의 결과를 합산하여 최종 결정
- 다수결보다 신뢰도 가중치 방식

### 4. 확장 용이성
- 새 Agent 등록으로 새 형식 지원
- Service 교체 없이 Agent만 추가

---

## 참고

- [기술 블로그](hwpx-auto-mapping-blog.md) - 개발 과정 상세 설명
- [LangGraph](https://langchain-ai.github.io/langgraph/) - 영감을 받은 프레임워크
