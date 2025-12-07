import { ColumnMappingVO } from '../../domain/value-objects';
export interface AiMappingPort {
    generateMappings(templateColumns: string[], dataColumns: string[], command?: string): Promise<ColumnMappingVO[]>;
}
export declare const AI_MAPPING_PORT: unique symbol;
