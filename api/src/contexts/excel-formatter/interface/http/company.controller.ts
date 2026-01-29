/**
 * Company Controller
 * 회사 관리 HTTP API
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { PrismaService } from '../../../../common/database/prisma.service';

class CreateCompanyRequest {
  @IsString()
  @IsNotEmpty()
  name: string;
}

@Controller('companies')
export class CompanyController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/companies
   * 회사 목록 조회
   */
  @Get()
  async getCompanies() {
    const companies = await this.prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: companies,
    };
  }

  /**
   * GET /api/companies/:id
   * 특정 회사 조회
   */
  @Get(':id')
  async getCompanyById(@Param('id') id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      throw new NotFoundException(`Company not found: ${id}`);
    }

    return {
      success: true,
      data: company,
    };
  }

  /**
   * POST /api/companies
   * 새 회사 생성
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCompany(@Body() body: CreateCompanyRequest) {
    // slug 자동 생성 (이름 기반 + 타임스탬프)
    const baseSlug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const company = await this.prisma.company.create({
      data: {
        name: body.name,
        slug,
      },
    });

    return {
      success: true,
      data: company,
    };
  }
}
