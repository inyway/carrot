import {
  Controller,
  Post,
  Get,
  Delete,
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
import type { TemplateSheetVO, TemplateBlockVO, CellInfo } from '../../../domain/value-objects';

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
}

// 분석 결과 응답
interface AnalyzeTemplateResponse {
  sheetName: string;
  headers: { column: number; letter: string; name: string }[];
  dataStartRow: number;
  formulas: { cell: string; formula: string }[];
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
      // 회사 정보 포함하여 조회
      const templates = await this.templateService.getAllTemplatesWithCompany();

      const formattedTemplates: TemplateListResponse[] = templates.map((t) => ({
        id: t.id,
        name: t.name,
        fileName: t.fileName,
        columns: this.extractColumns(t.structure),
        createdAt: t.createdAt.toISOString(),
        companyId: t.companyId,
        company: t.company,
      }));

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
   */
  private extractColumns(structure: unknown): { name: string; type: string }[] {
    if (!structure || typeof structure !== 'object') {
      return [];
    }

    const s = structure as { sheets?: TemplateSheetVO[] };

    // 첫 번째 시트의 헤더 블록에서 컬럼 추출
    const firstSheet = s.sheets?.[0];
    if (!firstSheet?.blocks) return [];

    const headerBlock = firstSheet.blocks.find((b: TemplateBlockVO) => b.type === 'HEADER');
    if (!headerBlock?.cells) return [];

    return headerBlock.cells
      .filter((c: CellInfo) => c.value !== null && c.value !== undefined)
      .map((c: CellInfo) => ({
        name: String(c.value),
        type: 'string',
      }));
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

      // 파일 형식 확인
      const fileName = file.originalname.toLowerCase();
      if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
        throw new BadRequestException('Excel 파일(.xlsx, .xls)만 지원합니다.');
      }

      // 템플릿 구조 파싱
      const structure = await this.templateService.parseExcelTemplate(
        file.buffer,
        file.originalname,
      );

      // 프론트엔드 형식으로 변환
      const firstSheet = structure.sheets[0];

      // 헤더 정보 추출
      const headers = this.extractHeaders(firstSheet);

      // 수식 정보 추출
      const formulas = this.extractFormulas(firstSheet);

      return {
        success: true,
        data: {
          sheetName: firstSheet?.name || 'Sheet1',
          headers,
          dataStartRow: this.findDataStartRow(firstSheet),
          formulas,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.',
      };
    }
  }

  private extractHeaders(sheet: TemplateSheetVO | undefined): { column: number; letter: string; name: string }[] {
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
