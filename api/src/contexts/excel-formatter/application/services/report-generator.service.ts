/**
 * Report Generator Service
 * Canonical Data를 템플릿에 채워 Excel 보고서 생성
 */

import { Injectable, Inject } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  GenerateReportInput,
  GenerateReportResult,
  BlockFillResult,
} from '../ports/report-generator.port';
import type { TemplateRepositoryPort } from '../ports/template-repository.port';
import { TEMPLATE_REPOSITORY_PORT } from '../ports/template-repository.port';
import {
  CanonicalDataVO,
  CanonicalMetricValue,
  CANONICAL_METRICS,
} from '../../domain/value-objects/canonical-data.vo';
import {
  TemplateStructureVO,
  TemplateBlockVO,
  BlockType,
} from '../../domain/value-objects/template-structure.vo';

@Injectable()
export class ReportGeneratorService {
  constructor(
    @Inject(TEMPLATE_REPOSITORY_PORT)
    private readonly templateRepository: TemplateRepositoryPort,
  ) {}

  /**
   * Canonical Data를 사용하여 보고서 생성
   */
  async generateReport(input: GenerateReportInput): Promise<GenerateReportResult> {
    try {
      const workbook = new ExcelJS.Workbook();
      let totalRowsPopulated = 0;
      let blocksProcessed = 0;

      // 각 시트별로 처리
      for (const sheet of input.templateStructure.sheets) {
        const worksheet = workbook.addWorksheet(sheet.name);

        // 각 블록 처리
        for (const block of sheet.blocks) {
          const result = await this.processBlock(
            worksheet,
            block,
            input.canonicalData,
            input.options,
          );

          if (result.success) {
            totalRowsPopulated += result.rowsFilled;
            blocksProcessed++;
          }
        }
      }

      // 엑셀 버퍼 생성
      const buffer = await workbook.xlsx.writeBuffer();

      // 파일명 생성
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      const fileName = `report_${input.canonicalData.source}_${dateStr}.xlsx`;

      return {
        success: true,
        buffer: Buffer.from(buffer),
        fileName,
        metadata: {
          rowsPopulated: totalRowsPopulated,
          blocksProcessed,
          generatedAt: now,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '보고서 생성 중 오류 발생',
      };
    }
  }

  /**
   * 개별 블록 처리
   */
  private async processBlock(
    worksheet: ExcelJS.Worksheet,
    block: TemplateBlockVO,
    data: CanonicalDataVO,
    options?: GenerateReportInput['options'],
  ): Promise<BlockFillResult> {
    try {
      switch (block.type) {
        case BlockType.METRIC_BLOCK:
          return this.fillMetricBlock(worksheet, block, data);

        case BlockType.TABLE:
          return this.fillTableBlock(worksheet, block, data);

        case BlockType.HEADER:
          return this.fillHeaderBlock(worksheet, block, data, options);

        case BlockType.TEXT_STATIC:
          // 정적 텍스트는 템플릿 그대로 유지
          return {
            blockId: block.blockId,
            success: true,
            rowsFilled: 0,
          };

        default:
          return {
            blockId: block.blockId,
            success: true,
            rowsFilled: 0,
          };
      }
    } catch (error) {
      return {
        blockId: block.blockId,
        success: false,
        rowsFilled: 0,
        error: error instanceof Error ? error.message : '블록 처리 오류',
      };
    }
  }

  /**
   * 메트릭 블록 채우기 (KPI 카드 형태)
   */
  private fillMetricBlock(
    worksheet: ExcelJS.Worksheet,
    block: TemplateBlockVO,
    data: CanonicalDataVO,
  ): BlockFillResult {
    const metricsToShow = block.config?.metrics || data.metrics;
    let rowsFilled = 0;

    // Summary 데이터 사용
    const summary = data.summary || {};

    let currentRow = block.startRow;
    for (const metricKey of metricsToShow) {
      if (summary[metricKey] !== undefined) {
        const metricDef = CANONICAL_METRICS[metricKey];
        const value = summary[metricKey];

        // 메트릭 라벨
        const labelCell = worksheet.getCell(currentRow, block.startCol);
        labelCell.value = metricDef?.nameKo || metricKey;
        labelCell.font = { bold: true };

        // 메트릭 값
        const valueCell = worksheet.getCell(currentRow, block.startCol + 1);
        valueCell.value = value;

        // 포맷 적용
        if (metricDef?.format) {
          valueCell.numFmt = metricDef.format;
        }

        currentRow++;
        rowsFilled++;
      }
    }

    return {
      blockId: block.blockId,
      success: true,
      rowsFilled,
    };
  }

  /**
   * 테이블 블록 채우기
   */
  private fillTableBlock(
    worksheet: ExcelJS.Worksheet,
    block: TemplateBlockVO,
    data: CanonicalDataVO,
  ): BlockFillResult {
    const headerRow = block.config?.headerRow || block.startRow;
    let currentRow = headerRow;
    let rowsFilled = 0;

    // 헤더 작성
    const allKeys = [...data.dimensions, ...data.metrics];
    allKeys.forEach((key, colIndex) => {
      const cell = worksheet.getCell(currentRow, block.startCol + colIndex);
      const metricDef = CANONICAL_METRICS[key];
      cell.value = metricDef?.nameKo || key;
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };
    });
    currentRow++;

    // 데이터 행 작성
    for (const row of data.rows) {
      let colIndex = 0;

      // Dimension 값들
      for (const dim of row.dimensions) {
        const cell = worksheet.getCell(currentRow, block.startCol + colIndex);
        cell.value = dim.value;
        colIndex++;
      }

      // Metric 값들 (중복 제거)
      const seenMetrics = new Set<string>();
      for (const metric of row.metrics) {
        if (!seenMetrics.has(metric.key)) {
          seenMetrics.add(metric.key);
          const cell = worksheet.getCell(currentRow, block.startCol + colIndex);
          cell.value = metric.value;

          // 포맷 적용
          const metricDef = CANONICAL_METRICS[metric.key];
          if (metricDef?.format) {
            cell.numFmt = metricDef.format;
          }
          colIndex++;
        }
      }

      currentRow++;
      rowsFilled++;
    }

    // 열 너비 자동 조정
    worksheet.columns.forEach((column) => {
      if (column.values) {
        let maxLength = 0;
        column.values.forEach((value) => {
          if (value) {
            const length = String(value).length;
            if (length > maxLength) {
              maxLength = length;
            }
          }
        });
        column.width = Math.min(maxLength + 2, 30);
      }
    });

    return {
      blockId: block.blockId,
      success: true,
      rowsFilled,
    };
  }

