import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { DeveloperKeysModule } from '../developer-keys/developer-keys.module';
import { DeliveryModule } from '../delivery/delivery.module';

@Module({
  imports: [DeveloperKeysModule, DeliveryModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
