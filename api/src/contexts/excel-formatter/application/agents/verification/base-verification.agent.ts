import {
  UnifiedCell,
  VerificationIssue,
  VerificationAgentResult,
} from './types';

/**
 * 검증 Agent 베이스 클래스
 * 모든 검증 Agent는 이 클래스를 상속받아 구현
 */
export abstract class BaseVerificationAgent {
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * 단일 셀 검증
   * @returns 이슈가 있으면 VerificationIssue, 없으면 null
   */
  abstract checkCell(
    cell: UnifiedCell,
    personName: string,
    personIndex: number,
  ): VerificationIssue | null;

  /**
   * 여러 셀 일괄 검증
   */
  async verify(
    personIndex: number,
    personName: string,
    cells: UnifiedCell[],
  ): Promise<VerificationAgentResult> {
    const startTime = Date.now();
    const issues: VerificationIssue[] = [];

    for (const cell of cells) {
      const issue = this.checkCell(cell, personName, personIndex);
      if (issue) {
        issues.push(issue);
      }
    }

    const executionTimeMs = Date.now() - startTime;

    return {
      agentName: this.name,
      description: this.description,
      status: this.determineStatus(issues),
      issueCount: issues.length,
      issues,
      executionTimeMs,
    };
  }

  /**
   * 이슈 목록을 바탕으로 상태 결정
   */
  protected determineStatus(issues: VerificationIssue[]): 'pass' | 'warning' | 'fail' {
    if (issues.length === 0) return 'pass';

    const hasCritical = issues.some((i) => i.severity === 'critical');
    if (hasCritical) return 'fail';

    return 'warning';
  }

  /**
   * 문자열 정규화 (비교용)
   */
  protected normalize(value: string | null | undefined): string {
    if (!value) return '';
    return value.toString().trim().replace(/\s+/g, ' ');
  }

  /**
   * 빈 값인지 확인
   */
  protected isEmpty(value: string | null | undefined): boolean {
    if (!value) return true;
    const normalized = this.normalize(value);
    return normalized === '' || normalized === '-';
  }
}
