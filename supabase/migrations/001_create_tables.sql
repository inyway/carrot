-- Templates 테이블
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  sheet_name VARCHAR(255),
  header_row INTEGER DEFAULT 1,
  data_start_row INTEGER DEFAULT 2,
  file_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Template Columns 테이블 (템플릿의 컬럼 정보)
CREATE TABLE IF NOT EXISTS template_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES templates(id) ON DELETE CASCADE,
  column_name VARCHAR(255) NOT NULL,
  column_type VARCHAR(50) DEFAULT 'string',
  column_index INTEGER,
  is_required BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mapping History 테이블 (매핑 이력 저장)
CREATE TABLE IF NOT EXISTS mapping_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES templates(id) ON DELETE CASCADE,
  data_file_name VARCHAR(255),
  mappings JSONB NOT NULL,
  status VARCHAR(50) DEFAULT 'completed',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS (Row Level Security) 활성화
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE mapping_history ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽기 가능 (anon key 사용 시)
CREATE POLICY "Allow public read access on templates" ON templates
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert on templates" ON templates
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on templates" ON templates
  FOR UPDATE USING (true);

CREATE POLICY "Allow public delete on templates" ON templates
  FOR DELETE USING (true);

CREATE POLICY "Allow public read access on template_columns" ON template_columns
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert on template_columns" ON template_columns
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public delete on template_columns" ON template_columns
  FOR DELETE USING (true);

CREATE POLICY "Allow public read access on mapping_history" ON mapping_history
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert on mapping_history" ON mapping_history
  FOR INSERT WITH CHECK (true);

-- Storage bucket for template files
INSERT INTO storage.buckets (id, name, public)
VALUES ('templates', 'templates', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policy
CREATE POLICY "Allow public access to templates bucket" ON storage.objects
  FOR ALL USING (bucket_id = 'templates');
