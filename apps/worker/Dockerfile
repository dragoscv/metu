# syntax=docker/dockerfile:1.7
# Worker runs via tsx (same as dev) — the source uses extensionless ESM
# relative imports + workspace packages that Node's ESM loader can't resolve
# from tsc output. tsx handles both natively.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages packages
COPY apps/worker apps/worker
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps/worker ./apps/worker
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["apps/worker/node_modules/.bin/tsx", "apps/worker/src/index.ts"]
