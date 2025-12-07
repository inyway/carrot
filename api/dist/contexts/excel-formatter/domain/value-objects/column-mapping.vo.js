"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ColumnMappingVO = void 0;
class ColumnMappingVO {
    templateColumn;
    dataColumn;
    confidence;
    reason;
    constructor(templateColumn, dataColumn, confidence, reason) {
        this.templateColumn = templateColumn;
        this.dataColumn = dataColumn;
        this.confidence = confidence;
        this.reason = reason;
        this.validate();
    }
    validate() {
        if (!this.templateColumn) {
            throw new Error('Template column is required');
        }
        if (this.confidence < 0 || this.confidence > 1) {
            throw new Error('Confidence must be between 0 and 1');
        }
    }
    static create(props) {
        return new ColumnMappingVO(props.templateColumn, props.dataColumn, props.confidence, props.reason);
    }
    toJSON() {
        return {
            templateColumn: this.templateColumn,
            dataColumn: this.dataColumn,
            confidence: this.confidence,
            reason: this.reason,
        };
    }
}
exports.ColumnMappingVO = ColumnMappingVO;
//# sourceMappingURL=column-mapping.vo.js.map