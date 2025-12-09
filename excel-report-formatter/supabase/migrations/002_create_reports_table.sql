-- Reports 테이블 (저장된 매핑 보고서)
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  template_name VARCHAR(255) NOT NULL,
  data_file_name VARCHAR(255),
  mappings JSONB NOT NULL,
  row_count INTEGER DEFAULT 0,
  matched_count INTEGER DEFAULT 0,
  headers JSONB DEFAULT '[]',
  preview_data JSONB DEFAULT '[]',
  full_data JSONB DEFAULT '[]',
  status VARCHAR(50) DEFAULT 'saved',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS 활성화
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- 정책
CREATE POLICY "Allow public read access on reports" ON reports
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert on reports" ON reports
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on reports" ON reports
  FOR UPDATE USING (true);

CREATE POLICY "Allow public delete on reports" ON reports
  FOR DELETE USING (true);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_reports_template_id ON reports(template_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
