import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors, { CorsOptionsDelegate } from 'cors';
import { DeveloperKeysService } from './developer-keys/developer-keys.service';
import { CorsService } from './common/services/cors.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Security headers. crossOriginResourcePolicy defaults to 'same-origin',
  // which would make browsers block <img> loads of /uploads/... files from
  // the admin dashboard (a different origin/port) even though CORS above
  // allows it — CORP and CORS are separate checks. Since this API is
  // intentionally consumed from other origins (the dashboard, the booth
  // frontend), relax it to 'cross-origin' to match that trust model.
  // CSP is close to a no-op here (this app serves JSON + raw uploaded
  // images, no HTML/inline scripts of its own) but costs nothing and blocks
  // the browser from ever executing/loading anything unexpected if a
  // response were ever coerced into being rendered as HTML.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
        },
      },
    }),
  );

  // Body size limits — bounds JSON/urlencoded payloads so a huge request body
  // can't be used as a cheap DoS. Multipart file uploads (photos, background/
  // frame/prop images) go through multer instead, which already enforces its
  // own limit via MAX_FILE_SIZE (see assets.module.ts / submissions.module.ts).
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // Serve uploaded asset files — e.g. http://localhost:3000/uploads/campaigns/...
  // Note: this is NOT affected by setGlobalPrefix() below, since static-asset
  // middleware sits outside Nest's controller routing. So local files live at
  // /uploads/... directly, without the /api/v1 prefix every controller route gets.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  // Validate & transform incoming DTOs, strip unknown properties
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS — dynamic origin check for the admin dashboard/booth frontends
  // (cookie-based JWT, so credentials: true), but /api/v1/public/* (external
  // developer keys, no cookies involved) needs its own origin check based on
  // per-campaign/per-key `allowedOrigins` from the database instead of this
  // one. A single delegate branches on path so both policies run through
  // one middleware instead of two conflicting `cors()` instances.
  //
  // Note this can only check the request Origin against the union of every
  // known public-api origin, not one specific key's list — browsers never
  // send the actual x-api-key value on a CORS preflight (OPTIONS) request,
  // only on the real request that follows. DeveloperApiKeyGuard (which does
  // see the key on that real request) is what enforces the exact per-key
  // allowedOrigins; see DeveloperKeysService.checkOrigin/getAllKnownOrigins.
  const developerKeysService = app.get(DeveloperKeysService);
  const corsService = app.get(CorsService);

  // Known ahead of time, regardless of environment — booth/admin frontends
  // that always run on the same fixed host. ALLOWED_ORIGINS covers ones that
  // vary per deployment (e.g. a client's own booth domain) without a code
  // change; per-campaign allowedOrigins (via CorsService) covers ones that
  // aren't known until a campaign is created.
  const staticAdminOrigins = [
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
    process.env.FRONTEND_URL,
    process.env.ADMIN_URL,
  ].filter(Boolean);
  const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const isDev = process.env.NODE_ENV === 'development';

  const checkAdminOrigin = async (origin: string | undefined): Promise<boolean> => {
    // No Origin header = server-to-server (curl, Postman, a mobile app) —
    // not something a browser enforces CORS against, so nothing to check.
    if (!origin) return true;
    // Dev convenience: any localhost port is trusted, so booth frontends
    // spun up on a new port don't need a code change + restart to be seen.
    if (isDev && origin.startsWith('http://localhost:')) return true;
    if (staticAdminOrigins.includes(origin)) return true;
    if (envAllowedOrigins.includes(origin)) return true;
    return corsService.isAllowedOrigin(origin);
  };

  const corsOptionsDelegate: CorsOptionsDelegate<any> = async (req, callback) => {
    const isPublicApi = req.path?.startsWith('/api/v1/public');

    if (!isPublicApi) {
      try {
        const allowed = await checkAdminOrigin(req.header('Origin'));
        callback(null, {
          origin: allowed,
          methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
          credentials: true,
        });
      } catch (err) {
        // Same fail-closed reasoning as the public-api branch below — this
        // runs as raw Express middleware, outside Nest's exception filters.
        console.error('CORS origin check failed for admin/booth request:', err);
        callback(null, {
          origin: false,
          methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
          credentials: true,
        });
      }
      return;
    }

    // This runs as raw Express middleware, outside Nest's request pipeline —
    // none of the app's exception filters apply here, so an uncaught error
    // (e.g. a bad Prisma query) doesn't turn into a clean 500, it crashes
    // the entire process. Fail closed (deny the origin) and log instead.
    try {
      const requestOrigin = req.header('Origin');
      // No Origin header = server-to-server (curl, a backend proxy) — not
      // something a browser enforces CORS against, so nothing to check.
      let originAllowed = true;
      if (requestOrigin) {
        const knownOrigins = await developerKeysService.getAllKnownOrigins();
        originAllowed = knownOrigins.includes(requestOrigin);
      }

      callback(null, {
        origin: originAllowed,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'x-api-key'],
        credentials: false, // auth is a header (x-api-key), not a cookie
      });
    } catch (err) {
      console.error('CORS origin check failed for /api/v1/public/* request:', err);
      callback(null, {
        origin: false,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'x-api-key'],
        credentials: false,
      });
    }
  };

  app.use(cors(corsOptionsDelegate));

  // Global rate limiting
  app.use(
    rateLimit({
      windowMs: (parseInt(process.env.RATE_LIMIT_TTL) || 60) * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
      message: {
        success: false,
        statusCode: 429,
        error: 'Too many requests. Please try again later.',
      },
    }),
  );

  // Global prefix — all routes start with /api/v1
  app.setGlobalPrefix('api/v1');

  // Dev-only sanity check on the secrets used to sign tokens / encrypt API
  // keys at rest — warns, never blocks startup. A fuller audit (including
  // whether any user is still on the seeded default password) lives in
  // scripts/check-env-security.js, meant to be run manually/in CI.
  if (process.env.NODE_ENV === 'development') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('change-this')) {
      console.warn('⚠️  WARNING: JWT_SECRET is still using the default placeholder. Change before production!');
    }
    if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.includes('change-this')) {
      console.warn('⚠️  WARNING: JWT_REFRESH_SECRET is still using the default placeholder. Change before production!');
    }
    if (!process.env.ENCRYPTION_SECRET || process.env.ENCRYPTION_SECRET.includes('change-this')) {
      console.warn('⚠️  WARNING: ENCRYPTION_SECRET is missing or using a placeholder. API keys are not properly secured!');
    }
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}/api/v1`);
}

bootstrap();
