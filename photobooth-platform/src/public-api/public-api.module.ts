import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PublicApiController } from './public-api.controller';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { DeveloperKeysModule } from '../developer-keys/developer-keys.module';
import { DeveloperApiKeyGuard } from '../common/guards/developer-api-key.guard';

// Imports the existing feature modules (not just their services) so
// SubmissionsService/CampaignsService/DeliveryService run here with the
// exact same wiring (QueueMonitorModule, etc.) they already have for the
// internal admin/booth routes — nothing is re-instantiated or forked.
@Module({
  imports: [
    MulterModule.register({
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
    }),
    CampaignsModule,
    SubmissionsModule,
    DeliveryModule,
    DeveloperKeysModule,
  ],
  controllers: [PublicApiController],
  providers: [DeveloperApiKeyGuard],
})
export class PublicApiModule {}
