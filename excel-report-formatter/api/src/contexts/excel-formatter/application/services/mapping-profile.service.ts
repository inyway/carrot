/**
 * Mapping Profile Service
 * 매핑 프로필 관리 비즈니스 로직
 */

import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  MappingProfileRepositoryPort,
  MappingProfileEntity,
  CreateMappingProfileInput,
  UpdateMappingProfileInput,
} from '../ports/mapping-profile-repository.port';
import { MAPPING_PROFILE_REPOSITORY_PORT } from '../ports/mapping-profile-repository.port';
import type { FieldMapping } from '../../domain/value-objects/canonical-data.vo';

// ============================================
// Service DTOs
// ============================================

export interface CreateProfileDto {
  templateId: string;
  name: string;
  sourceType: string;
  headers?: string[];
  mappings: FieldMapping[];
  isDefault?: boolean;
}

export interface UpdateProfileDto {
  name?: string;
  sourceType?: string;
  mappings?: FieldMapping[];
  isDefault?: boolean;
}

export interface FindMatchingProfileResult {
  profile: MappingProfileEntity | null;
  matchType: 'exact' | 'source_type' | 'recent' | 'none';
  confidence: number;
}

// ============================================
// Service
// ============================================

@Injectable()
export class MappingProfileService {
  constructor(
    @Inject(MAPPING_PROFILE_REPOSITORY_PORT)
    private readonly profileRepository: MappingProfileRepositoryPort,
  ) {}

  /**
   * 새 매핑 프로필 생성
   */
  async createProfile(dto: CreateProfileDto): Promise<MappingProfileEntity> {
    const input: CreateMappingProfileInput = {
      templateId: dto.templateId,
      name: dto.name,
      sourceType: dto.sourceType,
      mappings: dto.mappings,
      isDefault: dto.isDefault,
    };

    // 헤더가 제공된 경우 해시 계산
    if (dto.headers && dto.headers.length > 0) {
      input.headerHash = this.computeHeaderHash(dto.headers);
      input.headerCount = dto.headers.length;
      input.sampleHeaders = dto.headers.slice(0, 10); // 미리보기용 최대 10개
    }

    return this.profileRepository.create(input);
  }

  /**
   * ID로 프로필 조회
   */
  async getProfileById(id: string): Promise<MappingProfileEntity> {
    const profile = await this.profileRepository.findById(id);
    if (!profile) {
      throw new NotFoundException(`MappingProfile not found: ${id}`);
    }
    return profile;
  }

  /**
   * 템플릿별 프로필 목록 조회
   */
  async getProfilesByTemplate(
    templateId: string,
    limit?: number,
  ): Promise<MappingProfileEntity[]> {
    return this.profileRepository.findByTemplateId(templateId, limit);
  }

  /**
   * 소스 타입별 프로필 조회
   */
  async getProfilesBySourceType(
    templateId: string,
    sourceType: string,
  ): Promise<MappingProfileEntity[]> {
    return this.profileRepository.findBySourceType(templateId, sourceType);
  }

  /**
   * 헤더 기반으로 최적 매핑 프로필 찾기
   * 우선순위: 1) 정확한 헤더 매칭 -> 2) 같은 소스 타입 기본값 -> 3) 최근 사용
   */
  async findMatchingProfile(
    templateId: string,
    headers: string[],
    sourceType?: string,
  ): Promise<FindMatchingProfileResult> {
    // 1. 정확한 헤더 해시 매칭
    const headerHash = this.computeHeaderHash(headers);
    const exactMatch = await this.profileRepository.findByHeaderHash(
      templateId,
      headerHash,
    );

    if (exactMatch) {
      return {
        profile: exactMatch,
        matchType: 'exact',
        confidence: 1.0,
      };
    }

    // 2. 같은 소스 타입의 기본 프로필
    if (sourceType && sourceType !== 'unknown') {
      const defaultProfile = await this.profileRepository.findDefault(
        templateId,
        sourceType,
      );

      if (defaultProfile) {
        // 헤더 개수가 비슷하면 신뢰도 높임
        const headerCountRatio =
          Math.min(headers.length, defaultProfile.headerCount) /
          Math.max(headers.length, defaultProfile.headerCount);

        return {
          profile: defaultProfile,
          matchType: 'source_type',
          confidence: 0.5 + headerCountRatio * 0.3, // 0.5 ~ 0.8
        };
      }
    }

    // 3. 최근 사용된 프로필
    const recentProfiles = await this.profileRepository.findRecentlyUsed(
      templateId,
      5,
    );

    if (recentProfiles.length > 0) {
      // 헤더 개수가 가장 비슷한 프로필 선택
      const bestMatch = recentProfiles.reduce((best, current) => {
        const bestDiff = Math.abs(best.headerCount - headers.length);
        const currentDiff = Math.abs(current.headerCount - headers.length);
        return currentDiff < bestDiff ? current : best;
      });

      const headerCountRatio =
        Math.min(headers.length, bestMatch.headerCount) /
        Math.max(headers.length, bestMatch.headerCount);

      return {
        profile: bestMatch,
        matchType: 'recent',
        confidence: 0.2 + headerCountRatio * 0.3, // 0.2 ~ 0.5
      };
    }

    // 매칭 없음
    return {
      profile: null,
      matchType: 'none',
      confidence: 0,
    };
  }

  /**
   * 프로필 업데이트
   */
  async updateProfile(
    id: string,
    dto: UpdateProfileDto,
  ): Promise<MappingProfileEntity> {
    // 존재 확인
    await this.getProfileById(id);

    const input: UpdateMappingProfileInput = {};
    if (dto.name !== undefined) input.name = dto.name;
    if (dto.sourceType !== undefined) input.sourceType = dto.sourceType;
    if (dto.mappings !== undefined) input.mappings = dto.mappings;
    if (dto.isDefault !== undefined) input.isDefault = dto.isDefault;

    return this.profileRepository.update(id, input);
  }

  /**
   * 프로필 사용 기록 (사용 시마다 호출)
   */
  async recordUsage(id: string): Promise<void> {
    await this.profileRepository.incrementUsage(id);
  }

  /**
   * 기본 프로필로 설정
   */
  async setAsDefault(id: string): Promise<void> {
    // 존재 확인
    await this.getProfileById(id);
    await this.profileRepository.setAsDefault(id);
  }

  /**
   * 프로필 삭제
   */
  async deleteProfile(id: string): Promise<void> {
    // 존재 확인
    await this.getProfileById(id);
    await this.profileRepository.delete(id);
  }

  /**
   * 매핑을 적용할 프로필 선택 후 사용 기록
   * (findMatchingProfile + recordUsage 조합)
   */
  async selectAndApplyProfile(
    templateId: string,
    headers: string[],
    sourceType?: string,
  ): Promise<FindMatchingProfileResult> {
    const result = await this.findMatchingProfile(
      templateId,
      headers,
      sourceType,
    );

    if (result.profile) {
      await this.recordUsage(result.profile.id);
    }

    return result;
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * 헤더 배열에서 고유 해시 생성
   * (순서 무관하게 정렬 후 해시)
   */
  private computeHeaderHash(headers: string[]): string {
    const normalized = headers
      .map((h) => h.trim().toLowerCase())
      .sort()
      .join('|');

    return createHash('md5').update(normalized).digest('hex');
  }
}
