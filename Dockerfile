# The API with the audit worker in the same process (RUN_WORKER=1): one service for a free tier.
# Bun runs the TypeScript as is, so there's no build step, only a production install.
#
#   docker build -t aloud-api .
#   docker run --rm -p 4100:4100 -e DATABASE_URL=... -e REDIS_URL=... aloud-api

FROM oven/bun:1.1 AS deps
WORKDIR /app
# Every workspace's package.json, so the lockfile matches; only the server's packages get installed.
COPY package.json bun.lockb ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/providers/package.json packages/providers/
RUN bun install --frozen-lockfile --production --filter '@aloud/api'

FROM oven/bun:1.1-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4100 \
    RUN_WORKER=1 \
    IMAGE_CACHE_DIR=/app/data/images

COPY --from=deps /app/node_modules node_modules
COPY package.json bun.lockb tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
# Saved listings and recorded model answers: the demo audits from these with no paid calls.
COPY fixtures fixtures

# With a Gemini key, new model answers are recorded into fixtures/llm and images cached in data/,
# so the app user needs to write there. Both are lost on redeploy, which is fine for a demo.
RUN mkdir -p data/images && chown -R bun:bun data fixtures
USER bun

EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4100) + '/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# Migrations first (they create the database if it's missing), then the API and worker.
CMD ["sh", "-c", "bun packages/db/src/migrate.ts && exec bun apps/api/src/main.ts"]
