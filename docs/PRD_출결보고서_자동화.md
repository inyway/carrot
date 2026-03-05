# PRD: 출결 보고서 자동화 시스템

> **문서 버전**: 1.0  
> **작성일**: 2026-02-05  
> **상태**: Draft (추가 파일 대기 중)

---

## 1. 개요

### 1.1 목적
ITM(교육 관리 시스템)에서 추출한 Raw Data를 고객사별 출결 보고서 포맷으로 자동 변환하는 시스템 개발.

### 1.2 범위
| 고객사 | 포맷명 | 입력 | 출력 |
|--------|--------|------|------|
| 쿠팡 | 포맷1 | Raw1, Raw2 | 쿠팡 출결 파일 |
| 네이버 | 포맷2 | Raw1, Raw2 | 네이버 출결 파일 |
| KT&G (임원어학) | 포맷3 | Raw1, Raw2 | 임원어학 출결 파일 |
| (추후) | 근태 정리 | TBD | TBD |

---

## 2. 용어 정의

### 2.1 출결 표기 기호
| 기호 | 의미 | 설명 |
|------|------|------|
| **Y** | 출석 (Yes) | 정상 출석 |
| **N** | 결석 (No) | 무단 결석 |
| **C** | 당일캔슬 (Cancel) | 수업 당일 취소 |
| **L** | 지각 (Late) | 지각 출석 |
| **BZ** | 출장 (Business) | 업무상 출장으로 인한 결석 |
| **VA** | 휴가 (Vacation) | 휴가로 인한 결석 |
| **-** | 해당없음 | 해당 요일에 수업 없음 |

### 2.2 출석 인정 기준
```
출석 = Y + L + (선택적: BZ, VA)
```
- **기본 출석**: Y(출석) + L(지각)
- **공결 인정**: BZ(출장), VA(휴가) - 고객사별로 출석 인정 여부가 다름

### 2.3 출석률 계산
```
실출석률 = (Y + L) / 총 수업일 × 100%
공결포함 출석률 = (Y + L + BZ + VA) / 총 수업일 × 100%
```

---

## 3. 데이터 구조 분석

### 3.1 Raw Data (ITM 추출) - v1

**파일명**: `(Raw data) TotalClassList.xlsx`

**구조**:
```
행 1: 프로젝트명 (예: "쿠팡 25-2 (KO)") - 전체 폭 merged
행 2: "Class Name :" - 전체 폭 merged
행 3: "Book Name :" - 전체 폭 merged  
행 4: "Class Time :" - 전체 폭 merged
행 5: "Class Day :" - 전체 폭 merged
행 6: "Teacher Name :" - 전체 폭 merged
행 7: "Manager Name :" - 전체 폭 merged
행 8: "Progress Rate :" - 전체 폭 merged
행 9: 헤더 - 월 (예: "4월", "5월")
행 10: 헤더 - 회차 (예: "1회차", "2회차")
행 11: 헤더 - 날짜+요일 (예: "14 (Mo)", "16 (We)")
행 12~: 데이터 행
```

**컬럼 구조**:
| 컬럼 | 내용 | 예시 |
|------|------|------|
| A | No. | 1, 2, 3... |
| B | 한글이름 | 홍길동 |
| C | 영문이름 | Hong Gildong |
| D | 이메일 | hong@company.com |
| E~ | 출결 (날짜별) | Y, N, C, BZ, VA, L |

### 3.2 Raw Data v2 (추가 예정)

> ⚠️ **대기 중**: 파일 공유 필요

### 3.3 포맷1: 쿠팡 출결

**파일명**: `(포맷1) 쿠팡 출결 파일.xlsx`

**시트 구성**:
1. `3-1. 출결(영어그룹)` - 그룹 수업 출결
2. `3-2. 출결(영어일대일)` - 1:1 수업 출결

**시트 1: 영어그룹 구조**:
```
행 1: 프로젝트명 (예: "Coupang 25-4") - merged
행 2: 구분 라벨 ("구분", "실출결", "공결출결")
행 3: 월수그룹 출결평균 + 수식
행 4: 화목그룹 출결평균 + 수식
행 5: (빈 행)
행 6-9: 다중 헤더 (4행)
  - 행 6: No.|법인|요일|클래스|레벨|프로그램|강사|진행시간|이름|1 Week|1 Week|...
  - 행 7: (동일)|...|회차 번호 (1, 2, 3...)
  - 행 8: (동일)|...|날짜 (월수 - 09월 29일...)
  - 행 9: (동일)|...|날짜 (화목 - 09월 30일...)
행 10~: 데이터 행
```

