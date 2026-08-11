import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const CACHE_TTL_MS = 5 * 60 * 1000;

// Per-campaign CORS check for the admin/booth-frontend side of main.ts's
// origin function (the static allowlist + ALLOWED_ORIGINS env only cover
// origins known ahead of time — a campaign's own `allowedOrigins` lets a
// specific booth frontend be allowed without redeploying the backend).
// Deliberately a plain in-memory Map, not Redis: this only needs to survive
// for a few minutes on a single instance, and every request that reaches
// here already missed the static-list fast path, so DB load is the actual
// concern to cut, not cross-instance cache sharing.
@Injectable()
export class CorsService {
  private logger = new Logger(CorsService.name);
  private cache = new Map<string, { allowed: boolean; expiresAt: number }>();

  constructor(private prisma: PrismaService) {}

  async isAllowedOrigin(origin: string): Promise<boolean> {
    const cached = this.cache.get(origin);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.allowed;
    }

    let allowed = false;
    try {
      const campaigns = await this.prisma.campaign.findMany({
        where: { status: 'ACTIVE' },
        select: { allowedOrigins: true },
      });
      allowed = campaigns.some((c) => ((c.allowedOrigins as string[] | null) || []).includes(origin));
    } catch (err: any) {
      this.logger.error(`Origin lookup failed for "${origin}": ${err.message}`);
      allowed = false;
    }

    this.cache.set(origin, { allowed, expiresAt: Date.now() + CACHE_TTL_MS });
    return allowed;
  }

  // Campaign admins can add/remove allowedOrigins at any time — call this
  // from wherever a campaign is updated so a change takes effect immediately
  // instead of waiting out the cache TTL.
  clearCache(): void {
    this.cache.clear();
  }
}
