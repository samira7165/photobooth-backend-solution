import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { DeveloperKeysService } from './developer-keys.service';
import { GenerateKeyDto } from './dto/generate-key.dto';
import { UpdateKeyDto } from './dto/update-key.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

// JWT-protected admin routes for managing external-developer API keys
// (see DeveloperKeysService for the distinction from the internal
// AI-provider ApiKey model). No @Public() here — the global JwtAuthGuard
// applies as normal.
@Controller('developer-keys')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class DeveloperKeysController {
  constructor(private developerKeysService: DeveloperKeysService) {}

  // The plaintext key is only ever present in THIS response — every other
  // endpoint (including GET below) only ever returns keyPrefix.
  @Post()
  async generate(@Body() dto: GenerateKeyDto) {
    const result = await this.developerKeysService.generateKey(dto.campaignId, dto.name, {
      mode: dto.mode,
      allowedOrigins: dto.allowedOrigins,
      rateLimit: dto.rateLimit,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });

    return {
      ...result,
      warning: 'Save this key now — it will not be shown again.',
    };
  }

  @Get()
  async list(@Query('campaignId') campaignId: string) {
    return this.developerKeysService.listKeys(campaignId);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateKeyDto) {
    return this.developerKeysService.updateKey(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.developerKeysService.deleteKey(id);
  }

  @Post(':id/revoke')
  async revoke(@Param('id') id: string) {
    return this.developerKeysService.revokeKey(id);
  }
}
