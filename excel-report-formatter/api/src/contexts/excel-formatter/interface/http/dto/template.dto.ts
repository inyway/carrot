import { IsString, IsOptional, IsEnum, IsNumber, IsObject } from 'class-validator';
import { BlockType } from '../../../domain/value-objects';

export class ParseTemplateResponseDto {
  fileName: string;
  sheets: SheetDto[];
  extractedAt: Date;
  version: string;
}

export class SheetDto {
  name: string;
  index: number;
  blocks: BlockDto[];
  rowCount: number;
  colCount: number;
}

export class BlockDto {
  blockId: string;
  type: BlockType;
  range: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  config?: Record<string, unknown>;
}

export class UpdateBlockTypeDto {
  @IsNumber()
  sheetIndex: number;

  @IsString()
  blockId: string;

  @IsEnum(BlockType)
  newType: BlockType;
}

export class UpdateBlockRangeDto {
  @IsNumber()
  sheetIndex: number;

  @IsString()
  blockId: string;

  @IsString()
  newRange: string;
}

export class AddBlockDto {
  @IsNumber()
  sheetIndex: number;

  @IsEnum(BlockType)
  type: BlockType;

  @IsString()
  range: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class RemoveBlockDto {
  @IsNumber()
  sheetIndex: number;

  @IsString()
  blockId: string;
}
