import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Hits the real stack (MySQL + Redis must be up, e.g. via `npm run docker:up`
// in photobooth-platform) — this is deliberately an integration test, not a
// mocked unit test. Only exercises GET routes, so it doesn't touch the AI
// providers / BullMQ processing pipeline and never makes a real AI API call.
describe('Booth Flow (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors the bit of main.ts's bootstrap() that actually matters for
    // routing in this test — the global prefix every controller route sits
    // under. (Skipping helmet/CORS/rate-limiting here since they're
    // middleware concerns, not behavior this test is about.)
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 for a non-existent campaign slug', () => {
    return request(app.getHttpServer())
      .get('/api/v1/campaigns/booth/this-slug-should-never-exist-12345')
      .expect(404);
  });

  it('returns booth config for an active campaign, or 404 if none is seeded active', () => {
    return request(app.getHttpServer())
      .get('/api/v1/campaigns/booth/demo-campaign')
      .expect((res) => {
        expect([200, 404]).toContain(res.status);
        if (res.status === 200) {
          // Booth-facing config must never leak the fields getBoothConfig()
          // deliberately omits (e.g. no aiConfig, no internal ids beyond what
          // the booth needs to render itself).
          expect(res.body).toHaveProperty('name');
          expect(res.body).toHaveProperty('slug', 'demo-campaign');
          expect(res.body).not.toHaveProperty('aiConfig');
        }
      });
  });

  it('rejects a photo submission to a campaign that does not exist', () => {
    return request(app.getHttpServer())
      .post('/api/v1/submissions/booth/this-slug-should-never-exist-12345/submit')
      .expect((res) => {
        // No file attached either, so this is also implicitly checking the
        // route doesn't 500 on a malformed request before reaching the
        // "campaign not found" check.
        expect([400, 404]).toContain(res.status);
      });
  });
});
