import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { ConverterMappingService } from '../../../application/services/converter-mapping.service';

@Controller('converter')
export class ConverterMappingController {
  constructor(private readonly mappingService: ConverterMappingService) {}

  @Post('ai-mapping')
  async aiMapping(
    @Body() body: {
      templateColumns: string[];
      dataColumns: string[];
      templateSampleData?: Record<string, unknown>[];
      dataSampleData?: Record<string, unknown>[];
      dataMetadata?: Record<string, string>;
    },
  ) {
    if (!body.templateColumns?.length || !body.dataColumns?.length) {
      throw new BadRequestException('templateColumns and dataColumns are required');
    }
    return this.mappingService.mapColumns(body);
  }
}
