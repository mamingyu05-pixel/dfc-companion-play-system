FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/discord-bot/package.json apps/discord-bot/package.json
COPY packages/shared packages/shared
RUN pnpm install --filter @dfc/discord-bot... --frozen-lockfile=false
COPY apps/discord-bot apps/discord-bot
RUN pnpm --filter @dfc/discord-bot build

CMD ["pnpm", "--filter", "@dfc/discord-bot", "start"]
