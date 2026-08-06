import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

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

  // CORS — allow frontend URLs
  app.enableCors({
    origin: [
      'http://localhost:3001',
      'http://localhost:3002',
      process.env.FRONTEND_URL,
      process.env.ADMIN_URL,
    ].filter(Boolean),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    credentials: true,
  });

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
