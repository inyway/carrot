export declare class ColumnMappingVO {
    readonly templateColumn: string;
    readonly dataColumn: string | null;
    readonly confidence: number;
    readonly reason: string;
    constructor(templateColumn: string, dataColumn: string | null, confidence: number, reason: string);
    private validate;
    static create(props: {
        templateColumn: string;
        dataColumn: string | null;
        confidence: number;
        reason: string;
    }): ColumnMappingVO;
    toJSON(): {
        templateColumn: string;
        dataColumn: string | null;
        confidence: number;
        reason: string;
    };
}
