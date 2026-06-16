# syntax=docker/dockerfile:1.7
# Hub runs via tsx (same as dev) to avoid ESM/CJS emit pitfalls with the
# workspace's extensionless imports + top-level await. tsx resolves TS
# sources and workspace packages natively.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages packages
COPY apps/hub apps/hub
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HUB_PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps/hub ./apps/hub
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tsx is a devDep of @metu/hub; its .bin shim lives in the package's
# node_modules (pnpm doesn't hoist bins to the workspace root).
CMD ["apps/hub/node_modules/.bin/tsx", "apps/hub/src/index.ts"]
