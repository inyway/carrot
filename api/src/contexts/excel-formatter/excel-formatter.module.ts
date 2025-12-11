import { Module } from '@nestjs/common';
import {
  MappingController,
  TemplateController,
  AnalyzeTemplateController,
  DataTransformController,
  ReportGeneratorController,
  RagController,
  MappingProfileController,
  CompanyController,
  HwpxController,
  UnifiedGenerateController,
} from './interface/http/controllers';
import {
  MappingService,
  TemplateService,
  DataTransformService,
  ReportGeneratorService,
  RagService,
  MappingProfileService,
  HwpxGeneratorService,
  HwpxMappingGraphService,
  UnifiedGeneratorService,
} from './application/services';
import { HeaderDetectionAgent, OrchestratorAgent } from './application/agents';
import {
  GeminiAiMappingAdapter,
  ExceljsParserAdapter,
  PrismaTemplateAdapter,
  OpenAiEmbeddingAdapter,
  PrismaCleanReportAdapter,
  PrismaMappingProfileAdapter,
  HwpxParserAdapter,
} from './infrastructure/adapters';
import {
  AI_MAPPING_PORT,
  EXCEL_PARSER_PORT,
  TEMPLATE_REPOSITORY_PORT,
  EMBEDDING_PORT,
  CLEAN_REPORT_REPOSITORY_PORT,
  MAPPING_PROFILE_REPOSITORY_PORT,
} from './application/ports';

@Module({
  controllers: [
    MappingController,
    TemplateController,
    AnalyzeTemplateController,
    DataTransformController,
    ReportGeneratorController,
    RagController,
    MappingProfileController,
    CompanyController,
    HwpxController,
    UnifiedGenerateController,
  ],
  providers: [
    MappingService,
    TemplateService,
    DataTransformService,
    ReportGeneratorService,
    RagService,
    MappingProfileService,
    HwpxGeneratorService,
    HwpxMappingGraphService,
    UnifiedGeneratorService,
    HwpxParserAdapter,
    GeminiAiMappingAdapter,
    HeaderDetectionAgent,
    OrchestratorAgent,
    {
      provide: AI_MAPPING_PORT,
      useClass: GeminiAiMappingAdapter,
    },
    {
      provide: EXCEL_PARSER_PORT,
      useClass: ExceljsParserAdapter,
    },
    {
      provide: TEMPLATE_REPOSITORY_PORT,
      useClass: PrismaTemplateAdapter,
    },
    {
      provide: EMBEDDING_PORT,
      useClass: OpenAiEmbeddingAdapter,
    },
    {
      provide: CLEAN_REPORT_REPOSITORY_PORT,
      useClass: PrismaCleanReportAdapter,
    },
    {
      provide: MAPPING_PROFILE_REPOSITORY_PORT,
      useClass: PrismaMappingProfileAdapter,
    },
  ],
  exports: [
    MappingService,
    TemplateService,
    DataTransformService,
    ReportGeneratorService,
    RagService,
    MappingProfileService,
    HwpxGeneratorService,
  ],
})
export class ExcelFormatterModule {}
