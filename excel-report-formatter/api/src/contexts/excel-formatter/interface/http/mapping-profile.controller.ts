/**
 * Mapping Profile Controller
 * 매핑 프로필 HTTP API
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  MappingProfileService,
  CreateProfileDto,
  UpdateProfileDto,
} from '../../application/services/mapping-profile.service';
import type { FieldMapping } from '../../domain/value-objects/canonical-data.vo';

// ============================================
// Request DTOs
// ============================================

class CreateMappingProfileRequest {
  templateId: string;
  name: string;
  sourceType: string;
  headers?: string[];
  mappings: FieldMapping[];
  isDefault?: boolean;
}

class UpdateMappingProfileRequest {
  name?: string;
  sourceType?: string;
  mappings?: FieldMapping[];
  isDefault?: boolean;
}

class FindMatchingProfileRequest {
  templateId: string;
  headers: string[];
  sourceType?: string;
}

// ============================================
// Controller
// ============================================

@Controller('mapping-profiles')
export class MappingProfileController {
  constructor(private readonly profileService: MappingProfileService) {}

  /**
   * POST /api/mapping-profiles
   * 새 매핑 프로필 생성
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProfile(@Body() body: CreateMappingProfileRequest) {
    const dto: CreateProfileDto = {
      templateId: body.templateId,
      name: body.name,
      sourceType: body.sourceType,
      headers: body.headers,
      mappings: body.mappings,
      isDefault: body.isDefault,
    };

    const profile = await this.profileService.createProfile(dto);

    return {
      success: true,
      data: profile,
    };
  }

  /**
   * GET /api/mapping-profiles/:id
   * ID로 프로필 조회
   */
  @Get(':id')
  async getProfileById(@Param('id') id: string) {
    const profile = await this.profileService.getProfileById(id);

    return {
      success: true,
      data: profile,
    };
  }

  /**
   * GET /api/mapping-profiles?templateId=xxx
   * 템플릿별 프로필 목록 조회
   */
  @Get()
  async getProfiles(
    @Query('templateId') templateId: string,
    @Query('sourceType') sourceType?: string,
    @Query('limit') limit?: string,
  ) {
    let profiles;

    if (sourceType) {
      profiles = await this.profileService.getProfilesBySourceType(
        templateId,
        sourceType,
      );
    } else {
      profiles = await this.profileService.getProfilesByTemplate(
        templateId,
        limit ? parseInt(limit, 10) : undefined,
      );
    }

    return {
      success: true,
      data: profiles,
      count: profiles.length,
    };
  }

  /**
   * POST /api/mapping-profiles/find-matching
   * 헤더 기반 최적 매핑 프로필 찾기
   */
  @Post('find-matching')
  async findMatchingProfile(@Body() body: FindMatchingProfileRequest) {
    const result = await this.profileService.findMatchingProfile(
      body.templateId,
      body.headers,
      body.sourceType,
    );

    return {
      success: true,
      data: {
        profile: result.profile,
        matchType: result.matchType,
        confidence: result.confidence,
        hasMatch: result.profile !== null,
      },
    };
  }

  /**
   * POST /api/mapping-profiles/select-and-apply
   * 최적 프로필 찾기 + 사용 기록
   */
  @Post('select-and-apply')
  async selectAndApplyProfile(@Body() body: FindMatchingProfileRequest) {
    const result = await this.profileService.selectAndApplyProfile(
      body.templateId,
      body.headers,
      body.sourceType,
    );

    return {
      success: true,
      data: {
        profile: result.profile,
        matchType: result.matchType,
        confidence: result.confidence,
        hasMatch: result.profile !== null,
      },
    };
  }

  /**
   * PUT /api/mapping-profiles/:id
   * 프로필 업데이트
   */
  @Put(':id')
  async updateProfile(
    @Param('id') id: string,
    @Body() body: UpdateMappingProfileRequest,
  ) {
    const dto: UpdateProfileDto = {
      name: body.name,
      sourceType: body.sourceType,
      mappings: body.mappings,
      isDefault: body.isDefault,
    };

    const profile = await this.profileService.updateProfile(id, dto);

    return {
      success: true,
      data: profile,
    };
  }

  /**
   * PATCH /api/mapping-profiles/:id/usage
   * 사용 기록 증가
   */
  @Patch(':id/usage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordUsage(@Param('id') id: string) {
    await this.profileService.recordUsage(id);
  }

  /**
   * PATCH /api/mapping-profiles/:id/default
   * 기본 프로필로 설정
   */
  @Patch(':id/default')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setAsDefault(@Param('id') id: string) {
    await this.profileService.setAsDefault(id);
  }

  /**
   * DELETE /api/mapping-profiles/:id
   * 프로필 삭제
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProfile(@Param('id') id: string) {
    await this.profileService.deleteProfile(id);
  }
}
