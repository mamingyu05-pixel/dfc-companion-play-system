# Delta Force Club (DFC) 电竞陪玩俱乐部

DFC 是面向《三角洲行动》的电竞陪玩俱乐部 SaaS 系统。第一阶段只实现最小商业闭环：

管理员创建陪玩 -> 客户注册 -> 客户提交充值申请 -> 管理员审核充值 -> 客户余额增加 -> 客户下单 -> 订单待派单 -> Discord/KOOK 同步通知 -> 陪玩接单 -> 订单开始 -> 订单完成 -> 平台抽成 -> 陪玩收益增加 -> 陪玩申请提现 -> 管理员审核提现 -> 人工打款完成。

## 当前范围

已纳入第一阶段：

- Customer Portal: `/customer`
- Companion Portal: `/companion`
- Admin Portal: `/admin`
- NestJS API 服务骨架
- Prisma 数据模型
- Discord Bot 通知与接单回写骨架
- KOOK Bot 通知与接单回写骨架
- Docker Compose 本地部署基线
- 业务流、API、数据库、测试清单文档

明确禁止第一阶段开发：

- APP
- 小程序
- 多游戏系统
- 自动支付
- 自动提现

## 目录

```text
apps/
  customer-web/
  companion-web/
  admin-web/
  api-server/
  discord-bot/
  kook-adapter/
packages/
  database/
  shared/
  auth/
  ui/
  config/
docs/
infra/
scripts/
```

## 本地运行

当前仓库已提供工程基线。安装依赖后可运行：

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm seed:admin
pnpm dev
```

## 测试账号

初始化脚本读取 `.env`：

```text
ADMIN_EMAIL=admin@dfc.local
ADMIN_PASSWORD=ChangeMe123!
```

首次部署后必须修改管理员密码。

## 文档

- [项目计划](docs/PROJECT_PLAN.md)
- [数据库设计](docs/DATABASE_SCHEMA.md)
- [API 说明](docs/API_SPEC.md)
- [订单流](docs/ORDER_FLOW.md)
- [钱包流](docs/WALLET_FLOW.md)
- [Bot 流](docs/BOT_FLOW.md)
- [测试清单](docs/TEST_CHECKLIST.md)
- [部署文档](docs/DEPLOYMENT.md)
- [服务器要求](docs/SERVER_REQUIREMENTS.md)
- [上线运营准备文本](docs/GO_LIVE_OPERATIONS_GUIDE.txt)
- [UI/UX Design Agent](docs/UI_UX_DESIGN_AGENT.md)
- [UI 风格指南](docs/UI_STYLE_GUIDE.md)
- [UI 页面结构图](docs/UI_PAGE_STRUCTURE.md)
- [UI 组件清单](docs/UI_COMPONENTS.md)
- [多 Agent 工作流](docs/MULTI_AGENT_WORKFLOW.md)
- [测试报告](docs/TEST_REPORT.md)
- [已知问题](docs/KNOWN_ISSUES.md)
- [变更记录](docs/CHANGELOG.md)
## 平台频道搭建

Discord + KOOK 频道说明、服务价目、自助下单格式和派单规则可用脚本幂等同步：

```bash
node scripts/platform-setup/index.js
node scripts/platform-setup/index.js --discord-only
node scripts/platform-setup/index.js --kook-only
```

脚本从 `.env` / `.env.production` 读取 token 和频道 ID，不会硬编码密钥；重复运行会检查最近消息并跳过已发布内容。

频道权限、命名、顺序和 Bot 自有规则消息可用优化脚本幂等修正：

```bash
node scripts/platform-setup/optimize-index.js
node scripts/platform-setup/optimize-index.js --discord-only
node scripts/platform-setup/optimize-index.js --kook-only
```

Discord 重复频道先用审计脚本输出保留/清理建议，默认不修改频道：

```bash
node scripts/platform-setup/audit-discord-duplicates.js
```

建议先运行 `optimize-index.js --discord-only`，让正式点单频道移动到主导航分类后，再执行重复频道删除。

确认计划后如需只隐藏重复候选频道，可追加 `--hide-duplicates`；脚本不会删除频道或迁移历史消息。

如需删除重复候选频道，必须同时传入删除和确认参数：

```bash
node scripts/platform-setup/audit-discord-duplicates.js --delete-duplicates --confirm-delete-duplicate-channels
```

删除频道会永久删除该频道历史消息，脚本不会迁移历史消息。
