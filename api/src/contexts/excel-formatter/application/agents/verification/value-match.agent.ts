import { Injectable } from '@nestjs/common';
import { BaseVerificationAgent } from './base-verification.agent';
import { UnifiedCell, VerificationIssue } from './types';

/**
 * 값 일치 검증 Agent
 * Excel 값과 Generated HWPX 값이 일치하는지 확인
 */
@Injectable()
export class ValueMatchAgent extends BaseVerificationAgent {
  readonly name = 'ValueMatchAgent';
  readonly description = 'Excel 데이터와 생성된 HWPX 값 일치 검증';

  checkCell(
    cell: UnifiedCell,
    personName: string,
    personIndex: number,
  ): VerificationIssue | null {
    const excelNorm = this.normalize(cell.excelValue);
    const generatedNorm = this.normalize(cell.generatedValue);

    // 둘 다 비어있으면 OK
    if (this.isEmpty(excelNorm) && this.isEmpty(generatedNorm)) {
      return null;
    }

    // 값이 일치하면 OK
    if (excelNorm === generatedNorm) {
      return null;
    }

    // 불일치 - 심각도 결정
    const severity = this.determineSeverity(cell);

    return {
      personName,
      personIndex,
      cell: { ...cell, status: 'mismatch' },
      severity,
      message: `값 불일치: Excel="${cell.excelValue || '(빈값)'}" ≠ Generated="${cell.generatedValue || '(빈값)'}"`,
      agentName: this.name,
    };
  }

  /**
   * 필드별 심각도 결정
   */
  private determineSeverity(cell: UnifiedCell): 'critical' | 'warning' | 'info' {
    const criticalFields = ['성명', '연락처', '이메일', '생년월일'];
    const warningFields = ['취업처', '담당직무', '취업여부'];

    const fieldLower = cell.fieldName.toLowerCase();

    // 필수 필드
    for (const f of criticalFields) {
      if (fieldLower.includes(f.toLowerCase())) {
        return 'critical';
      }
    }

    // 중요 필드
    for (const f of warningFields) {
      if (fieldLower.includes(f.toLowerCase())) {
        return 'warning';
      }
    }

    return 'info';
  }
}
