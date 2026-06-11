FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/kook-adapter/package.json apps/kook-adapter/package.json
RUN pnpm install --filter @dfc/kook-adapter... --frozen-lockfile=false

COPY packages/shared packages/shared
COPY apps/kook-adapter apps/kook-adapter
RUN pnpm --filter @dfc/kook-adapter build

CMD ["pnpm", "--filter", "@dfc/kook-adapter", "start"]
