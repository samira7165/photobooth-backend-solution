import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
  constructor(private prisma: PrismaService) {}

  // ─── PROVIDERS ───

  async createProvider(data: { name: string; baseUrl: string }) {
    return this.prisma.aiProvider.create({ data: { name: data.name, baseUrl: data.baseUrl } });
  }

  async listProviders() {
    return this.prisma.aiProvider.findMany({
      include: {
        apiKeys: {
          select: { id: true, keyIdentifier: true, model: true, isActive: true, usageToday: true, usageTotal: true, dailyLimit: true, errorCount: true, lastUsedAt: true, lastErrorAt: true },
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

  async createApiKey(data: { providerId: string; keyIdentifier: string; apiKey: string; model?: string; dailyLimit?: number; campaignIds?: string[] }) {
    // Verify provider exists
    const provider = await this.prisma.aiProvider.findUnique({ where: { id: data.providerId } });
    if (!provider) throw new NotFoundException('Provider not found');

    // Encrypt the API key before storing
    const encryptedKey = encrypt(data.apiKey);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        providerId: data.providerId,
        keyIdentifier: data.keyIdentifier,
        model: data.model || null,
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
      model: apiKey.model,
      providerId: apiKey.providerId,
      isActive: apiKey.isActive,
      dailyLimit: apiKey.dailyLimit,
      linkedCampaigns: data.campaignIds || [],
    };
  }

  async updateApiKey(id: string, data: { keyIdentifier?: string; model?: string; isActive?: boolean; dailyLimit?: number }) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');

    return this.prisma.apiKey.update({
      where: { id },
      data,
      select: { id: true, keyIdentifier: true, model: true, isActive: true, dailyLimit: true, usageToday: true, usageTotal: true },
    });
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

    // 2. Filter to active, healthy, under-limit keys
    let availableKeys = campaignKeys
      .map(ck => ck.apiKey)
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

    if (availableKeys.length === 0) return null;

    const selected = availableKeys[0];

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
    if (success) {
      await this.prisma.apiKey.update({
        where: { id: keyId },
        data: {
          usageToday: { increment: 1 },
          usageTotal: { increment: 1 },
          lastUsedAt: new Date(),
          errorCount: 0, // reset on success
        },
      });
    } else {
      await this.prisma.apiKey.update({
        where: { id: keyId },
        data: {
          errorCount: { increment: 1 },
          lastErrorAt: new Date(),
        },
      });
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

    for (const providerName of priority) {
      const result = await this.getAvailableKey(campaignId, providerName);
      if (result) return result;
    }

    // Last resort: try any available key regardless of provider
    const anyKey = await this.getAvailableKey(campaignId);
    if (anyKey) return anyKey;

    throw new BadRequestException('No available API keys for this campaign. All keys are exhausted, disabled, or erroring.');
  }
}
