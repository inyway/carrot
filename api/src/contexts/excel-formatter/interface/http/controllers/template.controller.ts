import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TemplateService } from '../../../application/services';
import type {
  TemplateSheetVO,
  TemplateBlockVO,
  CellInfo,
  TemplateStructureVO,
  ColumnDefinition,
  FormulaInfo,
} from '../../../domain/value-objects';

// 프론트엔드 호환 응답 형식
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// 프론트엔드에서 기대하는 템플릿 목록 아이템
interface TemplateListResponse {
  id: string;
  name: string;
  fileName: string;
  columns: { name: string; type: string }[];
  createdAt: string;
  companyId: string;
  company?: {
    id: string;
    name: string;
    slug: string;
  };
  // Phase 1 enriched fields
  formatType?: string;
  sheetCount?: number;
  sheetNames?: string[];
}

// Excel 미리보기 데이터
interface ExcelPreviewData {
  sheetName: string;
  headers: string[];
  rows: (string | number)[][];
  formulas?: { cell: string; formula: string; type?: string }[];
}

// 시트 구조 정보
interface SheetStructureInfo {
  name: string;
  index: number;
  rowCount: number;
  colCount: number;
  headerRows: number[];
  dataStartRow: number;
  columnCount: number;
  mergedCellCount: number;
  formulaCount: number;
  titleRows?: number[];
}

// 템플릿 상세 응답
interface TemplateDetailResponse extends TemplateListResponse {
  preview: ExcelPreviewData | null;
  sheets?: SheetStructureInfo[];
  fileUrl?: string | null;
}

// 분석 결과 응답
interface AnalyzeTemplateResponse {
  sheetName: string;
  headers: { column: number; letter: string; name: string; type: string }[];
  dataStartRow: number;
  formulas: { cell: string; formula: string; type?: string }[];
  // Phase 1 enriched fields
  formatType?: string;
  sheetCount?: number;
  sheets?: {
    name: string;
    headerRows: number[];
    dataStartRow: number;
    columnCount: number;
    mergedCellCount: number;
  }[];
}

