import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsEnum } from 'class-validator';
import { CreateCampaignDto } from './create-campaign.dto';

// PartialType makes every CreateCampaignDto field optional, so a PATCH only
// needs to send the fields it's actually changing. The `status` field below
// is only for shape/validation — CampaignsService.update() rejects it if
// present, since status changes must go through PATCH /campaigns/:id/status
// (see campaigns.service.ts) to enforce the transition state machine.
export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {
  @IsOptional()
  @IsEnum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'])
  status?: string;
}
