import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ExcelFormatterModule } from './contexts/excel-formatter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ExcelFormatterModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
