# Excel Report Formatter

Excel 보고서 템플릿에 원본 데이터를 자동으로 매핑하여 완성된 보고서를 생성하는 웹 애플리케이션

## 주요 기능

- **템플릿 등록**: Excel 템플릿을 업로드하고 컬럼 매핑을 설정
- **자동 분석**: 템플릿의 헤더, 수식 등을 자동으로 분석
- **데이터 변환**: CSV 또는 Excel 데이터를 템플릿에 맞춰 자동 변환
- **즉시 다운로드**: 완성된 보고서를 즉시 다운로드

## 기술 스택

- **Next.js 14** (App Router, TypeScript)
- **React 18**
- **Tailwind CSS**
- **ExcelJS** (Excel 처리)
- **Papaparse** (CSV 파싱)

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 빌드
npm run build

# 프로덕션 실행
npm start
```

## 사용 방법

### 1. 템플릿 등록

1. 사이드바에서 "템플릿 등록" 메뉴 클릭
2. 템플릿 이름 입력
3. Excel 템플릿 파일 업로드
4. "분석하기" 버튼 클릭
5. 컬럼 매핑 설정 (원본 데이터의 필드명과 연결)
6. "등록하기" 버튼 클릭

### 2. 보고서 생성

1. 사이드바에서 "보고서 생성" 메뉴 클릭
2. 등록된 템플릿 선택
3. 원본 데이터 파일 업로드 (CSV 또는 Excel)
4. "변환하기" 버튼 클릭
5. 완성된 보고서 다운로드

## 컬럼 매핑 설정

- **데이터 컬럼**: 원본 데이터의 필드명을 입력
- **수식 컬럼**: `{row}` 플레이스홀더를 사용하여 수식 설정
  - 예: `=C{row}*D{row}` → 각 행에서 `=C2*D2`, `=C3*D3`...로 자동 변환

## 폴더 구조

```
excel-report-formatter/
├── app/
│   ├── page.tsx              # 메인 페이지
│   ├── layout.tsx            # 레이아웃
│   └── api/
│       ├── templates/        # 템플릿 CRUD API
│       ├── analyze-template/ # 템플릿 분석 API
│       └── process-data/     # 데이터 변환 API
├── components/
│   ├── TemplateUploader.tsx  # 템플릿 업로드 컴포넌트
│   ├── DataProcessor.tsx     # 데이터 변환 컴포넌트
│   └── TemplateList.tsx      # 템플릿 목록 컴포넌트
├── lib/
│   ├── types.ts              # TypeScript 타입
│   ├── excel-processor.ts    # Excel 처리 로직
│   └── file-storage.ts       # 파일 저장소
└── assets/
    ├── templates/            # 업로드된 템플릿 파일
    └── configs/              # 템플릿 설정 파일
```

## 배포

Vercel을 통해 간편하게 배포할 수 있습니다.

```bash
npx vercel
```

## 라이선스

MIT
