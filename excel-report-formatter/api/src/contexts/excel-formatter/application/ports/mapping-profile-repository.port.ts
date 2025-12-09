/**
 * Mapping Profile Repository Port
 * 매핑 프로필 저장소 인터페이스
 */

import type { FieldMapping } from '../../domain/value-objects/canonical-data.vo';

// ============================================
// Entity
// ============================================

export interface MappingProfileEntity {
  id: string;
  templateId: string;
  name: string;
  sourceType: string;
  headerHash: string | null;
  headerCount: number;
  sampleHeaders: string[] | null;
  mappings: FieldMapping[];
  usageCount: number;
  lastUsedAt: Date | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Input DTOs
// ============================================

export interface CreateMappingProfileInput {
  templateId: string;
  name: string;
  sourceType: string;
  headerHash?: string;
  headerCount?: number;
  sampleHeaders?: string[];
  mappings: FieldMapping[];
  isDefault?: boolean;
}

export interface UpdateMappingProfileInput {
  name?: string;
  sourceType?: string;
  mappings?: FieldMapping[];
  isDefault?: boolean;
}

export interface FindMappingProfilesInput {
  templateId: string;
  sourceType?: string;
  headerHash?: string;
  limit?: number;
}

// ============================================
// Port Interface
// ============================================

export interface MappingProfileRepositoryPort {
  /**
   * 매핑 프로필 생성
   */
  create(input: CreateMappingProfileInput): Promise<MappingProfileEntity>;

  /**
   * ID로 조회
   */
  findById(id: string): Promise<MappingProfileEntity | null>;

  /**
   * 템플릿별 프로필 목록 조회
   */
  findByTemplateId(templateId: string, limit?: number): Promise<MappingProfileEntity[]>;

  /**
   * 헤더 해시로 정확한 매칭 조회
   */
  findByHeaderHash(templateId: string, headerHash: string): Promise<MappingProfileEntity | null>;

  /**
   * 소스 타입별 조회
   */
  findBySourceType(templateId: string, sourceType: string): Promise<MappingProfileEntity[]>;

  /**
   * 기본 프로필 조회
   */
  findDefault(templateId: string, sourceType?: string): Promise<MappingProfileEntity | null>;

  /**
   * 최근 사용된 프로필 조회
   */
  findRecentlyUsed(templateId: string, limit?: number): Promise<MappingProfileEntity[]>;

  /**
   * 프로필 업데이트
   */
  update(id: string, input: UpdateMappingProfileInput): Promise<MappingProfileEntity>;

  /**
   * 사용 횟수 증가 + 마지막 사용 시간 업데이트
   */
  incrementUsage(id: string): Promise<void>;

  /**
   * 기본 프로필 설정 (다른 프로필의 기본값 해제)
   */
  setAsDefault(id: string): Promise<void>;

  /**
   * 프로필 삭제
   */
  delete(id: string): Promise<void>;
}

export const MAPPING_PROFILE_REPOSITORY_PORT = Symbol('MAPPING_PROFILE_REPOSITORY_PORT');
