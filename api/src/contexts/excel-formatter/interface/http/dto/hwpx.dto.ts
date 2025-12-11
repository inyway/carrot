import { IsString, IsArray, IsOptional, IsNumber, ValidateNested } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CellMappingDto {
  @IsString()
  excelColumn: string;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  hwpxRow: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  hwpxCol: number;
}

export class HwpxGenerateRequestDto {
  @IsString()
  sheetName: string;

  @Transform(({ value }) => {
    // FormData로 전송 시 JSON 문자열로 오므로 파싱
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CellMappingDto)
  mappings: CellMappingDto[];

  @IsOptional()
  @IsString()
  fileNameColumn?: string;

  @IsOptional()
  @Transform(({ value }) => {
    // FormData로 전송 시 JSON 문자열로 오므로 파싱
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  })
  @ValidateNested()
  @Type(() => MappingContextDto)
  mappingContext?: MappingContextDto;
}

export class HwpxCellInfoDto {
  rowIndex: number;
  colIndex: number;
  text: string;
  isHeader: boolean;
  colSpan: number;
  rowSpan: number;
}

export class HwpxTableInfoDto {
  rowCount: number;
  colCount: number;
  cells: HwpxCellInfoDto[];
}

export class HwpxTemplateInfoDto {
  fileName: string;
  tables: HwpxTableInfoDto[];
  sections: string[];
}

export class HwpxAnalyzeResponseDto {
  template: HwpxTemplateInfoDto;
  suggestedMappings: CellMappingDto[];
}

export class HierarchicalColumnDto {
  name: string;
  colIndex: number;
  depth: number;
}

export class HeaderAnalysisDto {
  headerRows: number[];
  dataStartRow: number;
  metaInfo?: Record<string, string>;
}

export class ExcelColumnsResponseDto {
  sheets: string[];
  columns: string[];
  hierarchicalColumns?: HierarchicalColumnDto[];
  headerAnalysis?: HeaderAnalysisDto;
}

// 매핑 검증 결과
export class MappingValidationIssueDto {
  type: 'missing' | 'warning' | 'info';
  field: string;
  message: string;
  hwpxRow?: number;
  hwpxCol?: number;
  suggestedExcelColumn?: string;
}

export class MappingValidationResultDto {
  isValid: boolean;
  totalFields: number;
  mappedFields: number;
  missingFields: number;
  issues: MappingValidationIssueDto[];
  suggestions: CellMappingDto[];
}

// AI 매핑 응답용 Suggestion DTO (labelText, reason 포함)
export class AiMappingSuggestionDto {
  excelColumn: string;
  hwpxRow: number;
  hwpxCol: number;
  labelText: string;
  reason: string;
}

// AI 매핑 검증 결과 DTO
export class AiMappingValidationResultDto {
  isValid: boolean;
  totalFields: number;
  mappedFields: number;
  missingFields: number;
  issues: MappingValidationIssueDto[];
  suggestions: AiMappingSuggestionDto[];
}

// AI 매핑 응답 DTO
export class AiMappingResponseDto {
  mappings: CellMappingDto[];
  validationIssues: string[];
  validationResult: AiMappingValidationResultDto;
}

// 도메인 컨텍스트 DTO - AI 매핑에 추가 정보 제공
export class FieldRelationDto {
  @IsString()
  targetField: string;

  @IsArray()
  @IsString({ each: true })
  sourceFields: string[];

  @IsOptional()
  @IsString()
  mergeStrategy?: 'concat' | 'first' | 'all';

  @IsOptional()
  @IsString()
  description?: string;
}

export class SpecialRuleDto {
  @IsString()
  condition: string;

  @IsString()
  action: string;
}

export class MappingContextDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldRelationDto)
  fieldRelations?: FieldRelationDto[];

  @IsOptional()
  synonyms?: Record<string, string[]>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpecialRuleDto)
  specialRules?: SpecialRuleDto[];
}
