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
   * Excel 파일 컬럼 정보 조회 (HeaderDetectionAgent 사용)
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
    const result = await this.hwpxGeneratorService.getExcelColumnsWithAnalysis(
      excelFile.buffer,
      targetSheet,
    );

    return {
      sheets,
      columns: result.columns,
      hierarchicalColumns: result.hierarchicalColumns,
      headerAnalysis: {
        headerRows: result.headerAnalysis.headerRows,
        dataStartRow: result.headerAnalysis.dataStartRow,
        metaInfo: result.headerAnalysis.metaInfo,
      },
    };
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
    @Body('mappingContext') mappingContextRaw: string | undefined,
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

    // mappingContext JSON 파싱 (선택사항)
    let mappingContext: MappingContextDto | undefined;
    if (mappingContextRaw) {
      try {
        mappingContext = JSON.parse(mappingContextRaw);
        console.log('[HwpxController] MappingContext provided:', {
          hasDescription: !!mappingContext?.description,
          fieldRelationsCount: mappingContext?.fieldRelations?.length || 0,
        });
      } catch {
        console.warn('[HwpxController] Failed to parse mappingContext, ignoring');
      }
    }

    const templateFile = files.template[0];
    const excelFile = files.excel[0];

    const zipBuffer = await this.hwpxGeneratorService.generateBulk({
      templateBuffer: templateFile.buffer,
      dataBuffer: excelFile.buffer,
      sheetName,
      mappings,
      fileNameColumn,
      mappingContext,
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
      // Excel 컬럼 정보 먼저 가져오기 (후처리용)
      const excelColumnsResult = await this.hwpxGeneratorService.getExcelColumnsWithAnalysis(
        excelFile.buffer,
        targetSheetName,
      );
      const excelColumns = excelColumnsResult.columns;

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

      // 후처리: 누락된 회차 매핑 자동 추가
      const enhancedMappings = this.enhanceMappingsWithSessions(
        result.mappings,
        excelColumns,
      );

      console.log('[HwpxController] Enhanced mappings:', enhancedMappings.length, '(original:', result.mappings.length, ')');

      return {
        mappings: enhancedMappings.map(m => ({
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

  /**
   * 회차 패턴 기반 매핑 자동 보완
   * AI가 1회만 매핑한 경우, 동일 행의 2회~7회를 자동으로 추가
   */
  private enhanceMappingsWithSessions(
    mappings: Array<{ excelColumn: string; hwpxRow: number; hwpxCol: number }>,
    excelColumns: string[],
  ): Array<{ excelColumn: string; hwpxRow: number; hwpxCol: number }> {
    const enhanced = [...mappings];
    const existingKeys = new Set(mappings.map(m => `${m.hwpxRow}-${m.hwpxCol}`));

    // HWPX 템플릿의 회차별 컬럼 인덱스 패턴 (개인이력카드 기준)
    // 1회: Col 2, 2회: Col 3, 3회: Col 5, 4회: Col 9, 5회: Col 10, 6회: Col 13, 7회: Col 15
    const sessionColMap: Record<string, number> = {
      '1회': 2,
      '2회': 3,
      '3회': 5,
      '4회': 9,
      '5회': 10,
      '6회': 13,
      '7회': 15,
    };

    // 1회 매핑된 항목 찾기
    const session1Mappings = mappings.filter(m => m.excelColumn.endsWith('_1회'));

    for (const mapping of session1Mappings) {
      // 기본 이름 추출 (예: "4. 프로그램 참여현황_전문가 컨설팅_1회" -> "4. 프로그램 참여현황_전문가 컨설팅")
      const baseName = mapping.excelColumn.replace(/_1회$/, '');

      // 2회~7회 매핑 추가
      for (let session = 2; session <= 7; session++) {
        const sessionKey = `${session}회`;
        const excelColName = `${baseName}_${sessionKey}`;
        const hwpxCol = sessionColMap[sessionKey];

        // Excel 컬럼이 존재하고, 아직 매핑되지 않은 경우만 추가
        if (excelColumns.includes(excelColName)) {
          const key = `${mapping.hwpxRow}-${hwpxCol}`;
          if (!existingKeys.has(key)) {
            enhanced.push({
              excelColumn: excelColName,
              hwpxRow: mapping.hwpxRow,
              hwpxCol: hwpxCol,
            });
            existingKeys.add(key);
            console.log(`[HwpxController] Auto-added: ${excelColName} -> Row ${mapping.hwpxRow}, Col ${hwpxCol}`);
          }
        }
      }
    }

    return enhanced;
  }
}
