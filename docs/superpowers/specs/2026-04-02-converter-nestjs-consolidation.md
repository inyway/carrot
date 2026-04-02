# Converter Routes → NestJS 통합 스펙

## 목표

Next.js API Route의 converter 로직을 NestJS로 통합하고, Next.js route는 얇은 프록시로 교체한다.

## 현재 상태

### Next.js converter routes (Vercel)

| Route | 줄수 | 역할 |
|---|---|---|
| `converter/analyze` | 251 | 파일 분석 (헤더, 컬럼, 미리보기) |
| `converter/ai-mapping` | 1207 | 5-phase 컬럼 매칭 알고리즘 |
| `converter/generate` | 815 | 템플릿 기반 보고서 생성 |
| `converter/attendance-generate` | 807 | 출석 보고서 생성 |
| `converter/convert` | 443 | 포맷 변환 (이미 NestJS 프록시) |

### NestJS (Render, prefix: `/api`)

| 컨트롤러 | 엔드포인트 | 상태 |
|---|---|---|
| `unified-generate.controller` | `POST /api/generate`, `POST /api/generate/analyze` | ✅ generate + analyze 있음 |
| `attendance-report.controller` | `POST /api/attendance/generate` | ✅ 있음 (LangGraph 기반) |
| `hwpx.controller` | `POST /api/hwpx/*` | ✅ hwpx 전용 |
| — | converter용 ai-mapping | ❌ **없음** |

### NestJS 유틸리티 (`excel-utils.ts`)

| 함수 | 존재 |
|---|---|
| `findSmartHeaderRow()` | ✅ |
| `extractCellValue()` / `getCellText()` | ✅ |
| `extractExcelData()` / `extractCsvData()` / `extractJsonData()` | ✅ |
| `detectMultiRowHeaders()` | ❌ |
| `mergePairedRows()` | ❌ |
| `isRepeatedHeaderOrMetadata()` | ❌ |

## 변경 범위

### Phase 1: NestJS에 누락 기능 추가

**1-1. `excel-utils.ts`에 유틸 함수 3개 추가**
- `detectMultiRowHeaders()` — Next.js `cell-value-utils.ts`에서 복사
- `mergePairedRows()` — Next.js `cell-value-utils.ts`에서 복사
- `isRepeatedHeaderOrMetadata()` — Next.js `cell-value-utils.ts`에서 복사

소스: `lib/cell-value-utils.ts` (529줄)에서 해당 함수만 추출.
NestJS의 기존 `extractCellValue()` / `getCellText()` 사용하도록 import 조정.

**1-2. `generate/analyze` 엔드포인트에 metadata + mergePairedRows 추가**
- 현재 NestJS analyze는 컬럼/시트만 반환
- metadata 추출 (pre-header Key:Value 패턴) 추가
- mergePairedRows 적용한 preview 반환 추가

**1-3. Converter AI Mapping 엔드포인트 신규 추가**

새 컨트롤러: `converter-mapping.controller.ts`
엔드포인트: `POST /api/converter/ai-mapping`

서비스: `converter-mapping.service.ts`
- Next.js `ai-mapping/route.ts`의 5-phase 매칭 알고리즘 이식
- Phase 1: Identity columns (이름, 번호, 이메일 등)
- Phase 2: Attendance date columns (월+일 기반 매칭)
- Phase 3: Summary columns (출석, 결석, 출석률)
- Phase 4: Metadata columns (강사, 요일, 클래스 등)
- Phase 5: AI fallback (기존 `GeminiAiMappingAdapter` 활용)

포함할 상수:
- `METADATA_FIELD_MAP` (7개 필드)
- `SYNONYM_GROUPS` (20+ 그룹)
- `SUMMARY_FORMULA_KEYS` (6개)

Input/Output은 Next.js와 동일:
```typescript
// Input
{ templateColumns, dataColumns, templateSampleData?, dataSampleData?, dataMetadata? }
// Output
{ success, mappings: [{ templateField, dataColumn, confidence, reason, isMetadata?, metadataValue? }] }
```

### Phase 2: Next.js Route를 프록시로 교체

5개 route를 NestJS 프록시로 교체:

| Next.js Route | → NestJS 엔드포인트 |
|---|---|
| `converter/analyze` | `POST /api/generate/analyze` |
| `converter/ai-mapping` | `POST /api/converter/ai-mapping` |
| `converter/generate` | `POST /api/generate` |
| `converter/attendance-generate` | `POST /api/attendance/generate` |
| `converter/convert` | 이미 프록시 (변경 없음) |

프록시 패턴 (각 route 공통):
```typescript
const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const response = await fetch(`${API_BASE_URL}/target-endpoint`, {
    method: 'POST',
    body: formData,
  });
  // response를 그대로 forward
}
```

### Phase 3: 검증

- converter 페이지에서 analyze → ai-mapping → generate 플로우 테스트
- attendance-generate 플로우 테스트
- hwpx 플로우 (기존과 동일, 변경 없음)

## 변경하지 않는 것

- `converter/convert/route.ts` — 이미 프록시
- `app/converter/page.tsx` — fetch URL 변경 없음 (Next.js route 경로 유지)
- NestJS의 기존 generate/attendance 로직 — 건드리지 않음
- hwpx 관련 route/controller — 건드리지 않음

## 리스크

1. **analyze 응답 포맷 차이** — NestJS analyze가 `{ format, sheets?, columns? }`만 반환. Next.js는 `{ success, format, columns, preview, metadata, rowCount }`를 반환. Phase 1-2에서 NestJS analyze를 보강해야 Next.js 프론트엔드가 동작함. 보강 범위: metadata 추출, preview 데이터 (max 100행), rowCount, mergePairedRows 적용.
2. **generate 동기/비동기** — NestJS `POST /api/generate`가 동기 응답 (binary file) 반환하므로 Next.js와 호환됨. input도 동일 (template, data, mappings, sheetName, dataSheet, fileNameColumn). 리스크 낮음.
3. **ai-mapping의 AI 호출** — Next.js는 env에서 `GEMINI_API_KEY`/`OPENAI_API_KEY`를 직접 사용. NestJS는 `GeminiAiMappingAdapter`가 같은 env를 참조. Render 환경변수 확인 필요.
4. **attendance-generate input 차이** — Next.js는 FormData (template, data, mappings), NestJS는 `POST /api/attendance/generate`로 같은 FormData 수용. 다만 NestJS는 추가로 `companyId` 등 DB 기반 규칙을 사용할 수 있으므로, 프록시 시 기본값 fallback 동작 확인 필요.

## 파일 변경 목록

### 신규 생성
- `api/src/contexts/excel-formatter/interface/http/controllers/converter-mapping.controller.ts`
- `api/src/contexts/excel-formatter/application/services/converter-mapping.service.ts`

### 수정
- `api/src/contexts/excel-formatter/application/services/utils/excel-utils.ts` — 함수 3개 추가
- `api/src/contexts/excel-formatter/interface/http/controllers/unified-generate.controller.ts` — analyze 응답에 metadata/preview 추가
- `api/src/contexts/excel-formatter/excel-formatter.module.ts` — 새 컨트롤러/서비스 등록
- `app/api/converter/analyze/route.ts` — 프록시로 교체 (251줄 → ~30줄)
- `app/api/converter/ai-mapping/route.ts` — 프록시로 교체 (1207줄 → ~30줄)
- `app/api/converter/generate/route.ts` — 프록시로 교체 (815줄 → ~30줄)
- `app/api/converter/attendance-generate/route.ts` — 프록시로 교체 (807줄 → ~30줄)
