import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  Res,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { HwpxGeneratorService } from '../../../application/services/hwpx-generator.service';
import {
  HwpxAnalyzeResponseDto,
  ExcelColumnsResponseDto,
  CellMappingDto,
  MappingValidationResultDto,
  AiMappingResponseDto,
  MappingContextDto,
} from '../dto/hwpx.dto';

@Controller('hwpx')
export class HwpxController {
  constructor(private readonly hwpxGeneratorService: HwpxGeneratorService) {}

  /**
   * HWPX 템플릿 분석
   * POST /api/hwpx/analyze
   */
  @Post('analyze')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'template', maxCount: 1 }]),
  )
  async analyzeTemplate(
    @UploadedFiles() files: { template?: Express.Multer.File[] },
  ): Promise<HwpxAnalyzeResponseDto> {
    if (!files.template || files.template.length === 0) {
      throw new BadRequestException('HWPX 템플릿 파일이 필요합니다.');
    }

    const templateFile = files.template[0];
    const result = await this.hwpxGeneratorService.analyzeTemplate(
      templateFile.buffer,
      templateFile.originalname,
    );

    return result;
  }

  /**
   * Excel 파일 컬럼 정보 조회
   * POST /api/hwpx/excel-columns
   */
  @Post('excel-columns')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'excel', maxCount: 1 }]),
  )
  async getExcelColumns(
    @UploadedFiles() files: { excel?: Express.Multer.File[] },
    @Body('sheetName') sheetName?: string,
  ): Promise<ExcelColumnsResponseDto> {
    if (!files.excel || files.excel.length === 0) {
      throw new BadRequestException('Excel 파일이 필요합니다.');
    }

    const excelFile = files.excel[0];
    const sheets = await this.hwpxGeneratorService.getExcelSheets(excelFile.buffer);

    const targetSheet = sheetName || sheets[0];
    const columns = await this.hwpxGeneratorService.getExcelColumns(
      excelFile.buffer,
      targetSheet,
    );

    return { sheets, columns };
  }

  /**
   * HWPX 일괄 생성
   * POST /api/hwpx/generate
   */
  @Post('generate')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'template', maxCount: 1 },
      { name: 'excel', maxCount: 1 },
    ]),
  )
  async generateBulk(
    @UploadedFiles()
    files: { template?: Express.Multer.File[]; excel?: Express.Multer.File[] },
    @Body('sheetName') sheetName: string,
    @Body('mappings') mappingsRaw: string,
    @Body('fileNameColumn') fileNameColumn: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!files.template || files.template.length === 0) {
      throw new BadRequestException('HWPX 템플릿 파일이 필요합니다.');
    }

    if (!files.excel || files.excel.length === 0) {
      throw new BadRequestException('Excel 데이터 파일이 필요합니다.');
    }

    // mappings JSON 파싱
    let mappings: Array<{ excelColumn: string; hwpxRow: number; hwpxCol: number }>;
    try {
      mappings = JSON.parse(mappingsRaw);
    } catch {
      throw new BadRequestException('mappings 형식이 올바르지 않습니다.');
    }

    const templateFile = files.template[0];
    const excelFile = files.excel[0];

    const zipBuffer = await this.hwpxGeneratorService.generateBulk({
      templateBuffer: templateFile.buffer,
      dataBuffer: excelFile.buffer,
      sheetName,
      mappings,
      fileNameColumn,
    });

    // ZIP 파일로 응답
    const fileName = `hwpx_output_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(HttpStatus.OK).send(zipBuffer);
  }

  /**
   * AI 기반 자동 매핑 생성
   * POST /api/hwpx/ai-mapping
   *
   * @param sheetName - Excel 시트 이름 (선택사항, 없으면 첫 번째 시트 사용)
   * @param context - 도메인 컨텍스트 JSON 문자열 (선택사항)
   *   예시: {
   *     "description": "개인이력카드 양식",
   *     "fieldRelations": [
   *       {
   *         "targetField": "핵심 세미나",
   *         "sourceFields": ["전문가 강연", "해외 경력자 멘토링"],
   *         "mergeStrategy": "all",
   *         "description": "핵심 세미나 = 전문가 강연 + 해외 경력자 멘토링"
   *       }
   *     ],
   *     "synonyms": {
   *       "성명": ["이름", "name"],
   *       "연락처": ["전화번호", "휴대폰"]
   *     }
   *   }
   */
  @Post('ai-mapping')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'template', maxCount: 1 },
      { name: 'excel', maxCount: 1 },
    ]),
  )
  async generateAiMapping(
    @UploadedFiles()
    files: { template?: Express.Multer.File[]; excel?: Express.Multer.File[] },
    @Body('sheetName') sheetName: string,
    @Body('context') contextRaw?: string,
  ): Promise<AiMappingResponseDto> {
    console.log('[HwpxController] AI mapping request received');
    console.log('[HwpxController] sheetName:', sheetName);

    if (!files.template || files.template.length === 0) {
      throw new BadRequestException('HWPX 템플릿 파일이 필요합니다.');
    }

    if (!files.excel || files.excel.length === 0) {
      throw new BadRequestException('Excel 데이터 파일이 필요합니다.');
    }

    const templateFile = files.template[0];
    const excelFile = files.excel[0];

    console.log('[HwpxController] Template file:', templateFile.originalname, templateFile.size);
    console.log('[HwpxController] Excel file:', excelFile.originalname, excelFile.size);

    // 컨텍스트 파싱 (선택사항)
    let context: MappingContextDto | undefined;
    if (contextRaw) {
      try {
        context = JSON.parse(contextRaw);
        console.log('[HwpxController] Context provided:', {
          hasDescription: !!context?.description,
          fieldRelationsCount: context?.fieldRelations?.length || 0,
          synonymsCount: Object.keys(context?.synonyms || {}).length,
          specialRulesCount: context?.specialRules?.length || 0,
        });
      } catch (e) {
        console.warn('[HwpxController] Failed to parse context JSON, ignoring:', e);
      }
    }

    // sheetName이 없으면 첫 번째 시트 사용
    let targetSheetName = sheetName;
    if (!targetSheetName) {
      const sheets = await this.hwpxGeneratorService.getExcelSheets(excelFile.buffer);
      targetSheetName = sheets[0];
      console.log('[HwpxController] Using first sheet:', targetSheetName);
    }

    try {
      const result = await this.hwpxGeneratorService.generateAiMappings(
        templateFile.buffer,
        excelFile.buffer,
        targetSheetName,
        context,
      );

      console.log('[HwpxController] AI mapping result:', result.mappings.length, 'mappings');
      console.log('[HwpxController] Validation result:', {
        isValid: result.validationResult.isValid,
        mappedFields: result.validationResult.mappedFields,
        missingFields: result.validationResult.missingFields,
        suggestions: result.validationResult.suggestions.length,
      });

      return {
        mappings: result.mappings.map(m => ({
          excelColumn: m.excelColumn,
          hwpxRow: m.hwpxRow,
          hwpxCol: m.hwpxCol,
        })),
        validationIssues: result.validationIssues,
        validationResult: result.validationResult,
      };
    } catch (error) {
      console.error('[HwpxController] AI mapping error:', error);
      throw error;
    }
  }

  /**
   * 매핑 검증
   * POST /api/hwpx/validate-mappings
   */
  @Post('validate-mappings')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'template', maxCount: 1 },
      { name: 'excel', maxCount: 1 },
    ]),
  )
  async validateMappings(
    @UploadedFiles()
    files: { template?: Express.Multer.File[]; excel?: Express.Multer.File[] },
    @Body('sheetName') sheetName: string,
    @Body('mappings') mappingsRaw: string,
  ): Promise<MappingValidationResultDto> {
    console.log('[HwpxController] Validate mappings request received');

    if (!files.template || files.template.length === 0) {
      throw new BadRequestException('HWPX 템플릿 파일이 필요합니다.');
    }

    if (!files.excel || files.excel.length === 0) {
      throw new BadRequestException('Excel 데이터 파일이 필요합니다.');
    }

    // mappings JSON 파싱
    let mappings: Array<{ excelColumn: string; hwpxRow: number; hwpxCol: number }>;
    try {
      mappings = JSON.parse(mappingsRaw || '[]');
    } catch {
      throw new BadRequestException('mappings 형식이 올바르지 않습니다.');
    }

    const templateFile = files.template[0];
    const excelFile = files.excel[0];

    // sheetName이 없으면 첫 번째 시트 사용
    let targetSheetName = sheetName;
    if (!targetSheetName) {
      const sheets = await this.hwpxGeneratorService.getExcelSheets(excelFile.buffer);
      targetSheetName = sheets[0];
    }

    try {
      const result = await this.hwpxGeneratorService.validateMappings(
        templateFile.buffer,
        excelFile.buffer,
        targetSheetName,
        mappings,
      );

      console.log('[HwpxController] Validation result:', result.isValid, 'issues:', result.issues.length);

      return result;
    } catch (error) {
      console.error('[HwpxController] Validation error:', error);
      throw error;
    }
  }
}
