# Excel Report Formatter

Excel/HWPX 템플릿에 데이터를 자동 매핑하여 대량의 보고서를 일괄 생성하는 AI 기반 문서 자동화 시스템

## 주요 기능

### 1. AI 자동 매핑
- **Gemini AI 기반** 템플릿-데이터 필드 자동 매핑
- **다중 전략 투표 시스템**: 규칙 기반 + AI 템플릿 분석 + AI 시맨틱 매칭
- **복잡한 Excel 헤더 자동 처리**: 다중 행 헤더, 병합 셀, 메타 행 감지

### 2. 템플릿 지원
- **HWPX** (한글 문서): 표 구조 자동 분석 및 데이터 삽입
- **Excel** (.xlsx, .xls): 템플릿 양식 유지하며 데이터 채우기
- **CSV**: 간단한 데이터 변환

### 3. 일괄 생성
- 데이터 행 수만큼 개별 파일 자동 생성
- 한글 파일명 지원 (예: `강나희.hwpx`, `김철수.xlsx`)
- ZIP 압축 다운로드

### 4. Agent 기반 아키텍처
- **HeaderDetectionAgent**: 복잡한 Excel 헤더 구조 자율 분석
- **OrchestratorAgent**: 다중 Agent 협업 조율
- **병렬 처리**: Promise.allSettled로 장애 격리

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ 템플릿 관리  │  │  데이터 매핑  │  │  보고서 생성 │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Backend (NestJS)                            │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    OrchestratorAgent                          │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐ │ │
│  │  │HeaderDetection  │  │  AI Mapping     │  │ Rule-based    │ │ │
│  │  │     Agent       │  │    Nodes        │  │   Mapping     │ │ │
│  │  └─────────────────┘  └─────────────────┘  └───────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                 UnifiedGeneratorService                       │ │
│  │     HWPX Generator  │  Excel Generator  │  CSV Generator      │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## 기술 스택

### Frontend
- **Next.js 14** (App Router)
- **React 18** + TypeScript
- **Tailwind CSS**

### Backend
- **NestJS** + TypeScript
- **DDD + Clean Architecture**
- **Agent Pattern** (Multi-Agent Orchestration)

### 핵심 라이브러리
- **ExcelJS**: Excel 파싱 및 생성
- **adm-zip** + **fast-xml-parser**: HWPX 처리
- **JSZip**: ZIP 압축
- **Google Gemini API**: AI 매핑

## 설치 및 실행

### 1. 의존성 설치

```bash
# 프론트엔드
npm install

# 백엔드
cd api && npm install
```

### 2. 환경 변수 설정

```bash
# api/.env
GEMINI_API_KEY=your_gemini_api_key
PORT=4000
```

### 3. 개발 서버 실행

```bash
# 프론트엔드 (포트 3000)
npm run dev

# 백엔드 (포트 4000)
cd api && npm run start:dev
```

## API 엔드포인트

### 통합 생성 API
```
POST /api/generate
- template: 템플릿 파일 (hwpx, xlsx, csv)
- data: 데이터 파일 (xlsx, csv)
- mappings: 매핑 정보 JSON
- fileNameColumn: 출력 파일명에 사용할 컬럼

Response: ZIP 파일 (application/zip)
```

### HWPX 전용 API
```
POST /api/hwpx/analyze     # 템플릿 분석
POST /api/hwpx/ai-mapping  # AI 자동 매핑
POST /api/hwpx/generate    # HWPX 일괄 생성
GET  /api/hwpx/excel-columns  # Excel 컬럼 추출
```

## 프로젝트 구조

```
excel-report-formatter/
├── app/                          # Next.js Frontend
│   ├── page.tsx                  # 메인 페이지
│   ├── converter/                # HWPX 변환기 UI
│   └── api/                      # Next.js API Routes
│
├── api/                          # NestJS Backend
│   └── src/
│       └── contexts/
│           └── excel-formatter/
│               ├── application/
│               │   ├── agents/   # Agent 패턴
│               │   │   ├── header-detection.agent.ts
│               │   │   └── orchestrator.agent.ts
│               │   └── services/
│               │       ├── hwpx-generator.service.ts
│               │       ├── hwpx-mapping-graph.service.ts
│               │       └── unified-generator.service.ts
│               └── interface/
│                   └── http/
│                       └── controllers/
│
├── docs/                         # 문서
│   └── hwpx-auto-mapping-blog.md # 기술 블로그
│
└── components/                   # React 컴포넌트
```

## 사용 예시

### 1. HWPX 템플릿 + Excel 데이터 → 개인별 HWPX 파일

```bash
curl -X POST http://localhost:4000/api/hwpx/generate \
  -F "template=@개인이력카드.hwpx" \
  -F "excel=@직원명단.xlsx" \
  -F "mappings=[{\"excelColumn\":\"성명\",\"hwpxRow\":3,\"hwpxCol\":1}]" \
  -F "fileNameColumn=성명" \
  -o output.zip
```

### 2. Excel 템플릿 + Excel 데이터 → 개인별 Excel 파일

```bash
curl -X POST http://localhost:4000/api/generate \
  -F "template=@인사기록.xlsx" \
  -F "data=@직원목록.xlsx" \
  -F "mappings=[{\"templateField\":\"사원번호\",\"dataColumn\":\"번호\"}]" \
  -F "fileNameColumn=이름" \
  -o output.zip
```

## 성능

| 지표 | 결과 |
|-----|------|
| 383개 HWPX 파일 생성 | ~45초 |
| AI 매핑 정확도 | 100% (38개 필드) |
| 지원 데이터 크기 | 1000+ 행 |

## 블로그

개발 과정과 기술적 결정에 대한 상세 내용은 [기술 블로그](docs/hwpx-auto-mapping-blog.md)를 참고하세요.

- 1차~5차 시도 과정
- LangGraph 스타일 병렬 파이프라인
- Agent 기반 아키텍처로의 진화
- 메모리 최적화

## 라이선스

MIT
