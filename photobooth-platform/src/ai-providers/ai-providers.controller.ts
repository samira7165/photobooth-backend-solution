import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AiProvidersService } from './ai-providers.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

// Everything here needs SUPER_ADMIN by default (these routes create/rotate/
// delete API keys) except listProviders and getHealth, which are downgraded
// to ADMIN below since read-only visibility into provider health doesn't
// need the same trust level as managing keys.
@Controller('ai-providers')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class AiProvidersController {
  constructor(private aiProvidersService: AiProvidersService) {}

  // ─── PROVIDERS ───

  @Post()
  async createProvider(@Body() dto: CreateProviderDto) {
    return this.aiProvidersService.createProvider(dto);
  }

  @Get()
  @Roles('ADMIN')
  async listProviders() {
    return this.aiProvidersService.listProviders();
  }

  @Get('health')
  @Roles('ADMIN')
  async getHealth() {
    return this.aiProvidersService.getProviderHealth();
  }

  // ─── API KEYS ───

  @Post('keys')
  async createApiKey(@Body() dto: CreateApiKeyDto) {
    return this.aiProvidersService.createApiKey(dto);
  }

  @Patch('keys/:id')
  async updateApiKey(@Param('id') id: string, @Body() dto: UpdateApiKeyDto) {
    return this.aiProvidersService.updateApiKey(id, dto);
  }

  @Patch('keys/:id/rotate')
  async rotateApiKey(@Param('id') id: string, @Body() body: { apiKey: string }) {
    return this.aiProvidersService.rotateApiKey(id, body.apiKey);
  }

  @Delete('keys/:id')
  async deleteApiKey(@Param('id') id: string) {
    return this.aiProvidersService.deleteApiKey(id);
  }

  @Post('keys/:keyId/link/:campaignId')
  async linkKeyToCampaign(@Param('keyId') keyId: string, @Param('campaignId') campaignId: string) {
    return this.aiProvidersService.linkKeyToCampaign(keyId, campaignId);
  }

  @Delete('keys/:keyId/link/:campaignId')
  async unlinkKeyFromCampaign(@Param('keyId') keyId: string, @Param('campaignId') campaignId: string) {
    return this.aiProvidersService.unlinkKeyFromCampaign(keyId, campaignId);
  }

  @Post('reset-daily')
  async resetDailyUsage() {
    return this.aiProvidersService.resetDailyUsage();
  }
}
