import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Reads .env file and makes all variables available globally via ConfigService
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
})
export class AppConfigModule {}