@Controller('templates')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  /**
   * 템플릿 목록 조회
   * GET /api/templates
   */
  @Get()
  async getTemplates(): Promise<ApiResponse<TemplateListResponse[]>> {
    try {
      const templates = await this.templateService.getAllTemplatesWithCompany();

      const formattedTemplates: TemplateListResponse[] = templates.map((t) => {
        const s = t.structure as TemplateStructureVO | null;
        return {
          id: t.id,
          name: t.name,
          fileName: t.fileName,
          columns: this.extractColumns(t.structure),
          createdAt: t.createdAt.toISOString(),
          companyId: t.companyId,
          company: t.company,
          formatType: s?.formatType,
          sheetCount: s?.sheets?.length,
          sheetNames: s?.sheets?.map((sh) => sh.name),
        };
      });

      return {
        success: true,
        data: formattedTemplates,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '템플릿 목록을 불러오는 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 템플릿 상세 조회
   * GET /api/templates/:id
   */
  @Get(':id')
  async getTemplateDetail(
    @Param('id') id: string,
  ): Promise<ApiResponse<TemplateDetailResponse>> {
    try {
      const template = await this.templateService.getTemplate(id);
      const s = template.structure as TemplateStructureVO | null;

      const data: TemplateDetailResponse = {
        id: template.id,
        name: template.name,
        fileName: template.fileName,
        columns: this.extractColumns(template.structure),
        createdAt: template.createdAt.toISOString(),
        companyId: template.companyId,
        company: template.company,
        preview: this.buildPreviewFromStructure(template.structure),
        formatType: s?.formatType,
        sheetCount: s?.sheets?.length,
        sheetNames: s?.sheets?.map((sh) => sh.name),
        sheets: s?.sheets?.map((sh) => this.buildSheetInfo(sh)),
        fileUrl: template.fileUrl,
      };

      return {
        success: true,
        data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '템플릿 상세 조회 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 새 템플릿 등록
   * POST /api/templates
   */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async createTemplate(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
    @Body('companyId') companyId: string,
    @Body('columns') columnsJson?: string,
  ): Promise<ApiResponse<{ id: string; name: string }>> {
    try {
      if (!file) {
        throw new BadRequestException('파일이 필요합니다.');
      }

      if (!name) {
        throw new BadRequestException('이름이 필요합니다.');
      }

      if (!companyId) {
        throw new BadRequestException('회사를 선택해주세요.');
      }

      // 컬럼 정보 파싱 (선택적)
      let columns: { name: string; type: string }[] = [];
      if (columnsJson) {
        try {
          columns = JSON.parse(columnsJson);
        } catch {
          // 파싱 실패 시 무시
        }
      }

      // 템플릿 생성
      const template = await this.templateService.createTemplate({
        companyId,
        name,
        buffer: file.buffer,
        fileName: file.originalname,
      });

      return {
        success: true,
        message: '템플릿이 등록되었습니다.',
        data: { id: template.id, name: template.name },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '템플릿 저장 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 템플릿 삭제
   * DELETE /api/templates?id=xxx
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  async deleteTemplate(
    @Query('id') id: string,
  ): Promise<ApiResponse> {
    try {
      if (!id) {
        throw new BadRequestException('템플릿 ID가 필요합니다.');
      }

      await this.templateService.deleteTemplate(id);

      return {
        success: true,
        message: '템플릿이 삭제되었습니다.',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '템플릿 삭제 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 템플릿 구조에서 컬럼 정보 추출
   * Phase 1: header.columns의 inferredType 사용
   */
  private extractColumns(structure: unknown): { name: string; type: string }[] {
    if (!structure || typeof structure !== 'object') {
      return [];
    }

    const s = structure as TemplateStructureVO;
    const firstSheet = s.sheets?.[0];
    if (!firstSheet) return [];

    // Phase 1: Use enriched header structure if available
    if (firstSheet.header?.columns && firstSheet.header.columns.length > 0) {
      return firstSheet.header.columns.map((col: ColumnDefinition) => ({
        name: col.fullName,
        type: col.inferredType,
      }));
    }

    // Legacy fallback: extract from HEADER block
    if (!firstSheet.blocks) return [];

    const headerBlock = firstSheet.blocks.find((b: TemplateBlockVO) => b.type === 'HEADER');
    if (!headerBlock?.cells) return [];

    return headerBlock.cells
      .filter((c: CellInfo) => c.value !== null && c.value !== undefined)
      .map((c: CellInfo) => ({
        name: String(c.value),
        type: 'string',
      }));
  }

  /**
   * 시트 구조 정보 생성
   */
  private buildSheetInfo(sheet: TemplateSheetVO): SheetStructureInfo {
    return {
      name: sheet.name,
      index: sheet.index,
      rowCount: sheet.rowCount,
      colCount: sheet.colCount,
      headerRows: sheet.header?.headerRows ?? [],
      dataStartRow: sheet.header?.dataStartRow ?? 2,
      columnCount: sheet.header?.columns?.length ?? 0,
      mergedCellCount: sheet.mergedCells?.length ?? 0,
      formulaCount: sheet.formulas?.length ?? 0,
      titleRows: sheet.titleRows,
    };
  }

  /**
   * 템플릿 구조에서 Excel 미리보기 데이터 생성
   * Phase 1: header 구조 활용
   */
  private buildPreviewFromStructure(structure: unknown): ExcelPreviewData | null {
    if (!structure || typeof structure !== 'object') {
      return null;
    }

    const s = structure as TemplateStructureVO;
    const firstSheet = s.sheets?.[0];
    if (!firstSheet) return null;

    // Phase 1: Use enriched header structure
    if (firstSheet.header?.columns && firstSheet.header.columns.length > 0) {
      const headers = firstSheet.header.columns.map((col: ColumnDefinition) => col.fullName);

      // Build rows from sample values
      const rows: (string | number)[][] = [];
      const maxSamples = firstSheet.header.columns[0]?.sampleValues?.length ?? 0;

      for (let i = 0; i < Math.min(maxSamples, 10); i++) {
        const row: (string | number)[] = firstSheet.header.columns.map((col: ColumnDefinition) => {
          const val = col.sampleValues?.[i];
          if (val === null || val === undefined) return '';
          if (typeof val === 'number') return val;
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          return String(val);
        });
        rows.push(row);
      }

      // Extract formulas from sheet-level formula info
      const formulas: { cell: string; formula: string; type?: string }[] = [];
      if (firstSheet.formulas) {
        for (const f of firstSheet.formulas) {
          formulas.push({
            cell: f.address,
            formula: f.formula,
            type: f.formulaType,
          });
        }
      }

      return {
        sheetName: firstSheet.name,
        headers,
        rows,
        formulas: formulas.length > 0 ? formulas : undefined,
      };
    }

    // Legacy fallback: extract from blocks
    if (!firstSheet.blocks) return null;

    const headerBlock = firstSheet.blocks.find((b: TemplateBlockVO) => b.type === 'HEADER');
    const headers = headerBlock?.cells
      ?.filter((c: CellInfo) => c.value !== null && c.value !== undefined)
      .map((c: CellInfo) => String(c.value)) ?? [];

    if (headers.length === 0) return null;

    const rows: (string | number)[][] = [];
    const dataBlocks = firstSheet.blocks.filter(
      (b: TemplateBlockVO) => b.type === 'TABLE' || b.type === 'METRIC_BLOCK',
    );

    for (const block of dataBlocks) {
      if (!block.cells || rows.length >= 10) break;

      const rowMap = new Map<number, (string | number)[]>();
      for (const cell of block.cells) {
        const rowNum = this.getRowFromAddress(cell.address);
        if (!rowMap.has(rowNum)) {
          rowMap.set(rowNum, []);
        }
        const val = cell.value;
        rowMap.get(rowNum)!.push(
          val === null || val === undefined ? '' :
          typeof val === 'number' ? val : String(val),
        );
      }

      const sortedRows = [...rowMap.entries()].sort((a, b) => a[0] - b[0]);
      for (const [, rowCells] of sortedRows) {
        if (rows.length >= 10) break;
        rows.push(rowCells);
      }
    }

    const formulas: { cell: string; formula: string }[] = [];
    for (const block of firstSheet.blocks) {
      if (!block.cells) continue;
      for (const cell of block.cells) {
        if (cell.formula) {
          formulas.push({
            cell: cell.address,
            formula: cell.formula,
          });
        }
      }
    }

    return {
      sheetName: firstSheet.name,
      headers,
      rows,
      formulas: formulas.length > 0 ? formulas : undefined,
    };
  }

  private getRowFromAddress(address: string): number {
    const match = address.match(/\d+$/);
    return match ? parseInt(match[0]) : 0;
  }
}

/**
 * 템플릿 분석 컨트롤러
 * POST /api/analyze-template
 */
@Controller('analyze-template')
export class AnalyzeTemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  async analyzeTemplate(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ApiResponse<AnalyzeTemplateResponse>> {
    try {
      if (!file) {
        throw new BadRequestException('파일이 필요합니다.');
      }

      const fileName = file.originalname.toLowerCase();
      if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
        throw new BadRequestException('Excel 파일(.xlsx, .xls)만 지원합니다.');
      }

      const structure = await this.templateService.parseExcelTemplate(
        file.buffer,
        file.originalname,
      );

      const firstSheet = structure.sheets[0];

      // Phase 1: Use enriched header structure
      let headers: { column: number; letter: string; name: string; type: string }[];
      let dataStartRow: number;
      let formulas: { cell: string; formula: string; type?: string }[];

      if (firstSheet?.header?.columns && firstSheet.header.columns.length > 0) {
        headers = firstSheet.header.columns.map((col: ColumnDefinition) => ({
          column: col.index,
          letter: col.letter,
          name: col.fullName,
          type: col.inferredType,
        }));
        dataStartRow = firstSheet.header.dataStartRow;
        formulas = (firstSheet.formulas ?? []).map((f: FormulaInfo) => ({
          cell: f.address,
          formula: f.formula,
          type: f.formulaType,
        }));
      } else {
        // Legacy fallback
        headers = this.extractHeaders(firstSheet);
        dataStartRow = this.findDataStartRow(firstSheet);
        formulas = this.extractFormulas(firstSheet);
      }

      // Build per-sheet summaries
      const sheets = structure.sheets.map((sh) => ({
        name: sh.name,
        headerRows: sh.header?.headerRows ?? [],
        dataStartRow: sh.header?.dataStartRow ?? 2,
        columnCount: sh.header?.columns?.length ?? 0,
        mergedCellCount: sh.mergedCells?.length ?? 0,
      }));

      return {
        success: true,
        data: {
          sheetName: firstSheet?.name || 'Sheet1',
          headers,
          dataStartRow,
          formulas,
          formatType: structure.formatType,
          sheetCount: structure.sheets.length,
          sheets,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.',
      };
    }
  }

  // Legacy fallback methods

  private extractHeaders(sheet: TemplateSheetVO | undefined): { column: number; letter: string; name: string; type: string }[] {
    if (!sheet?.blocks) return [];

    const headerBlock = sheet.blocks.find((b) => b.type === 'HEADER');
    if (!headerBlock?.cells) return [];

    return headerBlock.cells
      .filter((c) => c.value !== null && c.value !== undefined)
      .map((c) => {
        const col = this.getColFromAddress(c.address);
        return {
          column: col,
          letter: this.columnToLetter(col),
          name: String(c.value),
          type: 'string',
        };
      });
  }

  private extractFormulas(sheet: TemplateSheetVO | undefined): { cell: string; formula: string }[] {
    if (!sheet?.blocks) return [];

    const formulas: { cell: string; formula: string }[] = [];

    for (const block of sheet.blocks) {
      if (!block.cells) continue;

      for (const cell of block.cells) {
        if (cell.formula) {
          formulas.push({
            cell: cell.address,
            formula: cell.formula,
          });
        }
      }
    }

    return formulas;
  }

  private findDataStartRow(sheet: TemplateSheetVO | undefined): number {
    if (!sheet?.blocks) return 2;

    const headerBlock = sheet.blocks.find((b) => b.type === 'HEADER');
    return headerBlock?.endRow ? headerBlock.endRow + 1 : 2;
  }

  private getColFromAddress(address: string): number {
    const match = address.match(/^([A-Z]+)/);
    if (!match) return 1;
    return this.letterToColumnNumber(match[1]);
  }

  private letterToColumnNumber(letter: string): number {
    let result = 0;
    for (let i = 0; i < letter.length; i++) {
      result = result * 26 + (letter.charCodeAt(i) - 64);
    }
    return result;
  }

  private columnToLetter(col: number): string {
    let result = '';
    let n = col;
    while (n > 0) {
      n--;
      result = String.fromCharCode(65 + (n % 26)) + result;
      n = Math.floor(n / 26);
    }
    return result;
  }
}
