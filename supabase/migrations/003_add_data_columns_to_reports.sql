-- reports 테이블에 데이터 저장 컬럼 추가
ALTER TABLE reports ADD COLUMN IF NOT EXISTS headers JSONB DEFAULT '[]';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS preview_data JSONB DEFAULT '[]';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS full_data JSONB DEFAULT '[]';
