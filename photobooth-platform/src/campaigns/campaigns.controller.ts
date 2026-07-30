import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Public } from '../common/decorators/public.decorator';

@Controller('campaigns')
@UseGuards(RolesGuard)
export class CampaignsController {
  constructor(private campaignsService: CampaignsService) {}

  @Post()
  @Roles('ADMIN')
  async create(@Body() dto: CreateCampaignDto, @Request() req) {
    return this.campaignsService.create(dto, req.user.id);
  }

  @Get()
  @Roles('OPERATOR')
  async findAll(@Query('status') status?: string) {
    return this.campaignsService.findAll({ status });
  }

  @Get(':id')
  @Roles('OPERATOR')
  async findById(@Param('id') id: string) {
    return this.campaignsService.findById(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  async update(@Param('id') id: string, @Body() dto: UpdateCampaignDto, @Request() req) {
    return this.campaignsService.update(id, dto, req.user.id);
  }

  @Patch(':id/status')
  @Roles('ADMIN')
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }, @Request() req) {
    return this.campaignsService.updateStatus(id, body.status, req.user.id);
  }

  // SUPER_ADMIN only — deleting a campaign is destructive and can't target an
  // ACTIVE campaign (see CampaignsService.delete).
  @Delete(':id')
  @Roles('SUPER_ADMIN')
  async delete(@Param('id') id: string, @Request() req) {
    return this.campaignsService.delete(id, req.user.id);
  }

  // ─── PUBLIC BOOTH ENDPOINT ───
  // What the kiosk tablet loads on startup — no auth, only returns campaigns
  // that are ACTIVE.
  @Public()
  @Get('booth/:slug')
  async getBoothConfig(@Param('slug') slug: string) {
    return this.campaignsService.getBoothConfig(slug);
  }
}
