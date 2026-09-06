# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
# Must match the production stage's OpenSSL presence below — `prisma generate`
# here auto-detects the binary target from *this* environment, so if this
# stage doesn't have OpenSSL but production does, the engine binary generated
# here won't match what the running container looks for at startup
# ("could not locate the Query Engine for runtime linux-musl-openssl-3.0.x").
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production
WORKDIR /app
# Alpine ships without OpenSSL, which Prisma's engine needs to detect the
# right binary target — without it, Prisma silently falls back to a guess
# ("Prisma failed to detect the libssl/openssl version") and then tries to
# fetch/write a replacement engine at runtime, which fails once running as
# a non-root user below.
RUN apk add --no-cache openssl
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
# COPY --from defaults to root:root ownership regardless of the builder
# stage's own user — appuser needs write access under node_modules/@prisma
# for `prisma migrate deploy` below to work at all.
RUN chown -R appuser:appgroup /app

ENV NODE_ENV=production
USER appuser
EXPOSE 3000
# Applies any pending migrations against the runtime DATABASE_URL before the
# app starts — the image only bundles migration files, it never runs them
# against a real database at build time.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
