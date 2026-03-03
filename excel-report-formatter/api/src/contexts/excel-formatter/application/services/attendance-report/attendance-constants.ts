/**
 * Attendance Report Constants
 * 출결 보고서 상수 정의 (Next.js route.ts에서 포팅)
 */

/** 동의어 그룹 - 한국어/영어 컬럼 매칭용 */
export const SYNONYM_GROUPS: string[][] = [
  ['이름', '성명', '한글이름', '성함', 'name', 'full_name', '이름(한글)', '직원명', '사원명', '참가자명', '학생명'],
  ['번호', 'No', 'No.', '순번', '연번', 'number', 'num', '#', '순서'],
  ['이메일', 'email', 'e-mail', '전자메일', '메일', '이메일주소', 'email_address'],
  ['전화번호', '연락처', '핸드폰', '휴대폰', 'phone', 'tel', '전화', '폰번호', '핸드폰번호', '휴대전화'],
  ['부서', '부서명', 'department', 'dept', '소속', '소속부서'],
  ['직급', '직위', '직책', 'position', 'title', 'rank', '직함'],
  ['날짜', '일자', 'date', '기준일', '작성일', '등록일', '일시'],
  ['금액', '비용', '가격', '단가', 'price', 'amount', 'cost', '매출', '매출액', '판매금액'],
  ['수량', '개수', '건수', 'quantity', 'qty', 'count', '갯수'],
  ['주소', '주소지', 'address', '거주지', '소재지'],
  ['회사', '회사명', '업체', '업체명', '거래처', 'company', '기관', '기관명', '소속기관'],
  ['출석', '출결', '참석', 'attendance', '출석률', '출결현황', '참석여부'],
  ['점수', '성적', '평점', 'score', 'grade', '등급', '평가'],
  ['비고', '메모', '기타', '참고', 'note', 'notes', 'memo', 'remark', '비고사항'],
  ['시작일', '시작', '시작날짜', 'start', 'start_date', '개시일', '시작일자'],
  ['종료일', '종료', '마감일', 'end', 'end_date', '완료일', '종료일자', '마감'],
  ['기간', '주차', '회차', '월회차', 'week', 'period', '차수'],
  ['합계', '총계', '소계', 'total', 'sum', '총합'],
  ['평균', '평균값', 'average', 'avg', '평균치'],
  ['상품', '상품명', '제품', '제품명', '품명', '품목', 'product', 'item', '물품'],
  ['카테고리', '분류', '구분', 'category', '종류', '유형', 'type'],
  ['생년월일', '생일', 'birthday', 'birth_date', 'dob'],
  ['성별', '성', 'gender', 'sex'],
  ['ID', '아이디', 'id', 'identifier', '사번', '학번', '사원번호'],
  ['영문이름', '영문명', '영어이름', 'english_name', 'eng_name', 'name_en'],
];

/** 메타데이터 필드 매핑 (한국어 키 -> 영어/한국어 별칭) */
export const METADATA_FIELD_MAP: Record<string, string[]> = {
  '강사': ['Teacher Name', 'Teacher', '강사명', '강사'],
  '요일': ['Class Day', 'Day', '요일', '수업요일'],
  '진행시간': ['Class Time', 'Time', '시간', '수업시간', '진행시간'],
  '클래스': ['Class Name', 'Class', '클래스', '반명', '클래스명'],
  '프로그램': ['Book Name', 'Program', '교재', '프로그램', '교재명'],
  '법인': ['Company', '법인', '회사', '기업명'],
  '레벨': ['Level', '레벨', '수준'],
};

/** 파이프라인 단계별 진행률 */
export const PIPELINE_PROGRESS = {
  PARSE: { start: 0, end: 20, label: 'Excel 파싱' },
  MAP: { start: 20, end: 40, label: '컬럼 매핑' },
  TRANSFORM: { start: 40, end: 60, label: '데이터 변환' },
  CALCULATE: { start: 60, end: 80, label: '출결 계산' },
  RENDER: { start: 80, end: 100, label: '보고서 생성' },
} as const;
