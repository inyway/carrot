import { ColumnMappingVO } from '../../domain/value-objects';

export interface AiMappingPort {
  generateMappings(
    templateColumns: string[],
    dataColumns: string[],
    command?: string,
  ): Promise<ColumnMappingVO[]>;
}

export const AI_MAPPING_PORT = Symbol('AI_MAPPING_PORT');
