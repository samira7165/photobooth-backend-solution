import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { DeveloperKeysService } from '../../developer-keys/developer-keys.service';

// Applied via @RequireApiKey() (see require-api-key.decorator.ts) instead of
// the JWT flow every other route uses. Reads x-api-key, validates it,
// confirms the key's own campaign is active, isn't over its per-minute
// limit, and the request's Origin (if any) is allowed — then attaches
// { developerKey, campaign } to the request for the controller to use, so
// public-api routes never need a campaignId in the URL or body.
@Injectable()
export class DeveloperApiKeyGuard implements CanActivate {
  constructor(private developerKeysService: DeveloperKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { developerKey?: any; campaign?: any }>();

    const rawKey = request.headers['x-api-key'];
    if (!rawKey || typeof rawKey !== 'string') {
      throw new UnauthorizedException('Missing API key. Send it in the "x-api-key" header.');
    }

    const keyRecord = await this.developerKeysService.validateKey(rawKey);
    if (!keyRecord) {
      throw new UnauthorizedException('Invalid or revoked API key.');
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('This API key has expired.');
    }

    // Reuses Campaign.status (no separate isActive column) — the same
    // enum every other part of the app already treats as the source of
    // truth for whether a campaign is live.
    if (keyRecord.campaign.status !== 'ACTIVE') {
      throw new ForbiddenException('This campaign is not currently active.');
    }

    const withinLimit = await this.developerKeysService.checkRateLimit(keyRecord.id);
    if (!withinLimit) {
      throw new HttpException(
        `Rate limit exceeded (${keyRecord.rateLimit} requests/minute for this key). Try again shortly.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const origin = request.headers.origin;
    if (!this.developerKeysService.checkOrigin(keyRecord, origin)) {
      throw new ForbiddenException(`Origin "${origin}" is not allowed for this API key.`);
    }

    request.developerKey = keyRecord;
    request.campaign = keyRecord.campaign;
    return true;
  }
}
