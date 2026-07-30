import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Security headers
  app.use(helmet());

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

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}/api/v1`);
}

bootstrap();
