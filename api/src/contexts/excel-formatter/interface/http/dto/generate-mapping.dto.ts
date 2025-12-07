import { IsArray, IsOptional, IsString, ArrayNotEmpty } from 'class-validator';

export class GenerateMappingRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  templateColumns: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  dataColumns: string[];

  @IsOptional()
  @IsString()
  command?: string;
}

export class ColumnMappingDto {
  templateColumn: string;
  dataColumn: string | null;
  confidence: number;
  reason: string;
}

export class GenerateMappingResponseDto {
  mappings: ColumnMappingDto[];
}
