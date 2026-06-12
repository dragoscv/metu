# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Install deps using monorepo workspace
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages packages
COPY apps/mcp-server apps/mcp-server
RUN pnpm install --frozen-lockfile

# Build (TS -> dist)
FROM deps AS build
RUN pnpm --filter @metu/mcp-server build

# Runtime image
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=deps  /app/packages ./packages
COPY --from=build /app/apps/mcp-server/dist ./apps/mcp-server/dist
COPY apps/mcp-server/package.json ./apps/mcp-server/package.json
# Drop root — the node:alpine image ships a non-root `node` user.
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/mcp-server/dist/index.js"]
