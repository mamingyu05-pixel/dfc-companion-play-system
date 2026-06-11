# 测试报告

日期：2026-06-11

## 当前测试结论

当前阶段为工程基线搭建，尚未安装依赖和启动数据库。已完成静态文件级检查，完整集成测试需在本机 Node.js、pnpm、Docker 可用后执行。

## 已覆盖

- Monorepo 目录存在。
- `.env.example` 存在。
- Docker Compose 存在 PostgreSQL、API、Discord Bot 服务。
- Prisma Schema 覆盖核心闭环实体。
- 三个门户入口路径存在：
  - `/customer`
  - `/companion`
  - `/admin`
- Discord Bot 按钮接单骨架存在。
- KOOK Bot HTTP 适配骨架存在，覆盖频道通知、私信、语音频道创建和角色授权接口。
- API 已存在 KOOK 接单回写入口。
- API 已存在 Discord/KOOK 外部账号绑定入口。
- API 已存在订单派单事务、双平台通知和通知失败记录服务。
- API 已存在 Discord/KOOK 接单事务防重复服务。
- Discord Bot 已从按钮点击调用 API。
- KOOK Webhook 已支持 challenge、verify token 和按钮接单回写入口。
- `.env.example` 与 `.env.production.example` 已包含 `BOT_INTERNAL_TOKEN`、`API_BASE_URL`、`KOOK_VERIFY_TOKEN`。
- UI/UX 第一版交付文档存在：
  - `UI_STYLE_GUIDE.md`
  - `UI_PAGE_STRUCTURE.md`
  - `UI_COMPONENTS.md`
  - `UI_RESPONSIVE_GUIDE.md`
  - `UI_PROTOTYPES.md`
  - `UI_FLOW_OPTIMIZATION.md`
- 三端 Tailwind 配置已接入共享 `dfcTailwindPreset`。
- Customer Portal 第一版页面存在：
  - `apps/customer-web/app/page.tsx`
  - `apps/customer-web/app/companions/page.tsx`
  - `apps/customer-web/app/companions/[id]/page.tsx`
  - `apps/customer-web/app/recharge/page.tsx`
  - `apps/customer-web/app/order/page.tsx`
- Customer Portal 已新增本地 UI 组件和示例数据。
- Companion Portal 第一版页面存在：
  - `apps/companion-web/app/page.tsx`
  - `apps/companion-web/app/login/page.tsx`
  - `apps/companion-web/app/available-orders/page.tsx`
  - `apps/companion-web/app/orders/page.tsx`
  - `apps/companion-web/app/earnings/page.tsx`
  - `apps/companion-web/app/withdrawals/page.tsx`
  - `apps/companion-web/app/profile/page.tsx`
- Admin Portal 第一版页面存在：
  - `apps/admin-web/app/page.tsx`
  - `apps/admin-web/app/login/page.tsx`
  - `apps/admin-web/app/users/page.tsx`
  - `apps/admin-web/app/companions/page.tsx`
  - `apps/admin-web/app/companions/new/page.tsx`
  - `apps/admin-web/app/orders/page.tsx`
  - `apps/admin-web/app/dispatch/page.tsx`
  - `apps/admin-web/app/recharges/page.tsx`
  - `apps/admin-web/app/withdrawals/page.tsx`
  - `apps/admin-web/app/complaints/page.tsx`
  - `apps/admin-web/app/finance/page.tsx`
  - `apps/admin-web/app/logs/page.tsx`
- Companion/Admin Portal 已新增本地 UI 组件和示例数据。
- 已新增语音展示、试音入口、平台代选下单的文档和静态 UI 表达。
- 多 Agent 审计工作流文件存在：
  - `agent_pipeline/agents.json`
  - `agent_pipeline/run_agents.py`
  - `agent_pipeline/README.md`
  - `docs/MULTI_AGENT_WORKFLOW.md`
- 所有 `package.json` 均可被 PowerShell `ConvertFrom-Json` 解析。
- 必需交付文件存在性检查通过。
- 关键订单状态、`wallet_transactions`、`order_status_logs`、`admin_logs` 在 Prisma Schema 和文档中存在。
- 部署文件存在性检查通过：
  - `.env.production.example`
  - `docker-compose.yml`
  - `infra/nginx/nginx.conf`
  - `infra/nginx/nginx.ssl.conf.template`
  - `scripts/server-bootstrap.sh`
  - `scripts/deploy.sh`
  - `scripts/enable-https.sh`
  - `scripts/backup-postgres.sh`
  - 三个 Web Dockerfile

## 待执行

```bash
corepack enable
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm build
pnpm test
```

## 当前环境限制

- `docker compose config` 未执行：当前环境未识别 `docker` 命令。
- `pnpm --version` 未执行：当前环境未识别 `pnpm` 命令。
- `node --version` 未执行：当前环境运行 `node.exe` 被拒绝访问。
- `python --version` 未执行：当前环境未识别 `python` 命令。
- `py --version` 未执行：当前环境未识别 `py` 命令。
- 因上述限制，未运行 Prisma validate、TypeScript build、Next build、Nest build 和自动化测试。
