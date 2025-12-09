import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../common/database';
import type {
  TemplateRepositoryPort,
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateEntity,
} from '../../application/ports';
import type { TemplateStructureVO } from '../../domain/value-objects';

@Injectable()
export class PrismaTemplateAdapter implements TemplateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateTemplateInput): Promise<TemplateEntity> {
    const template = await this.prisma.template.create({
      data: {
        companyId: input.companyId,
        name: input.name,
        description: input.description,
        fileName: input.fileName,
        fileUrl: input.fileUrl,
        structure: input.structure as unknown as Prisma.InputJsonValue,
      },
    });

    return this.mapToEntity(template);
  }

  async findById(id: string): Promise<TemplateEntity | null> {
    const template = await this.prisma.template.findUnique({
      where: { id },
    });

    if (!template) return null;

    return this.mapToEntity(template);
  }

  async findByCompanyId(companyId: string): Promise<TemplateEntity[]> {
    const templates = await this.prisma.template.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    return templates.map((t) => this.mapToEntity(t));
  }

  async findAll(): Promise<TemplateEntity[]> {
    const templates = await this.prisma.template.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return templates.map((t) => this.mapToEntity(t));
  }

  async findAllWithCompany(): Promise<TemplateEntity[]> {
    const templates = await this.prisma.template.findMany({
      include: { company: true },
      orderBy: { createdAt: 'desc' },
    });

    return templates.map((t) => this.mapToEntityWithCompany(t));
  }

  async update(id: string, input: UpdateTemplateInput): Promise<TemplateEntity> {
    const updateData: Prisma.TemplateUpdateInput = {};

    if (input.name) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.fileUrl !== undefined) updateData.fileUrl = input.fileUrl;
    if (input.structure) updateData.structure = input.structure as unknown as Prisma.InputJsonValue;

    const template = await this.prisma.template.update({
      where: { id },
      data: updateData,
    });

    return this.mapToEntity(template);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.template.delete({
      where: { id },
    });
  }

  private mapToEntity(template: {
    id: string;
    companyId: string;
    name: string;
    description: string | null;
    fileName: string;
    fileUrl: string | null;
    structure: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): TemplateEntity {
    return {
      id: template.id,
      companyId: template.companyId,
      name: template.name,
      description: template.description,
      fileName: template.fileName,
      fileUrl: template.fileUrl,
      structure: template.structure as TemplateStructureVO,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  private mapToEntityWithCompany(template: {
    id: string;
    companyId: string;
    name: string;
    description: string | null;
    fileName: string;
    fileUrl: string | null;
    structure: unknown;
    createdAt: Date;
    updatedAt: Date;
    company: { id: string; name: string; slug: string } | null;
  }): TemplateEntity {
    return {
      id: template.id,
      companyId: template.companyId,
      name: template.name,
      description: template.description,
      fileName: template.fileName,
      fileUrl: template.fileUrl,
      structure: template.structure as TemplateStructureVO,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      company: template.company
        ? {
            id: template.company.id,
            name: template.company.name,
            slug: template.company.slug,
          }
        : undefined,
    };
  }
}
