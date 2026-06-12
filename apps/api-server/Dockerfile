FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api-server/package.json apps/api-server/package.json
COPY packages packages
COPY scripts scripts
RUN pnpm install --filter @dfc/api-server... --frozen-lockfile=false
COPY apps/api-server apps/api-server
RUN mkdir -p apps/api-server/prisma \
  && cp packages/database/prisma/schema.prisma apps/api-server/prisma/schema.prisma \
  && pnpm --filter @dfc/api-server exec prisma generate --schema prisma/schema.prisma
RUN pnpm --filter @dfc/api-server build

EXPOSE 4000
CMD ["pnpm", "--filter", "@dfc/api-server", "start"]