**노란색 영역 (필수 매핑 대상)**:
| 항목 | 위치 | Raw 소스 |
|------|------|----------|
| 클래스명 | D열 | Class Name |
| 강사명 | G열 | Teacher Name |
| 요일 | C열 | Class Day (수식: LEFT(D,2)) |
| 진행시간 | H열 | Class Time |
| 학습자명 | I열 | 한글이름 |
| 날짜 | J열~ (행 8-9) | 날짜 헤더 |
| 출결 | J열~ (데이터) | 출결 데이터 |

**우측 계산 영역**:
| 항목 | 수식 예시 |
|------|----------|
| 출석 일수 | COUNTIF 범위에서 "Y" + "L" 카운트 |
| 결석 일수 | COUNTIF "N" |
| 당일캔슬 | COUNTIF "C" |
| 출석률 | 출석일수 / 총수업일 |

### 3.4 포맷2: 네이버 출결

> ⚠️ **대기 중**: 파일 공유 필요

### 3.5 포맷3: KT&G 임원어학 출결

> ⚠️ **대기 중**: 파일 공유 필요

---

## 4. 기능 요구사항

### 4.1 핵심 기능 (P0 - 필수)

#### FR-001: Raw Data 파싱
- Raw v1 파일 업로드 및 구조 인식
- 다중 헤더 행 (월, 회차, 날짜) 파싱
- 클래스 메타데이터 추출 (Class Name, Teacher Name 등)

#### FR-002: 포맷1 (쿠팡) 출력
- 노란색 영역 데이터 정확 매핑:
  - [ ] 클래스명
  - [ ] 강사명
  - [ ] 요일
  - [ ] 시간
  - [ ] 학습자명
  - [ ] 날짜
  - [ ] 출결 (Y/N/C/L/BZ/VA)

#### FR-003: 포맷2 (네이버) 출력
- (파일 분석 후 상세화)

#### FR-004: 포맷3 (KT&G) 출력
- (파일 분석 후 상세화)

### 4.2 계산 기능 (P1 - 중요)

#### FR-010: 출석률 계산
```typescript
interface AttendanceStats {
  totalDays: number;        // 총 수업일
  attended: number;         // Y + L
  absent: number;           // N
  canceled: number;         // C
  businessTrip: number;     // BZ
  vacation: number;         // VA
  late: number;             // L
  
  // 계산
  realAttendanceRate: number;     // (Y + L) / totalDays
  officialAttendanceRate: number; // (Y + L + BZ + VA) / totalDays
}
```

#### FR-011: BZ/VA 출석 인정 옵션
```typescript
interface AttendanceConfig {
  countBZAsAttendance: boolean;  // 출장을 출석으로 인정
  countVAAsAttendance: boolean;  // 휴가를 출석으로 인정
}
```
- 고객사별 설정 저장 필요

### 4.3 Raw Data v2 지원 (P1)

#### FR-020: Raw v2 파싱
- (파일 분석 후 상세화)

---

## 5. 매핑 규칙

### 5.1 Raw → 포맷1 (쿠팡) 매핑

| Raw 필드 | 포맷1 컬럼 | 변환 규칙 |
|----------|-----------|----------|
| Class Name (행2 merged) | D열 "클래스" | 직접 매핑 |
| Teacher Name (행6 merged) | G열 "강사" | 직접 매핑 |
| Class Day (행5 merged) | C열 "요일" | "월수" or "화목" 추출 |
| Class Time (행4 merged) | H열 "진행시간" | 직접 매핑 |
| 한글이름 (B열) | I열 "이름" | 직접 매핑 |
| 날짜 헤더 (행11) | J열~ 헤더 | 날짜 포맷 변환 |
| 출결 데이터 | J열~ 데이터 | 기호 그대로 |

### 5.2 요일 추출 로직
```typescript
function extractDayType(classDay: string): '월수' | '화목' | string {
  if (classDay.includes('Mo') && classDay.includes('We')) return '월수';
  if (classDay.includes('Tu') && classDay.includes('Th')) return '화목';
  return classDay;
}
```

### 5.3 날짜 포맷 변환
```typescript
// Raw: "14 (Mo)" → 포맷1: "09월 29일"
function formatDate(rawDate: string, month: string): string {
  const day = rawDate.match(/\d+/)?.[0];
  return `${month} ${day}일`;
}
```

---

## 6. UI/UX 요구사항

### 6.1 변환 플로우
```
1. Raw 파일 업로드
2. 대상 포맷 선택 (쿠팡/네이버/KT&G)
3. (옵션) BZ/VA 출석 인정 설정
4. 미리보기
5. 다운로드
```

### 6.2 미리보기 기능
- 노란색 영역 하이라이트
- 매핑 오류 표시 (빨간색)
- 출석률 계산 결과 표시

---

## 7. 기술 스펙

