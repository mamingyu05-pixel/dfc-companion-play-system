# Delta Force Club (DFC) 电竞陪玩俱乐部

2026-10-27继续优化：后台用户页已在独立候选实现分页与有限候选搜索，并完成冷备独立恢复演练；源码发布状态和证据见[本轮优化](docs/OPTIMIZATION_USERS_20261027.md)。当前运行版、入口和旧改动保留情况见[当前索引](docs/CURRENT_CHECKOUT_AND_ACCEPTANCE.md)。

当前维护副本与验收版本的区别、现有页面及运行入口见 [当前工程与验收索引](docs/CURRENT_CHECKOUT_AND_ACCEPTANCE.md)；本轮本地施工与保存/归档记录见 [2026-10-27维护说明](docs/MAINTENANCE_20261027.md)。旧验收回执只证明它绑定的提交；不据此宣称当前副本已经上线。

DFC 是面向《三角洲行动》的电竞陪玩俱乐部 SaaS 系统。第一阶段只实现最小商业闭环：

管理员创建陪玩 -> 客户注册 -> 客户提交充值申请 -> 管理员审核充值 -> 客户余额增加 -> 客户确认服务与报价 -> 从钱包余额冻结订单金额 -> 订单待派单 -> Discord/KOOK 同步通知 -> 陪玩接单 -> 订单开始 -> 订单完成 -> 平台抽成 -> 陪玩收益增加 -> 陪玩申请提现 -> 管理员审核提现 -> 人工打款完成。

当前源码包含客户网页的选服务、服务端报价、确认冻结钱包余额及回执恢复流程；试音和预约可先生成需求。网页还支持人工充值申请、投诉和服务验收。本次已验证 Windows 本机 API 与三端生产构建、独立 PostgreSQL 回归及同源访问，见 [Windows 本机部署](docs/LOCAL_WINDOWS_DEPLOYMENT.md)。公网发布、真实支付和 KOOK/微信连接均未验证。

已有原生小程序源码保留在 `apps/miniapp-native`，默认使用内存模拟。微信登录的服务端身份处理、客户端会话与迁移已有源码和离线测试；真实微信登录/真机验收仍未验证。隔离 TEST API 入口见 [隔离测试说明](scripts/isolated-test-api/README.md)，其合成 HTTP/数据库结果与真实微信环境分别验收。第一阶段仍以三端网页闭环为准，不新增小程序能力。

## 当前范围

已纳入第一阶段：

- Customer Portal: `/customer`
- Companion Portal: `/companion`
- Admin Portal: `/admin`
- NestJS API：注册、人工充值审核、钱包冻结、派单、验收、结算和提现审核
- Prisma 数据模型
- Discord Bot 通知与接单回写（真实平台本轮未验证）
- KOOK Bot 通知与接单回写（真实平台本轮未验证）
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

已验证的低内存 Windows 入口见 [Windows 本机部署](docs/LOCAL_WINDOWS_DEPLOYMENT.md)，无需启动 Docker/WSL。以下为原有 Docker 开发基线。

以下为开发配置流程；模板中的示例值只用于本机测试，外部通知和付款应保持关闭。本轮检查使用已运行的隔离 PostgreSQL，没有启动 Docker：

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm seed:admin
pnpm dev
```

## 检查与测试

`pnpm lint` 执行各工作包的 TypeScript 类型检查；`pnpm test` 执行 API 测试一次和动态发现的业务回归一次。API 测试要求显式的本机合成测试库，不能指向业务数据库。命令、结果和未验证范围见 [测试报告](docs/TEST_REPORT.md)。

竞品分析文档已保存，仍待你验收：[DFC竞品分析](docs/workbench/competitor-miniapp-analysis-2026-10-13.md)。

## 测试账号

初始化脚本读取 `.env`：

```text
ADMIN_EMAIL=admin@dfc.local
ADMIN_PASSWORD=ChangeMe123!
```

**上线前必须修改示例管理员密码，不能把模板密码用于公开环境。** 本机发布运行使用私有运行配置，不从这段示例读取凭据。

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
node scripts/platform-setup/master-index.js
node scripts/platform-setup/master-index.js --discord-only
node scripts/platform-setup/master-index.js --kook-only
```

`master-index.js` 会执行频道重命名、权限修正、频道简介横幅图文重置、考核/违规内容、运营内容和 KOOK 同步。频道简介横幅图片放在 `scripts/platform-setup/banners/`。

价目表发布脚本会检查 `scripts/platform-setup/price-cards/` 下的价目图，Discord 创建/复用 `💰｜价格清单` 论坛，KOOK 发布到服务价目频道。默认只演练，不修改频道：

```bash
node scripts/platform-setup/publish-price-list.js
```

确认后真实发布：

```bash
node scripts/platform-setup/publish-price-list.js --apply --confirm-publish
node scripts/platform-setup/publish-price-list.js --discord-only --apply --confirm-publish
node scripts/platform-setup/publish-price-list.js --kook-only --apply --confirm-publish
```

如需清理旧版价目后重新发布新版：

```bash
node scripts/platform-setup/publish-price-list.js --apply --confirm-publish --replace-existing --confirm-replace-price-list
```

该重发模式会清空 Discord `💰｜价格清单` 论坛内旧帖，并删除 KOOK 服务价目频道内带 `[MayCatPriceList:...]` 标记的旧消息，再发布新版。

新版价目是段位分档价，不再是统一价。部署后如需检查上一版遗留的 `128/108` 扁平价，先在 API 容器里审计；确认后只会把这些旧字段回到 `¥98 起` 基线，不会覆盖后续手动设置的高段位价：

```bash
docker compose exec api-server node scripts/platform-setup/sync-price-policy.js
docker compose exec api-server node scripts/platform-setup/sync-price-policy.js --apply --confirm-rank-baseline
```

旧的分步入口仍可单独使用：

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

Xiaoxiao Esports 频道走查修复第 04 版可清理 Discord / KOOK 重复 Bot 简介、错位内容、测试消息，并补齐入职须知、社区守则、好评展示、预存福利和 tag 登记说明。第 04 版历史方案按“预存钱包制、群内下单、网页只读查询”修正文案；当前网页范围以本文开头为准，仍支持人工充值申请、投诉和服务验收。默认只审计，不修改频道：

```bash
node scripts/platform-setup/walkthrough-fix-04.js
```

确认审计计划后执行清理：

```bash
node scripts/platform-setup/walkthrough-fix-04.js --apply --confirm-cleanup
```

如需只跑单端：

```bash
node scripts/platform-setup/walkthrough-fix-04.js --discord-only
node scripts/platform-setup/walkthrough-fix-04.js --kook-only
```

本脚本会按任务卡第 04 版已定方案合并 C07/C08，替换 C19 自助下单文案，并处理 KOOK K02/K03；删除/改名/发消息必须同时传入 `--apply --confirm-cleanup`。
