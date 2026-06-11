FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ui/package.json packages/ui/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN pnpm install --filter @dfc/admin-web... --frozen-lockfile=false

COPY packages/ui packages/ui
COPY apps/admin-web apps/admin-web
RUN pnpm --filter @dfc/admin-web build

EXPOSE 3002
CMD ["pnpm", "--filter", "@dfc/admin-web", "start"]
