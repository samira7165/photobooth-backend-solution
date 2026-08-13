import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/utils/encryption';

// Manages AI provider API keys: encrypted storage, per-key/per-campaign usage
// limits, and failover selection when a campaign needs a working key. The
// PROVIDERS/API KEYS sections below back the admin endpoints in
// ai-providers.controller.ts; KEY SELECTION and FAILOVER KEY SELECTION are
// called internally by the processing pipeline (not exposed over HTTP) when
// it actually needs to make an AI provider call on a campaign's behalf.
@Injectable()
export class AiProvidersService {
  private logger = new Logger(AiProvidersService.name);

  constructor(private prisma: PrismaService) {}

  // Human-readable "why" behind a key's eligibility, for the KEY SELECTION
  // logs below — purely descriptive, computed the same way (and in the same
  // order) as the real filters in getAvailableKey() so it never disagrees
  // with the actual selection outcome.
  private describeKeyStatus(key: {
    isActive: boolean;
    provider: { isHealthy: boolean };
    errorCount: number;
    usageToday: number;
    dailyLimit: number | null;
  }): string {
    if (!key.isActive) return 'DISABLED';
    if (!key.provider.isHealthy) return 'PROVIDER UNHEALTHY';
    if (key.errorCount >= 10) return 'TOO MANY ERRORS';
    if (key.dailyLimit && key.usageToday >= key.dailyLimit) return 'AT DAILY LIMIT';
    if (key.errorCount >= 7 || (key.dailyLimit && key.usageToday >= key.dailyLimit * 0.9)) return 'NEAR LIMIT';
    return 'AVAILABLE';
  }

  // ─── PROVIDERS ───

  async createProvider(data: { name: string; baseUrl: string }) {
    return this.prisma.aiProvider.create({ data: { name: data.name, baseUrl: data.baseUrl } });
  }

