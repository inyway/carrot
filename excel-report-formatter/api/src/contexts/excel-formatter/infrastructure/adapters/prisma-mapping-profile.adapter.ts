/**
 * Prisma Mapping Profile Repository Adapter
 * MappingProfile 저장소의 Prisma 구현체
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import {
  MappingProfileRepositoryPort,
  MappingProfileEntity,
  CreateMappingProfileInput,
  UpdateMappingProfileInput,
} from '../../application/ports/mapping-profile-repository.port';
import type { FieldMapping } from '../../domain/value-objects/canonical-data.vo';

@Injectable()
export class PrismaMappingProfileAdapter implements MappingProfileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateMappingProfileInput): Promise<MappingProfileEntity> {
    const profile = await this.prisma.mappingProfile.create({
      data: {
        templateId: input.templateId,
        name: input.name,
        sourceType: input.sourceType,
        headerHash: input.headerHash ?? null,
        headerCount: input.headerCount ?? 0,
        sampleHeaders: input.sampleHeaders ? input.sampleHeaders : undefined,
        mappings: input.mappings as any,
        isDefault: input.isDefault ?? false,
      },
    });

    return this.toEntity(profile);
  }

  async findById(id: string): Promise<MappingProfileEntity | null> {
    const profile = await this.prisma.mappingProfile.findUnique({
      where: { id },
    });

    return profile ? this.toEntity(profile) : null;
  }

  async findByTemplateId(templateId: string, limit = 50): Promise<MappingProfileEntity[]> {
    const profiles = await this.prisma.mappingProfile.findMany({
      where: { templateId },
      orderBy: [
        { isDefault: 'desc' },
        { lastUsedAt: 'desc' },
        { usageCount: 'desc' },
      ],
      take: limit,
    });

    return profiles.map((p) => this.toEntity(p));
  }

  async findByHeaderHash(
    templateId: string,
    headerHash: string,
  ): Promise<MappingProfileEntity | null> {
    const profile = await this.prisma.mappingProfile.findFirst({
      where: {
        templateId,
        headerHash,
      },
      orderBy: [
        { isDefault: 'desc' },
        { usageCount: 'desc' },
      ],
    });

    return profile ? this.toEntity(profile) : null;
  }

  async findBySourceType(
    templateId: string,
    sourceType: string,
  ): Promise<MappingProfileEntity[]> {
    const profiles = await this.prisma.mappingProfile.findMany({
      where: {
        templateId,
        sourceType,
      },
      orderBy: [
        { isDefault: 'desc' },
        { usageCount: 'desc' },
      ],
    });

    return profiles.map((p) => this.toEntity(p));
  }

  async findDefault(
    templateId: string,
    sourceType?: string,
  ): Promise<MappingProfileEntity | null> {
    const profile = await this.prisma.mappingProfile.findFirst({
      where: {
        templateId,
        isDefault: true,
        ...(sourceType && { sourceType }),
      },
    });

    return profile ? this.toEntity(profile) : null;
  }

  async findRecentlyUsed(
    templateId: string,
    limit = 10,
  ): Promise<MappingProfileEntity[]> {
    const profiles = await this.prisma.mappingProfile.findMany({
      where: {
        templateId,
        lastUsedAt: { not: null },
      },
      orderBy: { lastUsedAt: 'desc' },
      take: limit,
    });

    return profiles.map((p) => this.toEntity(p));
  }

  async update(
    id: string,
    input: UpdateMappingProfileInput,
  ): Promise<MappingProfileEntity> {
    const profile = await this.prisma.mappingProfile.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.sourceType !== undefined && { sourceType: input.sourceType }),
        ...(input.mappings !== undefined && { mappings: input.mappings as any }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
      },
    });

    return this.toEntity(profile);
  }

  async incrementUsage(id: string): Promise<void> {
    await this.prisma.mappingProfile.update({
      where: { id },
      data: {
        usageCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  async setAsDefault(id: string): Promise<void> {
    // 먼저 해당 프로필 조회
    const profile = await this.prisma.mappingProfile.findUnique({
      where: { id },
      select: { templateId: true, sourceType: true },
    });

    if (!profile) {
      throw new Error(`MappingProfile not found: ${id}`);
    }

    // 트랜잭션으로 기존 기본값 해제 + 새 기본값 설정
    await this.prisma.$transaction([
      // 같은 템플릿 + 소스 타입의 기존 기본값 해제
      this.prisma.mappingProfile.updateMany({
        where: {
          templateId: profile.templateId,
          sourceType: profile.sourceType,
          isDefault: true,
        },
        data: { isDefault: false },
      }),
      // 새 기본값 설정
      this.prisma.mappingProfile.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.mappingProfile.delete({
      where: { id },
    });
  }

  // ============================================
  // Private Helper
  // ============================================

  private toEntity(profile: any): MappingProfileEntity {
    return {
      id: profile.id,
      templateId: profile.templateId,
      name: profile.name,
      sourceType: profile.sourceType,
      headerHash: profile.headerHash,
      headerCount: profile.headerCount,
      sampleHeaders: profile.sampleHeaders as string[] | null,
      mappings: profile.mappings as FieldMapping[],
      usageCount: profile.usageCount,
      lastUsedAt: profile.lastUsedAt,
      isDefault: profile.isDefault,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
