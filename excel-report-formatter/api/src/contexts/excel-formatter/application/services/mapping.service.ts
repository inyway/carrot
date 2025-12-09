import { Injectable, Inject } from '@nestjs/common';
import { AI_MAPPING_PORT } from '../ports';
import type { AiMappingPort } from '../ports';
import { ColumnMappingVO } from '../../domain/value-objects';

@Injectable()
export class MappingService {
  constructor(
    @Inject(AI_MAPPING_PORT)
    private readonly aiMappingAdapter: AiMappingPort,
  ) {}

  async generateMapping(
    templateColumns: string[],
    dataColumns: string[],
    command?: string,
  ): Promise<ColumnMappingVO[]> {
    return this.aiMappingAdapter.generateMappings(
      templateColumns,
      dataColumns,
      command,
    );
  }
}
