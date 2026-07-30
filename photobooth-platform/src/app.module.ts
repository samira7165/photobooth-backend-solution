import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { AssetsModule } from './assets/assets.module';
import { AiProvidersModule } from './ai-providers/ai-providers.module';
import { StorageModule } from './storage/storage.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    AppConfigModule,  // environment variables — globally available
    PrismaModule,     // database connection — globally available
    RedisModule,      // redis connection — globally available
    StorageModule,    // S3 client — globally available (falls back to local disk in dev)
    // Default rate limit for all routes; booth endpoints override with tighter
    // per-route @Throttle() limits. Independent of the coarse express-rate-limit
    // middleware in main.ts, which stays as a blanket first line of defense.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    AuthModule,
    UsersModule,
    CampaignsModule,
    AssetsModule,
    AiProvidersModule,
    SubmissionsModule,
    // Future modules will be added here:
    // ProcessingModule,
    // ImageModule,
    // AnalyticsModule,
    // QueueModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
