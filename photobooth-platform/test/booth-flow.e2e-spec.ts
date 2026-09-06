import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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

// Real, unmocked database — the point of this suite is proving the
// conditional-updateMany claim in SubmissionsService.print() actually
// serializes correctly under MySQL's row locking, which a mocked Prisma
// client cannot demonstrate (see submissions.service.spec.ts for the
// mocked unit coverage of print()'s branch logic instead).
//
// Requires the standard seed (`npx prisma db seed` / `npm run prisma:seed`)
// to have run at least once against this database, for the admin login.
describe('Submission print tracking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let campaignId: string;
  let submissionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@xri.com.bd', password: 'admin123456' })
      .expect(201);
    adminToken = login.body.accessToken;

    const campaign = await prisma.campaign.create({
      data: {
        name: 'E2E Print Test Campaign',
        slug: `e2e-print-test-${Date.now()}`,
        status: 'ACTIVE',
        processingMode: 'ai',
      },
    });
    campaignId = campaign.id;
  });

  afterAll(async () => {
    // Cascades to every submission created below too (Submission.campaign
    // is onDelete: Cascade) — no per-test cleanup needed.
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => undefined);
    await app.close();
  });

  beforeEach(async () => {
    // A fresh COMPLETED submission per test, so print state from one test
    // never leaks into the next.
    const submission = await prisma.submission.create({
      data: {
        campaignId,
        originalUrl: 'test/original.jpg',
        resultUrl: 'test/result.png',
        status: 'COMPLETED',
        mode: 'ai',
      },
    });
    submissionId = submission.id;
  });

  it('rejects an unauthenticated print request', () => {
    return request(app.getHttpServer())
      .patch(`/api/v1/submissions/${submissionId}/print`)
      .expect(401);
  });

  it('rejects printing a submission that does not exist', () => {
    return request(app.getHttpServer())
      .patch('/api/v1/submissions/00000000-0000-0000-0000-000000000000/print')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('prints successfully once, then reports alreadyPrinted on a second request', async () => {
    const first = await request(app.getHttpServer())
      .patch(`/api/v1/submissions/${submissionId}/print`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(first.body).toEqual(expect.objectContaining({ success: true, alreadyPrinted: false }));

    const second = await request(app.getHttpServer())
      .patch(`/api/v1/submissions/${submissionId}/print`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(second.body).toEqual(expect.objectContaining({ success: false, alreadyPrinted: true }));
  });

  // The real point of this suite: fire two PATCH requests at the exact same
  // submission concurrently and prove only ONE can ever see success:true —
  // not a mocked assertion, an actual race against the real database.
  it('only lets one of two simultaneous print requests succeed', async () => {
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/submissions/${submissionId}/print`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app.getHttpServer())
        .patch(`/api/v1/submissions/${submissionId}/print`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);

    const successes = [a, b].filter((r) => r.body.success === true);
    expect(successes.length).toBe(1);

    const final = await prisma.submission.findUnique({ where: { id: submissionId } });
    expect(final?.printStatus).toBe('PRINTED');
    // Only the winner's updateMany ever matched a row — the loser's WHERE
    // (printStatus IN NOT_PRINTED/FAILED) matched nothing once the winner's
    // claim committed, so its printAttempts increment never applied either.
    expect(final?.printAttempts).toBe(1);
  });
});
