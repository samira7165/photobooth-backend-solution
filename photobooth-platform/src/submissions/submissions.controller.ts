/// <reference types="multer" />
import { Controller, Get, Post, Delete, Patch, Body, Param, Query, UseInterceptors, UploadedFile, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { SubmissionsService } from './submissions.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@Controller('submissions')
export class SubmissionsController {
  constructor(private submissionsService: SubmissionsService) {}

  // ─── PUBLIC BOOTH ENDPOINTS (no auth) ───

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // max 10 sessions/min per IP
  @Post('booth/:campaignSlug/session')
  async createSession(
    @Param('campaignSlug') campaignSlug: string,
    @Body() body: { hallId?: string },
  ) {
    return this.submissionsService.createSession(campaignSlug, body?.hallId);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // max 5 photo submissions/min per IP
  @Post('booth/:campaignSlug/submit')
  @UseInterceptors(FileInterceptor('photo'))
  async submitPhoto(
    @Param('campaignSlug') campaignSlug: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateSubmissionDto,
  ) {
    return this.submissionsService.submitPhoto(campaignSlug, file, dto);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // max 60 polls/min per IP (~every 3s)
  @Get('booth/status/:submissionId')
  async getStatus(@Param('submissionId') submissionId: string) {
    return this.submissionsService.getStatus(submissionId);
  }

  // ─── ADMIN ENDPOINTS (auth required) ───

  @Get()
  @UseGuards(RolesGuard)
  @Roles('OPERATOR')
  async findAll(
    @Query('campaignId') campaignId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.submissionsService.findAll({
      campaignId,
      status,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('OPERATOR')
  async findById(@Param('id') id: string) {
    return this.submissionsService.findById(id);
  }

  @Patch(':id/retry')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async retry(@Param('id') id: string) {
    return this.submissionsService.retrySubmission(id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async delete(@Param('id') id: string) {
    return this.submissionsService.deleteSubmission(id);
  }
}
