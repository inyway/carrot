import { ConfigService } from '@nestjs/config';
import { AiMappingPort } from '../../application/ports';
import { ColumnMappingVO } from '../../domain/value-objects';
export declare class GeminiAiMappingAdapter implements AiMappingPort {
    private configService;
    private readonly apiKey;
    private readonly apiUrl;
    constructor(configService: ConfigService);
    generateMappings(templateColumns: string[], dataColumns: string[], command?: string): Promise<ColumnMappingVO[]>;
    private buildPrompt;
    private parseResponse;
}
