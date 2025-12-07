export class ColumnMappingVO {
  constructor(
    public readonly templateColumn: string,
    public readonly dataColumn: string | null,
    public readonly confidence: number,
    public readonly reason: string,
  ) {
    this.validate();
  }

  private validate(): void {
    if (!this.templateColumn) {
      throw new Error('Template column is required');
    }
    if (this.confidence < 0 || this.confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
  }

  static create(props: {
    templateColumn: string;
    dataColumn: string | null;
    confidence: number;
    reason: string;
  }): ColumnMappingVO {
    return new ColumnMappingVO(
      props.templateColumn,
      props.dataColumn,
      props.confidence,
      props.reason,
    );
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
