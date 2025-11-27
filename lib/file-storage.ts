import fs from 'fs/promises';
import path from 'path';
import { TemplateConfig, TemplateListItem } from './types';

const ASSETS_DIR = path.join(process.cwd(), 'assets');
const TEMPLATES_DIR = path.join(ASSETS_DIR, 'templates');
const CONFIGS_DIR = path.join(ASSETS_DIR, 'configs');

// 디렉토리 확인 및 생성
async function ensureDirectories(): Promise<void> {
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
  await fs.mkdir(CONFIGS_DIR, { recursive: true });
}

// 템플릿 파일 저장
export async function saveTemplateFile(id: string, buffer: Buffer): Promise<void> {
  await ensureDirectories();
  const filePath = path.join(TEMPLATES_DIR, `${id}.xlsx`);
  await fs.writeFile(filePath, buffer);
}

// 템플릿 설정 저장
export async function saveTemplateConfig(config: TemplateConfig): Promise<void> {
  await ensureDirectories();
  const filePath = path.join(CONFIGS_DIR, `${config.templateId}.json`);
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

// 템플릿 파일 로드
export async function loadTemplateFile(id: string): Promise<Buffer> {
  const filePath = path.join(TEMPLATES_DIR, `${id}.xlsx`);
  return fs.readFile(filePath);
}

// 템플릿 설정 로드
export async function loadTemplateConfig(id: string): Promise<TemplateConfig> {
  const filePath = path.join(CONFIGS_DIR, `${id}.json`);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

// 모든 템플릿 목록 가져오기
export async function getAllTemplates(): Promise<TemplateListItem[]> {
  await ensureDirectories();

  try {
    const files = await fs.readdir(CONFIGS_DIR);
    const templates: TemplateListItem[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(CONFIGS_DIR, file), 'utf-8');
        const config: TemplateConfig = JSON.parse(content);
        templates.push({
          id: config.templateId,
          name: config.name,
          fileName: config.fileName,
          createdAt: config.createdAt,
        });
      }
    }

    // 최신순 정렬
    templates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return templates;
  } catch {
    return [];
  }
}

// 템플릿 삭제
export async function deleteTemplate(id: string): Promise<void> {
  const templatePath = path.join(TEMPLATES_DIR, `${id}.xlsx`);
  const configPath = path.join(CONFIGS_DIR, `${id}.json`);

  try {
    await fs.unlink(templatePath);
  } catch {
    // 파일이 없어도 무시
  }

  try {
    await fs.unlink(configPath);
  } catch {
    // 파일이 없어도 무시
  }
}

// 템플릿 존재 여부 확인
export async function templateExists(id: string): Promise<boolean> {
  try {
    await fs.access(path.join(CONFIGS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
