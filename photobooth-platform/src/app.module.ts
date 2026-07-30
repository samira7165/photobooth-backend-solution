import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { AssetsModule } from './assets/assets.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    AppConfigModule,  // environment variables — globally available
    PrismaModule,     // database connection — globally available
    RedisModule,      // redis connection — globally available
    AuthModule,
    UsersModule,
    CampaignsModule,
    AssetsModule,
    // Future modules will be added here:
    // SubmissionsModule,
    // ProcessingModule,
    // StorageModule,
    // ImageModule,
    // AnalyticsModule,
    // QueueModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
