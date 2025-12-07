export declare class GenerateMappingRequestDto {
    templateColumns: string[];
    dataColumns: string[];
    command?: string;
}
export declare class ColumnMappingDto {
    templateColumn: string;
    dataColumn: string | null;
    confidence: number;
    reason: string;
}
export declare class GenerateMappingResponseDto {
    mappings: ColumnMappingDto[];
}