  async listProviders() {
    return this.prisma.aiProvider.findMany({
      include: {
        apiKeys: {
          select: {
            id: true,
            keyIdentifier: true,
            isActive: true,
            usageToday: true,
            usageTotal: true,
            dailyLimit: true,
            errorCount: true,
            lastUsedAt: true,
            lastErrorAt: true,
            models: { select: { id: true, model: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getProviderHealth() {
    const providers = await this.prisma.aiProvider.findMany({
      include: {
        apiKeys: {
          select: { id: true, keyIdentifier: true, isActive: true, usageToday: true, dailyLimit: true, errorCount: true, lastUsedAt: true, lastErrorAt: true },
        },
      },
    });

    return providers.map(p => ({
      id: p.id,
      name: p.name,
      isHealthy: p.isHealthy,
      lastHealthCheck: p.lastHealthCheck,
      avgResponseTime: p.avgResponseTime,
      totalKeys: p.apiKeys.length,
      activeKeys: p.apiKeys.filter(k => k.isActive).length,
      keysAtLimit: p.apiKeys.filter(k => k.dailyLimit && k.usageToday >= k.dailyLimit).length,
      recentErrors: p.apiKeys.reduce((sum, k) => sum + k.errorCount, 0),
    }));
  }

  async updateProviderHealth(providerId: string, isHealthy: boolean, avgResponseTime?: number) {
    return this.prisma.aiProvider.update({
      where: { id: providerId },
      data: { isHealthy, lastHealthCheck: new Date(), avgResponseTime },
    });
  }

  // ─── API KEYS ───

  async createApiKey(data: { providerId: string; keyIdentifier: string; apiKey: string; dailyLimit?: number; campaignIds?: string[] }) {
    // Verify provider exists
    const provider = await this.prisma.aiProvider.findUnique({ where: { id: data.providerId } });
    if (!provider) throw new NotFoundException('Provider not found');

    // Encrypt the API key before storing
    const encryptedKey = encrypt(data.apiKey);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        providerId: data.providerId,
        keyIdentifier: data.keyIdentifier,
        encryptedKey,
        dailyLimit: data.dailyLimit || null,
      },
    });

    // Link to campaigns if specified — otherwise mark it shared/global via a null-campaign link,
    // since getAvailableKey() only discovers keys through CampaignApiKey rows.
    if (data.campaignIds && data.campaignIds.length > 0) {
      for (const campaignId of data.campaignIds) {
        await this.prisma.campaignApiKey.create({
          data: { campaignId, apiKeyId: apiKey.id },
        });
      }
    } else {
      await this.prisma.campaignApiKey.create({
        data: { campaignId: null, apiKeyId: apiKey.id },
      });
    }

    return {
      id: apiKey.id,
      keyIdentifier: apiKey.keyIdentifier,
      providerId: apiKey.providerId,
      isActive: apiKey.isActive,
      dailyLimit: apiKey.dailyLimit,
      linkedCampaigns: data.campaignIds || [],
    };
  }

  async updateApiKey(id: string, data: { keyIdentifier?: string; isActive?: boolean; dailyLimit?: number }) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');

    return this.prisma.apiKey.update({
      where: { id },
      data,
      select: { id: true, keyIdentifier: true, isActive: true, dailyLimit: true, usageToday: true, usageTotal: true },
    });
  }

  // ─── API KEY MODELS ───
  // The models a key's provider account can call — one secret (ApiKey), many
  // candidate models a campaign's failover chain can pick between.

  async addModelToKey(apiKeyId: string, model: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id: apiKeyId } });
    if (!key) throw new NotFoundException('API key not found');

    const existing = await this.prisma.apiKeyModel.findUnique({
      where: { apiKeyId_model: { apiKeyId, model } },
    });
    if (existing) {
      throw new BadRequestException('This model is already added to this key');
    }

    return this.prisma.apiKeyModel.create({ data: { apiKeyId, model } });
  }

  async removeModelFromKey(apiKeyId: string, modelId: string) {
    const model = await this.prisma.apiKeyModel.findUnique({ where: { id: modelId } });
    if (!model || model.apiKeyId !== apiKeyId) {
      throw new NotFoundException('Model not found for this key');
    }

    // A campaign's aiConfig.keyChain stores specific ApiKeyModel ids — if one
    // gets deleted out from under a campaign that's still referencing it,
    // every submission on that campaign starts failing with an opaque
    // "not found" error and no visible link back to "a model was removed".
    // Blocking the removal here, with the actual campaign name(s) named, is
    // far cheaper than debugging that after the fact.
    const campaigns = await this.prisma.campaign.findMany({ select: { id: true, name: true, aiConfig: true } });
    const usedBy = campaigns.filter((c) => ((c.aiConfig as any)?.keyChain || []).includes(modelId));
    if (usedBy.length > 0) {
      throw new BadRequestException(
        `Cannot remove this model — it's in the AI key chain of: ${usedBy.map((c) => c.name).join(', ')}. Update those campaigns' AI config first.`,
      );
    }

    await this.prisma.apiKeyModel.delete({ where: { id: modelId } });
    return { message: 'Model removed from key' };
  }

  async deleteApiKey(id: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');

    // Delete campaign links first
    await this.prisma.campaignApiKey.deleteMany({ where: { apiKeyId: id } });
    await this.prisma.apiKey.delete({ where: { id } });

    return { message: 'API key deleted' };
  }

  async rotateApiKey(id: string, newApiKey: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');

    const encryptedKey = encrypt(newApiKey);

    return this.prisma.apiKey.update({
      where: { id },
      data: { encryptedKey, errorCount: 0 },
      select: { id: true, keyIdentifier: true, isActive: true },
    });
  }

  async linkKeyToCampaign(apiKeyId: string, campaignId: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id: apiKeyId } });
    if (!key) throw new NotFoundException('API key not found');

    const existing = await this.prisma.campaignApiKey.findUnique({
      where: { campaignId_apiKeyId: { campaignId, apiKeyId } },
    });
    if (existing) {
      throw new BadRequestException('Key is already linked to this campaign');
    }

    return this.prisma.campaignApiKey.create({
      data: { apiKeyId, campaignId },
    });
  }

  async unlinkKeyFromCampaign(apiKeyId: string, campaignId: string) {
    await this.prisma.campaignApiKey.deleteMany({
      where: { apiKeyId, campaignId },
    });
    return { message: 'Key unlinked from campaign' };
  }

  async resetDailyUsage() {
    // Called by a cron job at midnight — resets all keys' daily counters
    await this.prisma.apiKey.updateMany({
      data: { usageToday: 0 },
    });
    return { message: 'Daily usage reset for all keys' };
  }

  // ─── KEY SELECTION (used by processing module) ───

  // Picks the best available key for a campaign + optional provider, or null
  // if nothing qualifies. Returns the key already decrypted — callers should
  // use it immediately and not persist it anywhere.
  async getAvailableKey(campaignId: string, providerName?: string): Promise<{ key: string; keyId: string; providerId: string; providerName: string } | null> {
    this.logger.log('─── KEY SELECTION START ───');
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { slug: true } });
    this.logger.log(`Campaign: ${campaign?.slug || 'unknown'} (id: ${campaignId})${providerName ? ` | provider filter: ${providerName}` : ''}`);

    // 1. Find keys linked to this campaign (or shared keys with null campaignId)
    const campaignKeys = await this.prisma.campaignApiKey.findMany({
      where: {
        OR: [
          { campaignId },
          { campaignId: null },
        ],
      },
      include: {
        apiKey: {
          include: { provider: true },
        },
      },
    });

    const allKeys = campaignKeys.map(ck => ck.apiKey);
    this.logger.log(`Found ${allKeys.length} total keys linked to this campaign`);
    for (const k of allKeys) {
      const limit = k.dailyLimit ?? '∞';
      this.logger.debug(
        `Key "${k.keyIdentifier}" (${k.provider.name}) — active: ${k.isActive}, errors: ${k.errorCount}, usage: ${k.usageToday}/${limit}, status: ${this.describeKeyStatus(k)}`,
      );
    }

    // 2. Filter to active, healthy, under-limit keys
    let availableKeys = allKeys
      .filter(k => k.isActive)
      .filter(k => k.provider.isHealthy)
      .filter(k => !k.dailyLimit || k.usageToday < k.dailyLimit)
      .filter(k => k.errorCount < 10); // auto-disable after 10 consecutive errors

    // 3. Filter by provider if specified
    if (providerName) {
      availableKeys = availableKeys.filter(k => k.provider.name === providerName);
    }

    // 4. Sort by: fewest errors first, then fewest usage today
    availableKeys.sort((a, b) => {
      if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount;
      return a.usageToday - b.usageToday;
    });

    this.logger.log(`After filtering: ${availableKeys.length} keys available`);

    if (availableKeys.length === 0) {
      this.logger.warn(`No available keys for campaign ${campaign?.slug || campaignId}${providerName ? ` (provider: ${providerName})` : ''} — see key statuses above for why each was rejected`);
      this.logger.log('─── KEY SELECTION END ───');
      return null;
    }

    const selected = availableKeys[0];
    this.logger.log(`Selected: "${selected.keyIdentifier}" (provider: ${selected.provider.name}, priority: lowest errors + lowest usage)`);
    this.logger.log('─── KEY SELECTION END ───');

    // 5. Decrypt and return
    const decryptedKey = decrypt(selected.encryptedKey);

    return {
      key: decryptedKey,
      keyId: selected.id,
      providerId: selected.providerId,
      providerName: selected.provider.name,
    };
  }

  // Called after every AI provider call so getAvailableKey()'s filters
  // (errorCount < 10, usageToday < dailyLimit) stay accurate. A success
  // resets errorCount to 0, so one bad request doesn't permanently penalize
  // an otherwise-healthy key. Also writes an ApiKeyUsageLog row — the
  // aggregate counters on ApiKey (usageToday, errorCount, lastUsedAt, ...)
  // are a rolling summary; this log is the actual per-call history behind
  // AiProvidersController's GET /ai-providers/activity.
  async recordKeyUsage(keyId: string, success: boolean, responseTime?: number, errorMessage?: string) {
    this.logger.log('─── KEY USAGE RECORDED ───');
    // Read-only, purely for the before→after log line below — the actual
    // update()s further down are unchanged.
    const before = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
      select: { keyIdentifier: true, usageToday: true, usageTotal: true, errorCount: true },
    });
    this.logger.log(`Key: "${before?.keyIdentifier || keyId}" | Success: ${success} | Response time: ${responseTime != null ? `${responseTime}ms` : 'n/a'}`);
    if (!success && errorMessage) {
      this.logger.warn(`Error: ${errorMessage}`);
    }

    let after: { usageToday: number; usageTotal: number; errorCount: number };
    if (success) {
      after = await this.prisma.apiKey.update({
        where: { id: keyId },
        data: {
          usageToday: { increment: 1 },
          usageTotal: { increment: 1 },
          lastUsedAt: new Date(),
          errorCount: 0, // reset on success
        },
      });
    } else {
      after = await this.prisma.apiKey.update({
        where: { id: keyId },
        data: {
          errorCount: { increment: 1 },
          lastErrorAt: new Date(),
        },
      });
    }

    if (before) {
      this.logger.log(
        `Updated: usageToday ${before.usageToday}→${after.usageToday}, usageTotal ${before.usageTotal}→${after.usageTotal}, errorCount ${before.errorCount}→${after.errorCount}`,
      );
    }

    await this.prisma.apiKeyUsageLog.create({
      data: { apiKeyId: keyId, success, responseTime, errorMessage },
    });

    // Update provider avg response time
    if (responseTime) {
      const key = await this.prisma.apiKey.findUnique({ where: { id: keyId }, select: { providerId: true } });
      if (key) {
        const provider = await this.prisma.aiProvider.findUnique({ where: { id: key.providerId } });
        const currentAvg = provider?.avgResponseTime || responseTime;
        const newAvg = Math.round((currentAvg * 0.8) + (responseTime * 0.2)); // exponential moving average
        await this.prisma.aiProvider.update({
          where: { id: key.providerId },
          data: { avgResponseTime: newAvg, lastHealthCheck: new Date(), isHealthy: true },
        });
      }
    }
  }

  // Recent per-call history across all keys, newest first — the real data
  // behind the dashboard's Activity Log (previously synthesized from just
  // lastUsedAt/lastErrorAt, which can only ever represent one success and
  // one failure per key).
  async getRecentActivity(limit = 10) {
    const logs = await this.prisma.apiKeyUsageLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        apiKey: {
          select: { id: true, keyIdentifier: true, provider: { select: { name: true } } },
        },
      },
    });

    return logs.map((log) => ({
      id: log.id,
      apiKeyId: log.apiKeyId,
      keyIdentifier: log.apiKey.keyIdentifier,
      providerName: log.apiKey.provider.name,
      success: log.success,
      responseTime: log.responseTime,
      errorMessage: log.errorMessage,
      createdAt: log.createdAt,
    }));
  }

  // ─── FAILOVER KEY SELECTION ───

  // Tries providers in priority order (default gemini -> dalle -> replicate),
  // falling back to any available key from any provider before giving up.
  // Throws (rather than returning null) since callers generally can't
  // proceed at all without a key.
  async getKeyWithFailover(campaignId: string, providerPriority?: string[]): Promise<{ key: string; keyId: string; providerId: string; providerName: string }> {
    const priority = providerPriority || ['gemini', 'dalle', 'replicate'];

    this.logger.log('─── FAILOVER START ───');
    this.logger.log(`Priority order: ${priority.join(' -> ')}`);

    for (const providerName of priority) {
      this.logger.log(`Trying provider: ${providerName}...`);
      const result = await this.getAvailableKey(campaignId, providerName);
      if (result) {
        const identifier = await this.keyIdentifierFor(result.keyId);
        this.logger.log(`${providerName} — found key "${identifier}", returning`);
        this.logger.log(`─── FAILOVER END (selected: ${identifier}) ───`);
        return result;
      }
      this.logger.warn(`${providerName} — NO available keys`);
    }

    // Last resort: try any available key regardless of provider
    this.logger.log('All priority providers exhausted — falling back to any provider...');
    const anyKey = await this.getAvailableKey(campaignId);
    if (anyKey) {
      const identifier = await this.keyIdentifierFor(anyKey.keyId);
      this.logger.log(`any provider — found key "${identifier}" (provider: ${anyKey.providerName}), returning`);
      this.logger.log(`─── FAILOVER END (selected: ${identifier}) ───`);
      return anyKey;
    }

    this.logger.warn('─── FAILOVER END (no keys available from any provider) ───');
    throw new BadRequestException('No available API keys for this campaign. All keys are exhausted, disabled, or erroring.');
  }

  // Log-only helper — getAvailableKey() intentionally doesn't return
  // keyIdentifier (callers only need the id), so the failover log fetches it
  // separately rather than widening that method's return shape.
  private async keyIdentifierFor(keyId: string): Promise<string> {
    const key = await this.prisma.apiKey.findUnique({ where: { id: keyId }, select: { keyIdentifier: true } });
    return key?.keyIdentifier || keyId;
  }
}
