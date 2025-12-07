import type { TemplateStructureVO } from '../../domain/value-objects';

export interface CreateTemplateInput {
  companyId: string;
  name: string;
  description?: string;
  fileName: string;
  fileUrl?: string;
  structure: TemplateStructureVO;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  structure?: TemplateStructureVO;
  fileUrl?: string;
}

export interface CompanyInfo {
  id: string;
  name: string;
  slug: string;
}

export interface TemplateEntity {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  fileName: string;
  fileUrl: string | null;
  structure: TemplateStructureVO;
  createdAt: Date;
  updatedAt: Date;
  company?: CompanyInfo;
}

export interface TemplateRepositoryPort {
  create(input: CreateTemplateInput): Promise<TemplateEntity>;
  findById(id: string): Promise<TemplateEntity | null>;
  findByCompanyId(companyId: string): Promise<TemplateEntity[]>;
  findAll(): Promise<TemplateEntity[]>;
  findAllWithCompany(): Promise<TemplateEntity[]>;
  update(id: string, input: UpdateTemplateInput): Promise<TemplateEntity>;
  delete(id: string): Promise<void>;
}

export const TEMPLATE_REPOSITORY_PORT = Symbol('TEMPLATE_REPOSITORY_PORT');
