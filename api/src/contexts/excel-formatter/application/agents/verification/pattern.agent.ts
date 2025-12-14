import { Injectable } from '@nestjs/common';
import { BaseVerificationAgent } from './base-verification.agent';
import { UnifiedCell, VerificationIssue } from './types';

/**
 * 패턴 검증 Agent
 * 데이터 형식이 올바른지 검증 (전화번호, 이메일, 날짜 등)
 */
@Injectable()
export class PatternAgent extends BaseVerificationAgent {
  readonly name = 'PatternAgent';
  readonly description = '데이터 형식 검증 (전화번호, 이메일, 날짜 패턴)';

  // 필드별 검증 패턴
  private readonly patterns: Record<string, { regex: RegExp; message: string }> = {
    연락처: {
      // 다양한 전화번호 형식 지원: 010-1234-5678, (010) 1234-5678, 01012345678 등
      regex: /^(\(?\d{2,4}\)?[-\s]?\d{3,4}[-\s]?\d{4})?$/,
      message: '전화번호 형식이 올바르지 않습니다 (예: 010-1234-5678)',
    },
    이메일: {
      regex: /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?$/,
      message: '이메일 형식이 올바르지 않습니다',
    },
    생년월일: {
      regex: /^(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{6,8})?$/,
      message: '날짜 형식이 올바르지 않습니다 (예: 1990-01-01)',
    },
  };

  checkCell(
    cell: UnifiedCell,
    personName: string,
    personIndex: number,
  ): VerificationIssue | null {
    // 빈 값이면 패턴 검증 스킵
    if (this.isEmpty(cell.generatedValue)) {
      return null;
    }

    // 필드명에 매칭되는 패턴 찾기
    for (const [fieldKey, pattern] of Object.entries(this.patterns)) {
      if (cell.fieldName.includes(fieldKey)) {
        const value = this.normalize(cell.generatedValue).replace(/\s/g, '');

        if (!pattern.regex.test(value)) {
          return {
            personName,
            personIndex,
            cell,
            severity: 'warning',
            message: `${fieldKey} ${pattern.message}: "${cell.generatedValue}"`,
            agentName: this.name,
          };
        }
      }
    }

    return null;
  }

  /**
   * O/X 체크 필드 검증 (취업여부 등)
   */
  private isValidCheckField(value: string): boolean {
    const validValues = ['O', 'X', 'o', 'x', '예', '아니오', 'Y', 'N', '-', ''];
    return validValues.includes(value.trim());
  }
}
