import { Module } from '@nestjs/common';
import { MappingController } from './interface/http/controllers';
import { MappingService } from './application/services';
import { GeminiAiMappingAdapter } from './infrastructure/adapters';
import { AI_MAPPING_PORT } from './application/ports';

@Module({
  controllers: [MappingController],
  providers: [
    MappingService,
    {
      provide: AI_MAPPING_PORT,
      useClass: GeminiAiMappingAdapter,
    },
  ],
  exports: [MappingService],
})
export class ExcelFormatterModule {}
