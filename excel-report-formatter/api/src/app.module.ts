import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ExcelFormatterModule } from './contexts/excel-formatter';
import { PrismaModule } from './common/database';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    ExcelFormatterModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
