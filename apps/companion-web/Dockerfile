FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ui/package.json packages/ui/package.json
COPY apps/companion-web/package.json apps/companion-web/package.json
RUN pnpm install --filter @dfc/companion-web... --frozen-lockfile=false

COPY packages/ui packages/ui
COPY apps/companion-web apps/companion-web
RUN pnpm --filter @dfc/companion-web build

EXPOSE 3001
CMD ["pnpm", "--filter", "@dfc/companion-web", "start"]
