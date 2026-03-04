import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Inject,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { IsString, IsOptional, IsArray, IsBoolean } from 'class-validator';
import { ATTENDANCE_RULE_REPOSITORY_PORT } from '../../../application/ports/attendance-rule-repository.port';
import type { AttendanceRuleRepositoryPort } from '../../../application/ports/attendance-rule-repository.port';

class CreateAttendanceRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attendedSymbols?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excusedSymbols?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  absentSymbols?: string[];

  @IsOptional()
  @IsBoolean()
  includeExcusedInAttendance?: boolean;

  @IsOptional()
  @IsString()
  totalSessionsField?: string | null;
}

class UpdateAttendanceRuleDto extends CreateAttendanceRuleDto {}

@Controller('companies/:companyId/attendance-rules')
export class AttendanceRuleController {
  constructor(
    @Inject(ATTENDANCE_RULE_REPOSITORY_PORT)
    private readonly ruleRepo: AttendanceRuleRepositoryPort,
  ) {}

  @Get()
  async list(@Param('companyId') companyId: string) {
    const rules = await this.ruleRepo.findByCompanyId(companyId);
    return { success: true, data: rules };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const rule = await this.ruleRepo.findById(id);
    if (!rule) throw new NotFoundException(`AttendanceRule not found: ${id}`);
    return { success: true, data: rule };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateAttendanceRuleDto,
  ) {
    const rule = await this.ruleRepo.create({ ...dto, companyId });
    return { success: true, data: rule };
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAttendanceRuleDto,
  ) {
    const existing = await this.ruleRepo.findById(id);
    if (!existing) throw new NotFoundException(`AttendanceRule not found: ${id}`);
    const rule = await this.ruleRepo.update(id, dto);
    return { success: true, data: rule };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    const existing = await this.ruleRepo.findById(id);
    if (!existing) throw new NotFoundException(`AttendanceRule not found: ${id}`);
    await this.ruleRepo.delete(id);
  }
}
