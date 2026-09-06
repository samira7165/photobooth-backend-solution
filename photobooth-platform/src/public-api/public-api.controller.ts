/// <reference types="multer" />
import { Controller, Get, Post, Body, Param, Req, UseInterceptors, UploadedFile, UseFilters } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { RequireApiKey } from '../common/decorators/require-api-key.decorator';
import { CampaignsService } from '../campaigns/campaigns.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { DeliveryService } from '../delivery/delivery.service';
import { CreateSubmissionDto } from '../submissions/dto/create-submission.dto';
import { PublicApiExceptionFilter } from './public-api-exception.filter';
import { wrapSuccess } from './public-api-response.util';

type RequestWithCampaign = Request & { campaign: { id: string; slug: string; name: string } };

// External-developer-facing booth endpoints — auth is a DeveloperApiKey
// (x-api-key header) via @RequireApiKey(), not JWT. Every route here just
// forwards to the SAME services the internal admin/booth routes already
// use (SubmissionsService, CampaignsService, DeliveryService) — no
// business logic is duplicated here, only the auth and response envelope
// differ. The campaign comes from the validated key (DeveloperApiKeyGuard
// attaches it to the request), so callers never pass a campaignId at all.
@Controller('public')
@RequireApiKey()
@UseFilters(PublicApiExceptionFilter)
export class PublicApiController {
  constructor(
    private campaignsService: CampaignsService,
    private submissionsService: SubmissionsService,
    private deliveryService: DeliveryService,
  ) {}

  @Get('config')
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute
  async getConfig(@Req() req: RequestWithCampaign) {
    const config = await this.campaignsService.getBoothConfig(req.campaign.slug);
    return wrapSuccess(config);
  }

  @Post('session')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 per minute
  async createSession(@Req() req: RequestWithCampaign, @Body() body: { hallId?: string }) {
    const session = await this.submissionsService.createSession(req.campaign.slug, body?.hallId);
    return wrapSuccess(session);
  }

  @Post('submit')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 per minute (heavy operation)
  @UseInterceptors(FileInterceptor('photo'))
  async submit(
    @Req() req: RequestWithCampaign,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateSubmissionDto,
  ) {
    const result = await this.submissionsService.submitPhoto(req.campaign.slug, file, dto);
    return wrapSuccess(result);
  }

  // Not scoped to req.campaign — matches the existing public booth status
  // route's own security model (submissionId is an unguessable UUID; see
  // GET /submissions/booth/status/:submissionId), not a new gap introduced
  // here.
  @Get('status/:submissionId')
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 per minute (polling)
  async getStatus(@Param('submissionId') submissionId: string) {
    const status = await this.submissionsService.getStatus(submissionId);
    return wrapSuccess(status);
  }

  @Get('download/:code')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 per minute
  async getDownload(@Param('code') code: string) {
    // Info-only fetch — doesn't count as an actual download, same reasoning
    // as the guest-facing /dl/[code] page (see DeliveryController).
    const info = await this.deliveryService.getDownloadInfo(code, { countAsDownload: false });
    return wrapSuccess(info);
  }
}