  /**
   * 헤더 블록 채우기 (기간 정보 등)
   */
  private fillHeaderBlock(
    worksheet: ExcelJS.Worksheet,
    block: TemplateBlockVO,
    data: CanonicalDataVO,
    options?: GenerateReportInput['options'],
  ): BlockFillResult {
    const dateFormat = options?.dateFormat || 'YYYY-MM-DD';

    // 기간 정보 작성
    const startDate = this.formatDate(data.periodStart, dateFormat);
    const endDate = this.formatDate(data.periodEnd, dateFormat);

    const periodCell = worksheet.getCell(block.startRow, block.startCol);
    periodCell.value = `보고서 기간: ${startDate} ~ ${endDate}`;
    periodCell.font = { bold: true, size: 12 };

    // 데이터 소스 정보
    const sourceCell = worksheet.getCell(block.startRow + 1, block.startCol);
    sourceCell.value = `데이터 소스: ${data.source}`;

    return {
      blockId: block.blockId,
      success: true,
      rowsFilled: 2,
    };
  }

  /**
   * 미리보기용 HTML 테이블 생성
   */
  async generatePreviewHtml(
    templateStructure: TemplateStructureVO,
    canonicalData: CanonicalDataVO,
  ): Promise<string> {
    let html = '<div class="preview-container">';

    // 기간 정보
    html += `<div class="header">
      <h3>보고서 미리보기</h3>
      <p>기간: ${this.formatDate(canonicalData.periodStart)} ~ ${this.formatDate(canonicalData.periodEnd)}</p>
      <p>소스: ${canonicalData.source}</p>
    </div>`;

    // Summary 메트릭
    if (canonicalData.summary) {
      html += '<div class="summary-section"><h4>요약</h4><div class="metrics-grid">';
      for (const [key, value] of Object.entries(canonicalData.summary)) {
        const metricDef = CANONICAL_METRICS[key];
        const formattedValue = this.formatValue(value, metricDef?.type);
        html += `<div class="metric-card">
          <div class="metric-label">${metricDef?.nameKo || key}</div>
          <div class="metric-value">${formattedValue}</div>
        </div>`;
      }
      html += '</div></div>';
    }

    // 상세 데이터 테이블
    if (canonicalData.rows.length > 0) {
      html += '<div class="table-section"><h4>상세 데이터</h4><table class="data-table">';

      // 테이블 헤더
      html += '<thead><tr>';
      for (const dimKey of canonicalData.dimensions) {
        html += `<th>${dimKey}</th>`;
      }

      // 중복 제거된 메트릭 헤더
      const uniqueMetrics = [...new Set(canonicalData.metrics)];
      for (const metricKey of uniqueMetrics) {
        const metricDef = CANONICAL_METRICS[metricKey];
        html += `<th>${metricDef?.nameKo || metricKey}</th>`;
      }
      html += '</tr></thead>';

      // 테이블 바디
      html += '<tbody>';
      for (const row of canonicalData.rows) {
        html += '<tr>';

        // Dimensions
        for (const dim of row.dimensions) {
          html += `<td>${dim.value}</td>`;
        }

        // Metrics (중복 제거)
        const seenMetrics = new Set<string>();
        for (const metric of row.metrics) {
          if (!seenMetrics.has(metric.key)) {
            seenMetrics.add(metric.key);
            html += `<td>${metric.formattedValue || metric.value}</td>`;
          }
        }

        html += '</tr>';
      }
      html += '</tbody></table></div>';
    }

    html += '</div>';

    // 기본 스타일 추가
    const styles = `
      <style>
        .preview-container { font-family: sans-serif; padding: 20px; }
        .header { margin-bottom: 20px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; }
        .metric-card { background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: center; }
        .metric-label { font-size: 12px; color: #666; margin-bottom: 5px; }
        .metric-value { font-size: 18px; font-weight: bold; }
        .data-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .data-table th, .data-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        .data-table th { background: #f0f0f0; }
        .data-table tr:nth-child(even) { background: #fafafa; }
      </style>
    `;

    return styles + html;
  }

  /**
   * 블록 채우기 (외부 호출용)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async fillBlock(
    workbook: any,
    blockId: string,
    data: CanonicalDataVO,
  ): Promise<BlockFillResult> {
    // 간단한 구현 - 첫 번째 워크시트의 테이블 블록으로 가정
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return {
        blockId,
        success: false,
        rowsFilled: 0,
        error: '워크시트를 찾을 수 없습니다.',
      };
    }

    // 기본 테이블 블록 생성
    const defaultBlock: TemplateBlockVO = {
      blockId,
      type: BlockType.TABLE,
      range: 'A1:Z100',
      startRow: 1,
      endRow: 100,
      startCol: 1,
      endCol: 26,
      cells: [],
    };

    return this.fillTableBlock(worksheet, defaultBlock, data);
  }

  // ============================================
  // Helper Methods
  // ============================================

  private formatDate(date: Date, format = 'YYYY-MM-DD'): string {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day);
  }

  private formatValue(value: number, type?: string): string {
    switch (type) {
      case 'currency':
        return `₩${value.toLocaleString()}`;
      case 'percentage':
        return `${(value * 100).toFixed(2)}%`;
      case 'count':
        return value.toLocaleString();
      default:
        return String(value);
    }
  }
}
