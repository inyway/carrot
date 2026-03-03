import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import {
  AttendanceRuleRepositoryPort,
  AttendanceRuleEntity,
  CreateAttendanceRuleInput,
  UpdateAttendanceRuleInput,
} from '../../application/ports/attendance-rule-repository.port';

@Injectable()
export class PrismaAttendanceRuleAdapter implements AttendanceRuleRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByCompanyId(companyId: string): Promise<AttendanceRuleEntity[]> {
    const rules = await this.prisma.attendanceRule.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return rules.map(this.toEntity);
  }

  async findById(id: string): Promise<AttendanceRuleEntity | null> {
    const rule = await this.prisma.attendanceRule.findUnique({ where: { id } });
    return rule ? this.toEntity(rule) : null;
  }

  async findByCompanyAndName(companyId: string, name: string): Promise<AttendanceRuleEntity | null> {
    const rule = await this.prisma.attendanceRule.findUnique({
      where: { companyId_name: { companyId, name } },
    });
    return rule ? this.toEntity(rule) : null;
  }

  async create(input: CreateAttendanceRuleInput): Promise<AttendanceRuleEntity> {
    const rule = await this.prisma.attendanceRule.create({
      data: {
        companyId: input.companyId,
        name: input.name ?? 'default',
        attendedSymbols: input.attendedSymbols ?? ['Y', 'L'],
        excusedSymbols: input.excusedSymbols ?? ['BZ', 'VA'],
        absentSymbols: input.absentSymbols ?? ['N', 'C'],
        includeExcusedInAttendance: input.includeExcusedInAttendance ?? true,
        totalSessionsField: input.totalSessionsField ?? null,
      },
    });
    return this.toEntity(rule);
  }

  async update(id: string, input: UpdateAttendanceRuleInput): Promise<AttendanceRuleEntity> {
    const rule = await this.prisma.attendanceRule.update({
      where: { id },
      data: input,
    });
    return this.toEntity(rule);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.attendanceRule.delete({ where: { id } });
  }

  private toEntity(rule: any): AttendanceRuleEntity {
    return {
      id: rule.id,
      companyId: rule.companyId,
      name: rule.name,
      attendedSymbols: rule.attendedSymbols,
      excusedSymbols: rule.excusedSymbols,
      absentSymbols: rule.absentSymbols,
      includeExcusedInAttendance: rule.includeExcusedInAttendance,
      totalSessionsField: rule.totalSessionsField,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }
}
