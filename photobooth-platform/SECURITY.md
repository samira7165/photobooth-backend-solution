# Security

This document describes the security controls actually implemented in this
codebase, and known gaps that still need attention before a production
deploy. It reflects the state of the code as of Phase 15 (verified by
reading the implementation, not just the intent).

## Secrets

- All secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_SECRET`,
  `DATABASE_URL`, etc.) live in `.env`, which is gitignored (`.gitignore`
  covers `.env` explicitly) and never committed.
- `src/main.ts` warns on startup in development mode if `JWT_SECRET`,
  `JWT_REFRESH_SECRET`, or `ENCRYPTION_SECRET` are missing or still contain
  the placeholder text `change-this`. It warns only — it does not block
  startup, so this is a development safety net, not an enforcement
  mechanism.
- `scripts/check-env-security.js` (`npm run check:env-security`) runs a
  fuller audit on demand: secret length/placeholder checks, plus a live
  database check for any user still on the seed script's default password.
- **Known gap as of this writing:** `JWT_SECRET` and `JWT_REFRESH_SECRET` in
  this environment's `.env` still contain the default placeholder text, and
  the seeded `admin@xri.com.bd` account is still on the default password
  (`admin123456`, set in `prisma/seed.ts`). Both must be rotated before any
  production deploy — run `npm run check:env-security` to re-verify.

## API key encryption at rest

Provider API keys (`ApiKey.encryptedKey`) are encrypted with AES-256-GCM
(`src/common/utils/encryption.ts`) before being written to the database. The
encryption key is derived from `ENCRYPTION_SECRET` (falling back to
`JWT_SECRET` if unset) via `scrypt`, so brute-forcing the derived key is
expensive even if it leaked. GCM's auth tag means a tampered ciphertext
fails to decrypt rather than silently returning garbage — covered by
`ai-providers.service.spec.ts`'s encryption round-trip tests.

## Passwords

- Hashed with bcrypt at cost factor 12 (`src/users/users.service.ts`,
  `prisma/seed.ts`).
- New/changed passwords must be at least 8 characters and contain at least
  one uppercase letter, one lowercase letter, and one digit
  (`src/users/dto/create-user.dto.ts`, `change-password.dto.ts`) — enforced
  by the global `ValidationPipe`.
- Login itself only bounds payload size (`LoginDto`), not password
  strength — you can't retroactively enforce a policy on a password that
  was already set, and doing so would just leak information about which
  passwords are "valid-shaped" to an attacker.

## Tokens

- Access tokens expire in 15 minutes (`JWT_EXPIRES_IN`), refresh tokens in
  7 days (`JWT_REFRESH_EXPIRES_IN`) — both configurable via `.env`.
- Access and refresh tokens are signed with **separate secrets**
  (`JWT_SECRET` / `JWT_REFRESH_SECRET`), so a leaked access token can't be
  replayed to mint new refresh tokens.

## Rate limiting

Two independent layers, both already active:

- **Global**: `express-rate-limit` in `main.ts` (`RATE_LIMIT_MAX`,
  default 100/min) plus `@nestjs/throttler`'s `ThrottlerGuard`, applied
  globally via `APP_GUARD` in `app.module.ts` (`ThrottlerModule.forRoot`,
  100/min default).
- **Per-route, tighter limits on sensitive endpoints**, via `@Throttle()`:
  - `POST /auth/login` — 5 attempts / 15 minutes per IP.
  - `POST /submissions/booth/:slug/session` — 10/min per IP.
  - `POST /submissions/booth/:slug/submit` — 5/min per IP.
  - `GET /submissions/booth/status/:id` — 60/min per IP.

## File upload validation

Both upload paths reject a file whose actual decoded content doesn't match
an allowed image format — not just its claimed `Content-Type` header, which
is trivially spoofed (rename a `.txt` to `.jpg`):

- `AssetsService.saveAssetFiles()` (backgrounds/frames/props) and
  `SubmissionsService.submitPhoto()` (booth photos) both call
  `ImageOptimizer.validateImage()`, which decodes the buffer with `sharp`
  and checks the real format sharp detected — a forged extension/MIME type
  with non-image bytes fails this check and is rejected with
  `BadRequestException`.
- Multer additionally enforces a max upload size (`MAX_FILE_SIZE`, default
  10MB) per file, independent of the JSON/urlencoded body size limits below.

## Request size limits

`main.ts` caps JSON and urlencoded request bodies at 10MB
(`express`'s `json()`/`urlencoded()` middleware) to bound non-multipart
payload size. Multipart file uploads are governed separately by multer's
own `MAX_FILE_SIZE` limit (see above).

## CORS

`main.ts`'s `enableCors()` allow-list is explicit — `FRONTEND_URL`,
`ADMIN_URL`, and the two localhost dev ports — never a `*` wildcard.
Credentialed requests (cookies/auth headers) only work from an origin on
that list.

## Security headers

`helmet()` is applied globally in `main.ts`, including a Content-Security-
Policy (`default-src 'self'`, `img-src 'self' data: https:`,
`script-src 'self'`). `crossOriginResourcePolicy` is deliberately relaxed
to `cross-origin` (not helmet's default `same-origin`) so the admin
dashboard and booth frontend — different origins — can load images served
from `/uploads/...`; that relaxation is intentional and scoped, not a
blanket disabling of the policy.

## Role-based access control

Every controller route that isn't explicitly `@Public()` requires a valid
JWT (`JwtAuthGuard`, applied globally). Most routes additionally carry
`@Roles(...)`, checked by `RolesGuard` against the hierarchy
`VIEWER < OPERATOR < ADMIN < SUPER_ADMIN` (a higher role satisfies a
lower-role requirement). Destructive/sensitive operations
(campaign/user/API-key deletion, user creation, password changes, queue
control) require `ADMIN` or `SUPER_ADMIN` specifically.

## SQL/NoSQL injection

All database access goes through Prisma's generated client, which
parameterizes every query. Audited (`grep -rn '\$queryRaw\|\$executeRaw' src`)
— no raw-SQL escape hatches exist anywhere in the codebase.

## Testing

- Unit tests (`npm run test`): `auth.service.spec.ts` (login/refresh token
  logic), `campaigns.service.spec.ts` (status transition state machine,
  slug uniqueness), `ai-providers.service.spec.ts` (encryption round-trip,
  key-selection filtering — inactive/unhealthy/over-limit/high-error keys
  correctly excluded).
- Integration test (`npm run test:e2e`): `booth-flow.e2e-spec.ts`, run
  against the real database and Redis (not mocked) — booth config lookup
  for a missing/inactive campaign, and photo submission to a missing
  campaign.
