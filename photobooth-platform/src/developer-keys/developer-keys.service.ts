import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const ALL_ORIGINS_CACHE_KEY = 'public-api:allowed-origins';
const ALL_ORIGINS_CACHE_TTL_SECONDS = 300; // 5 minutes

// Enough of the raw key to narrow a lookup to a handful of rows without a
// full-table bcrypt scan, while the remaining ~28 random chars stay secret
// (never stored anywhere in recoverable form). "pb_live_"/"pb_test_" is
// exactly 8 chars, so 12 also covers a few random chars beyond the mode tag.
const KEY_PREFIX_LENGTH = 12;
const RANDOM_PART_BYTES = 24; // -> 32 base64url chars, matching the "32 random chars" spec

// Unrelated to the ApiKey model (AI provider secrets, see prisma/schema.prisma)
// — this is external-developer access to a campaign's /api/v1/public/*
// booth endpoints.
@Injectable()
export class DeveloperKeysService {
  private logger = new Logger(DeveloperKeysService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // Generates a plaintext key, hashes it, stores the hash + prefix. The
  // plaintext is returned ONCE here and never stored anywhere — there is no
  // way to recover it after this call returns, only revoke and reissue.
  // "live" vs "test" isn't a separate DB column — it's encoded directly in
  // the key string's prefix ("pb_live_"/"pb_test_"), so the admin UI (and
  // anyone reading keyPrefix) can tell them apart without an extra field.
  async generateKey(
    campaignId: string,
    name: string,
    options: { mode?: 'live' | 'test'; allowedOrigins?: string[]; rateLimit?: number; expiresAt?: Date } = {},
  ) {
    const mode = options.mode || 'live';
    const random = randomBytes(RANDOM_PART_BYTES).toString('base64url');
    const rawKey = `pb_${mode}_${random}`;
    const keyPrefix = rawKey.slice(0, KEY_PREFIX_LENGTH);
    const keyHash = await bcrypt.hash(rawKey, 10);

    const record = await this.prisma.developerApiKey.create({
      data: {
        campaignId,
        name,
        keyPrefix,
        keyHash,
        allowedOrigins: options.allowedOrigins ?? undefined,
        rateLimit: options.rateLimit ?? 60,
        expiresAt: options.expiresAt,
      },
    });

    this.logger.log(`Generated developer API key "${name}" (${keyPrefix}...) for campaign ${campaignId}`);

    return {
      id: record.id,
      name: record.name,
      key: rawKey,
      keyPrefix: record.keyPrefix,
      campaignId: record.campaignId,
    };
  }

  // Hashes the input, looks up candidates by prefix, verifies with bcrypt,
  // returns the key record (with its campaign) or null. Updates
  // lastUsedAt/usageToday/usageTotal on success — a failed attempt (wrong
  // key, no match) touches nothing.
  async validateKey(rawKey: string) {
    if (!rawKey || rawKey.length < KEY_PREFIX_LENGTH) return null;
    const keyPrefix = rawKey.slice(0, KEY_PREFIX_LENGTH);

    // Prefix narrows to a handful of rows instead of a full-table scan;
    // more than one active key can theoretically share a 12-char prefix, so
    // every candidate is checked rather than trusting the first match.
    const candidates = await this.prisma.developerApiKey.findMany({
      where: { keyPrefix, isActive: true },
      include: { campaign: true },
    });

    for (const candidate of candidates) {
      const matches = await bcrypt.compare(rawKey, candidate.keyHash);
      if (matches) {
        return this.prisma.developerApiKey.update({
          where: { id: candidate.id },
          data: {
            lastUsedAt: new Date(),
            usageToday: { increment: 1 },
            usageTotal: { increment: 1 },
          },
          include: { campaign: true },
        });
      }
    }

    return null;
  }

  async revokeKey(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarding keyHash before returning
    const { keyHash: _keyHash, ...safe } = await this.prisma.developerApiKey.update({
      where: { id },
      data: { isActive: false },
    });
    return safe;
  }

  async deleteKey(id: string) {
    await this.prisma.developerApiKey.delete({ where: { id } });
    return { message: 'Developer API key deleted' };
  }

  // Metadata only — keyHash never leaves this service.
  async listKeys(campaignId: string) {
    const keys = await this.prisma.developerApiKey.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(({ keyHash: _keyHash, ...safe }) => safe);
  }

  async updateKey(
    id: string,
    data: { name?: string; isActive?: boolean; allowedOrigins?: string[]; rateLimit?: number },
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarding keyHash before returning
    const { keyHash: _keyHash, ...safe } = await this.prisma.developerApiKey.update({
      where: { id },
      data: { ...data, allowedOrigins: data.allowedOrigins ?? undefined },
    });
    return safe;
  }

  // usageToday is a rolling per-day counter; usageTotal is lifetime and is
  // never reset. Requires ScheduleModule.forRoot() registered once in
  // AppModule for @Cron to actually fire.
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async resetDailyUsage() {
    const result = await this.prisma.developerApiKey.updateMany({ data: { usageToday: 0 } });
    this.logger.log(`Reset usageToday for ${result.count} developer API key(s)`);
    return result;
  }

  // validateKey() already incremented usageToday as part of authenticating
  // this request, so "over the limit" means this request itself pushed the
  // count past rateLimit, not that the next one would.
  async checkRateLimit(keyId: string): Promise<boolean> {
    const key = await this.prisma.developerApiKey.findUnique({
      where: { id: keyId },
      select: { usageToday: true, rateLimit: true },
    });
    if (!key) return false;
    return key.usageToday <= key.rateLimit;
  }

  // Browsers never send the actual x-api-key value on a CORS preflight
  // (OPTIONS) request — only DeveloperApiKeyGuard, which runs later with
  // full header access on the real request, can check a SPECIFIC key's
  // allowedOrigins (see checkOrigin above). All CORS can decide at the
  // preflight stage is whether an Origin is known to ANY public-api key or
  // campaign at all — main.ts's dynamic CORS delegate calls this to get
  // that union, cached here since it's looked up on every single preflight.
  async getAllKnownOrigins(): Promise<string[]> {
    const cached = await this.redis.get(ALL_ORIGINS_CACHE_KEY);
    if (cached) return JSON.parse(cached);

    // Prisma's JSON-field null filtering (`{ allowedOrigins: { not: null } }` /
    // `NOT: { allowedOrigins: null }`) has sharp edges around SQL NULL vs.
    // JSON null that aren't worth fighting here — fetch all rows and filter
    // in JS instead (the loop below already treats a null/missing array as
    // "no origins" via `|| []`).
    const [keys, campaigns] = await Promise.all([
      this.prisma.developerApiKey.findMany({
        where: { isActive: true },
        select: { allowedOrigins: true },
      }),
      this.prisma.campaign.findMany({
        select: { allowedOrigins: true },
      }),
    ]);

    const origins = new Set<string>();
    for (const key of keys) {
      for (const origin of (key.allowedOrigins as string[]) || []) origins.add(origin);
    }
    for (const campaign of campaigns) {
      for (const origin of (campaign.allowedOrigins as string[]) || []) origins.add(origin);
    }

    const result = Array.from(origins);
    await this.redis.set(ALL_ORIGINS_CACHE_KEY, JSON.stringify(result), 'EX', ALL_ORIGINS_CACHE_TTL_SECONDS);
    return result;
  }

  // No Origin header means a server-to-server call (curl, a backend proxy)
  // — not something a browser enforces CORS against, and exactly the
  // pattern the integration guide recommends (never call this API directly
  // from browser JS with a raw key). Nothing to check against, so it passes.
  checkOrigin(
    key: { allowedOrigins: unknown; campaign: { allowedOrigins: unknown } },
    origin: string | undefined,
  ): boolean {
    if (!origin) return true;

    const keyOrigins = key.allowedOrigins as string[] | null;
    const campaignOrigins = key.campaign.allowedOrigins as string[] | null;
    const originList = (keyOrigins && keyOrigins.length > 0 ? keyOrigins : campaignOrigins) || [];

    return originList.includes(origin);
  }
}
