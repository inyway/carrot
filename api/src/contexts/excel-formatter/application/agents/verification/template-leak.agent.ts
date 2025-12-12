import { Injectable } from '@nestjs/common';
import { BaseVerificationAgent } from './base-verification.agent';
import { UnifiedCell, VerificationIssue } from './types';

/**
 * 템플릿 누수 검증 Agent
 * Excel 값이 없는데 템플릿 기존값이 그대로 남아있는 경우 감지
 * 예: 템플릿="포워딩", Excel=빈값, Generated="포워딩" → 누수!
 */
@Injectable()
export class TemplateLeakAgent extends BaseVerificationAgent {
  readonly name = 'TemplateLeakAgent';
  readonly description = '템플릿 기존값 누수 검증 (빈 데이터에 템플릿 값이 남아있는지)';

  checkCell(
    cell: UnifiedCell,
    personName: string,
    personIndex: number,
  ): VerificationIssue | null {
    const templateNorm = this.normalize(cell.templateValue);
    const excelNorm = this.normalize(cell.excelValue);
    const generatedNorm = this.normalize(cell.generatedValue);

    // 템플릿 값이 없으면 누수 불가
    if (this.isEmpty(templateNorm)) {
      return null;
    }

    // Excel에 값이 있으면 정상 (덮어쓰기 됨)
    if (!this.isEmpty(excelNorm)) {
      return null;
    }

    // Excel 빈값인데 Generated에 템플릿 값이 그대로 있는지 확인
    if (generatedNorm === templateNorm) {
      return {
        personName,
        personIndex,
        cell: { ...cell, status: 'template_leak' },
        severity: 'critical',  // 템플릿 누수는 항상 critical
        message: `템플릿 누수: Excel 빈값인데 템플릿 값 "${cell.templateValue}"이 그대로 남아있습니다`,
        agentName: this.name,
      };
    }

    // Generated가 비어있으면 정상 (제대로 초기화됨)
    return null;
  }
}
