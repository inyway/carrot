import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { MappingService } from '../../../application/services';
import {
  GenerateMappingRequestDto,
  GenerateMappingResponseDto,
} from '../dto';

@Controller('excel-formatter/mapping')
export class MappingController {
  constructor(private readonly mappingService: MappingService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateMapping(
    @Body() dto: GenerateMappingRequestDto,
  ): Promise<GenerateMappingResponseDto> {
    const mappings = await this.mappingService.generateMapping(
      dto.templateColumns,
      dto.dataColumns,
      dto.command,
    );

    return {
      mappings: mappings.map((m) => m.toJSON()),
    };
  }
}
