import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Response } from 'express';

@Controller('analytics')
@UseGuards(RolesGuard)
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('overview')
  @Roles('VIEWER')
  async getOverview(@Query('campaignId') campaignId?: string) {
    return this.analyticsService.getOverviewStats(campaignId);
  }

  @Get('campaigns')
  @Roles('VIEWER')
  async getCampaignStats() {
    return this.analyticsService.getCampaignStats();
  }

  @Get('timeline')
  @Roles('VIEWER')
  async getTimeline(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getTimeline(query);
  }

  @Get('providers')
  @Roles('VIEWER')
  async getProviderStats(@Query('campaignId') campaignId?: string) {
    return this.analyticsService.getProviderStats(campaignId);
  }

  @Get('export')
  @Roles('ADMIN')
  async exportExcel(@Query('campaignId') campaignId: string | undefined, @Res() res: Response) {
    const buffer = await this.analyticsService.exportToExcel(campaignId);

    const filename = campaignId
      ? `photobooth-${campaignId}-${Date.now()}.xlsx`
      : `photobooth-all-${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('audit-log')
  @Roles('ADMIN')
  async getAuditLog(
    @Query('userId') userId?: string,
    @Query('entityType') entityType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.analyticsService.getAuditLog({
      userId,
      entityType,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }
}
