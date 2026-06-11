FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ui/package.json packages/ui/package.json
COPY apps/customer-web/package.json apps/customer-web/package.json
RUN pnpm install --filter @dfc/customer-web... --frozen-lockfile=false

COPY packages/ui packages/ui
COPY apps/customer-web apps/customer-web
RUN pnpm --filter @dfc/customer-web build

EXPOSE 3000
CMD ["pnpm", "--filter", "@dfc/customer-web", "start"]
