/**
 * AttendanceCalculationService
 * 출결 통계 계산 + 엑셀 수식 생성 서비스
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  AttendanceRule,
  StudentRow,
  CalculatedAttendance,
  AttendanceFormulas,
  StudentRenderData,
} from './types';
import { ATTENDANCE_RULE_REPOSITORY_PORT } from '../../ports/attendance-rule-repository.port';
import type {
  AttendanceRuleRepositoryPort,
} from '../../ports/attendance-rule-repository.port';

@Injectable()
export class AttendanceCalculationService {
  constructor(
    @Inject(ATTENDANCE_RULE_REPOSITORY_PORT)
    private readonly ruleRepo: AttendanceRuleRepositoryPort,
  ) {}

  /**
   * 회사별 출결 규칙 로드
   */
  async loadRule(companyId: string): Promise<AttendanceRule | null> {
    try {
      const rules = await this.ruleRepo.findByCompanyId(companyId);
      if (rules.length === 0) return null;
      // 기본 규칙 우선, 없으면 첫 번째
      const defaultRule = rules.find(r => r.name === 'default');
      const rule = defaultRule || rules[0];
      return {
        id: rule.id,
        companyId: rule.companyId,
        name: rule.name,
        attendedSymbols: rule.attendedSymbols,
        excusedSymbols: rule.excusedSymbols,
        absentSymbols: rule.absentSymbols,
        includeExcusedInAttendance: rule.includeExcusedInAttendance,
        totalSessionsField: rule.totalSessionsField,
      };
    } catch (error) {
      // DB 테이블이 없거나 조회 실패 시 기본 룰 사용
      console.warn('[AttendanceCalc] Failed to load rule, using defaults:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * 학생별 출결 통계 계산
   */
  calculateStudent(
    student: StudentRow,
    rule: AttendanceRule,
    totalSessions?: number,
  ): CalculatedAttendance {
    const symbols = Object.values(student.attendance);

    const attendedCount = symbols.filter(s =>
      rule.attendedSymbols.includes(s.toUpperCase()),
    ).length;

    const excusedCount = symbols.filter(s =>
      rule.excusedSymbols.includes(s.toUpperCase()),
    ).length;

    const absentCount = symbols.filter(s =>
      rule.absentSymbols.includes(s.toUpperCase()),
    ).length;

    // 출석 = 순수 출석 + (공결 if includeExcusedInAttendance)
    const attended = rule.includeExcusedInAttendance
      ? attendedCount + excusedCount
      : attendedCount;

    // 총 회차: 명시적 값 > 출결 컬럼 수
    const total = totalSessions ?? symbols.length;

    // 미참석 = 총회차 - 출석
    const notAttended = Math.max(0, total - attended);

    // 출석률 / 실출석률
    const attendanceRate = total > 0 ? (attended / total) * 100 : 0;
    const realAttendanceRate = total > 0 ? (attendedCount / total) * 100 : 0;

    return {
      attended,
      absent: absentCount,
      excused: excusedCount,
      notAttended,
      attendanceRate: Math.round(attendanceRate * 100) / 100,
      realAttendanceRate: Math.round(realAttendanceRate * 100) / 100,
      totalSessions: total,
    };
  }

  /**
   * 엑셀 수식 문자열 생성
   * @param attendanceRange 출결 데이터 범위 (e.g. "D5:AQ5")
   * @param rule 출결 규칙
   * @param totalSessionsCell 총 회차 셀 참조 (e.g. "B3") - optional
   */
  generateFormulas(
    attendanceRange: string,
    rule: AttendanceRule,
    totalSessionsCell?: string,
  ): AttendanceFormulas {
    // COUNTIF 수식 생성 헬퍼
    const countifParts = (symbols: string[]) =>
      symbols.map(s => `COUNTIF(${attendanceRange},"${s}")`).join('+');

    const attendedFormula = countifParts(rule.attendedSymbols);
    const excusedFormula = countifParts(rule.excusedSymbols);
    const absentFormula = countifParts(rule.absentSymbols);

    // 출석 수식: 순수 출석 + (공결 if rule)
    const totalAttendedFormula = rule.includeExcusedInAttendance
      ? `${attendedFormula}+${excusedFormula}`
      : attendedFormula;

    // 총 회차 수식
    const totalSessionsFormula = totalSessionsCell
      ? totalSessionsCell
      : `COUNTA(${attendanceRange})`;

    // 미참석 = 총회차 - 출석
    const notAttendedFormula = `${totalSessionsFormula}-(${totalAttendedFormula})`;

    // 출석률 = 출석/총회차*100
    const attendanceRateFormula = `IF(${totalSessionsFormula}>0,(${totalAttendedFormula})/${totalSessionsFormula}*100,0)`;

    // 실출석률 = 순수출석/총회차*100
    const realAttendanceRateFormula = `IF(${totalSessionsFormula}>0,(${attendedFormula})/${totalSessionsFormula}*100,0)`;

    return {
      attended: totalAttendedFormula,
      absent: absentFormula,
      excused: excusedFormula,
      notAttended: notAttendedFormula,
      attendanceRate: attendanceRateFormula,
      realAttendanceRate: realAttendanceRateFormula,
      totalSessions: totalSessionsFormula,
    };
  }

  /**
   * 전체 학생 데이터에 계산 + 수식 적용
   */
  async processStudents(
    students: StudentRow[],
    companyId: string,
    attendanceStartCol: string,
    attendanceEndCol: string,
    dataStartRow: number,
    totalSessionsCol?: string,
  ): Promise<{ renderedStudents: StudentRenderData[]; rule: AttendanceRule | null }> {
    const rule = await this.loadRule(companyId);

    // 규칙이 없으면 기본값 사용
    const effectiveRule: AttendanceRule = rule ?? {
      id: 'default',
      companyId,
      name: 'default',
      attendedSymbols: ['Y', 'L'],
      excusedSymbols: ['BZ', 'VA'],
      absentSymbols: ['N', 'C'],
      includeExcusedInAttendance: true,
      totalSessionsField: null,
    };

    const renderedStudents: StudentRenderData[] = students.map((student, index) => {
      const rowNum = dataStartRow + index;
      const attendanceRange = `${attendanceStartCol}${rowNum}:${attendanceEndCol}${rowNum}`;
      const totalSessionsCell = totalSessionsCol ? `${totalSessionsCol}${rowNum}` : undefined;

      const calculated = this.calculateStudent(student, effectiveRule);
      const formulas = this.generateFormulas(attendanceRange, effectiveRule, totalSessionsCell);

      return {
        identity: student.identity,
        attendance: student.attendance,
        metadata: student.metadata,
        calculated,
        formulas,
      };
    });

    return { renderedStudents, rule: effectiveRule };
  }
}