### 7.1 파서 확장
기존 `ExceljsParserAdapter` 활용:
- 다중 헤더 감지 (detectHeaderRows)
- Merged cell 값 추출 (getEffectiveCellValue)
- 출결 기호 인식

### 7.2 새로운 서비스
```typescript
// attendance-transform.service.ts
interface AttendanceTransformService {
  parseRawData(buffer: Buffer): Promise<RawAttendanceData>;
  transformToFormat(
    raw: RawAttendanceData, 
    format: 'coupang' | 'naver' | 'ktng',
    config: AttendanceConfig
  ): Promise<Buffer>;
}
```

### 7.3 데이터 모델
```typescript
interface RawAttendanceData {
  projectName: string;
  className: string;
  bookName: string;
  classTime: string;
  classDay: string;
  teacherName: string;
  managerName: string;
  
  // 헤더 정보
  months: string[];           // ["4월", "5월"]
  sessions: number[];         // [1, 2, 3...]
  dates: AttendanceDate[];    // [{day: 14, dayOfWeek: "Mo"}, ...]
  
  // 학습자 데이터
  students: StudentAttendance[];
}

interface StudentAttendance {
  no: number;
  koreanName: string;
  englishName: string;
  email: string;
  records: AttendanceRecord[];  // 날짜별 출결
}

interface AttendanceRecord {
  date: AttendanceDate;
  status: 'Y' | 'N' | 'C' | 'L' | 'BZ' | 'VA' | '-' | '';
}
```

---

## 8. 테스트 케이스

### 8.1 파싱 테스트
| ID | 케이스 | 입력 | 기대 결과 |
|----|--------|------|----------|
| T01 | Raw v1 파싱 | Raw 파일 | 메타데이터 + 학습자 데이터 추출 |
| T02 | 다중 헤더 인식 | Raw 파일 | 월, 회차, 날짜 정확 파싱 |
| T03 | 출결 기호 인식 | 출결 데이터 | Y/N/C/L/BZ/VA 정확 분류 |

### 8.2 변환 테스트
| ID | 케이스 | 입력 | 기대 결과 |
|----|--------|------|----------|
| T10 | Raw→쿠팡 | Raw + 포맷1 선택 | 노란색 영역 모두 매핑 |
| T11 | 출석률 계산 | 출결 데이터 | 수식 결과 일치 |
| T12 | BZ 출석 인정 | BZ 포함 + 옵션 ON | 출석률에 BZ 포함 |

### 8.3 검증 항목 (노란색 영역)
- [ ] 클래스명 정확성
- [ ] 강사명 정확성
- [ ] 요일 정확성
- [ ] 시간 정확성
- [ ] 학습자명 정확성
- [ ] 날짜 정확성
- [ ] 출결 기호 정확성

---

## 9. 마일스톤

### Phase 1: 쿠팡 포맷 완성
- [ ] Raw v1 파서 개발
- [ ] 포맷1 생성기 개발
- [ ] 노란색 영역 매핑 검증
- [ ] 계산 영역 수식 추가

### Phase 2: 네이버/KT&G 포맷 추가
- [ ] 포맷2 분석 및 개발
- [ ] 포맷3 분석 및 개발
- [ ] 공통 로직 리팩토링

### Phase 3: Raw v2 지원
- [ ] Raw v2 파서 개발
- [ ] 기존 포맷 호환성 검증

---

## 10. 미해결 사항 (대기 중)

| # | 항목 | 필요 정보 | 담당 |
|---|------|----------|------|
| 1 | 포맷2 (네이버) 파일 | .xlsx 파일 공유 필요 | 사용자 |
| 2 | 포맷3 (KT&G) 파일 | .xlsx 파일 공유 필요 | 사용자 |
| 3 | Raw Data v2 파일 | .xlsx 파일 공유 필요 | 사용자 |
| 4 | BZ/VA 인정 규칙 | 고객사별 상세 규칙 확인 | 사용자 |
| 5 | 근태 정리 포맷 | 추후 추가 예정 | TBD |

---

## 부록: 파일 분석 결과

### A. Raw Data 구조 상세

```
시트: TotalClassList (2)
행수: 68, 열수: 30
Merged cells: 88개

메타데이터 영역 (행 1-8): 전체 폭 merged
헤더 영역 (행 9-11): 3행 다중 헤더
데이터 영역 (행 12~): 학습자별 출결
```

### B. 포맷1 구조 상세

```
시트1: 3-1. 출결(영어그룹)
행수: 156, 열수: 43
Merged cells: 31개
헤더: 행 6-9 (4행)
데이터: 행 10~

시트2: 3-2. 출결(영어일대일)
행수: 350, 열수: 34
Merged cells: 29개
헤더: 행 5-8 (4행)
데이터: 행 9~
```
