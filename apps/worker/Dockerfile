# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Install deps using monorepo workspace
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages packages
COPY apps/worker apps/worker
RUN pnpm install --frozen-lockfile

# Build
FROM deps AS build
RUN pnpm --filter @metu/worker build

# Runtime image
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=deps  /app/packages ./packages
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY apps/worker/package.json ./apps/worker/package.json
EXPOSE 8080
CMD ["node", "apps/worker/dist/index.js"]
