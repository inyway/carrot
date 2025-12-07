import type { AiMappingPort } from '../ports';
import { ColumnMappingVO } from '../../domain/value-objects';
export declare class MappingService {
    private readonly aiMappingAdapter;
    constructor(aiMappingAdapter: AiMappingPort);
    generateMapping(templateColumns: string[], dataColumns: string[], command?: string): Promise<ColumnMappingVO[]>;
}
