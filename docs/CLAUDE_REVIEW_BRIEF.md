# DFC 陪玩平台代码框架与业务闭环审核说明

本文档用于交给 Claude 或其他代码审核 Agent 快速理解当前仓库。审核重点应放在“最小商业闭环是否能真实跑通”，不要优先扩展新功能。

## 1. 项目定位

项目名称：Delta Force Club（DFC）电竞陪玩俱乐部

第一阶段定位：

- 电竞陪玩平台
- Discord 社群俱乐部
- KOOK 社群同步
- 管理后台
- 订单系统
- 钱包系统

第一阶段只支持：

- 三角洲行动

明确禁止第一阶段开发：

- APP
- 小程序
- 多游戏系统
- 自动支付
- 自动提现

核心原则：

- 先跑通商业闭环，再开发新功能。
- 金额必须后端计算。
- 订单、钱包、接单、结算必须使用数据库事务。
- Discord 和 KOOK 必须同时支持通知与接单回写。

## 2. 当前仓库状态

当前状态是“可审核的 Monorepo 框架 + 部分核心闭环代码 + 静态 UI 原型”，不是生产可上线成品。

已经有：

- Monorepo 目录结构
- Prisma 数据模型
- NestJS API 服务骨架
- Next.js 三端入口页面
- Discord Bot 接单回写
- KOOK Adapter 与 KOOK Webhook 骨架
- Docker Compose 与 Nginx 部署骨架
- 多 Agent 审核配置
- UI/UX 设计规范文档

尚未完整实现：

- JWT 登录与 RBAC 权限
- 客户充值审核真实入账
- 客户下单扣余额
- 订单完成结算
- 陪玩提现冻结、审核、打款确认
- 投诉退款真实处理
- Prisma migration 文件
- 自动化测试
- 前端真实 API 对接

## 3. 目录结构

```text
apps/
  customer-web/       客户端 Next.js，入口 /customer 规划，当前为静态页面
  companion-web/      陪玩端 Next.js，入口 /companion 规划，当前为静态页面
  admin-web/          管理后台 Next.js，入口 /admin 规划，当前为静态页面
  api-server/         NestJS API 服务
  discord-bot/        Discord.js Bot，支持按钮接单回写
  kook-adapter/       KOOK 适配层，封装发送通知、私信、语音房、角色同步

packages/
  database/           Prisma schema
  shared/             共享枚举/类型占位
  auth/               密码工具占位
  ui/                 Tailwind 主题和 UI className 常量
  config/             环境配置占位

docs/
  PROJECT_PLAN.md
  DATABASE_SCHEMA.md
  API_SPEC.md
  ORDER_FLOW.md
  WALLET_FLOW.md
  BOT_FLOW.md
  TEST_CHECKLIST.md
  TEST_REPORT.md
  MULTI_AGENT_WORKFLOW.md
  UI_*.md

agent_pipeline/
  agents.json         多 Agent 分工定义
  run_agents.py       审核脚本骨架
```

## 4. 数据模型闭环

核心 Prisma 文件：

```text
packages/database/prisma/schema.prisma
```

关键模型：

- `User`
  - 统一账户表
  - 角色：`CUSTOMER`、`COMPANION`、`ADMIN`、`SUPER_ADMIN`
  - 禁止拆成多个账户系统
- `CompanionProfile`
  - 陪玩资料
  - 状态：`PENDING_REVIEW`、`LISTED`、`UNLISTED`、`BANNED`
- `Wallet`
  - 用户余额：`availableBalance`、`frozenBalance`
  - 陪玩收益：`availableIncome`、`pendingIncome`
- `WalletTransaction`
  - 所有资金流水统一记录
- `RechargeRequest`
  - 人工充值申请
- `WithdrawalRequest`
  - 陪玩提现申请
- `Order`
  - 订单主表
  - 支持指定陪玩和平台人工匹配：`DIRECT_COMPANION`、`PLATFORM_MATCH`
  - 支持试音标记：`voiceTrialRequested`
- `OrderStatusLog`
  - 所有订单状态变化日志
- `AdminLog`
  - 所有管理员操作日志
- `UserExternalAccount`
  - 陪玩平台账号绑定
  - 系统用户绑定 Discord/KOOK 用户 ID
- `BotEvent`
  - Discord/KOOK 通知、失败、接单事件回写

## 5. 目标业务闭环

完整闭环应为：

```text
管理员创建陪玩
↓
客户注册
↓
客户提交充值申请
↓
管理员审核充值
↓
客户余额增加并写 wallet_transactions
↓
客户下单
↓
后端校验余额并扣款/冻结
↓
订单进入 PAID
↓
管理员派单
↓
订单变 ASSIGNED
↓
Discord + KOOK 同步通知
↓
陪玩在 Discord/KOOK 点击接单
↓
后端校验平台账号绑定
↓
事务防重复接单
↓
订单变 ACCEPTED
↓
订单开始 IN_PROGRESS
↓
订单完成 COMPLETED
↓
平台抽成
↓
陪玩收益增加
↓
陪玩申请提现
↓
管理员审核提现
↓
人工打款
↓
后台确认完成并写 wallet_transactions
```

当前代码只部分实现了：

```text
管理员派单
↓
订单 PAID -> ASSIGNED
↓
Discord + KOOK 通知
↓
陪玩点击接单
↓
订单 ASSIGNED -> ACCEPTED
↓
写订单日志和 BotEvent
```

## 6. 订单派单与接单代码路径

### 6.1 管理员派单

入口：

```text
apps/api-server/src/modules/admin/admin.controller.ts
PATCH /api/admin/orders/:id/assign
```

调用：

```text
apps/api-server/src/modules/orders/orders.service.ts
OrdersService.assignOrder()
```

当前逻辑：

1. 开启 Prisma transaction。
2. 查询订单。
3. 只允许 `PAID` 状态派单。
4. 查询陪玩用户，要求：
   - `role = COMPANION`
   - `status = ACTIVE`
5. 使用 `updateMany` 条件更新：
   - `id = orderId`
   - `status = PAID`
6. 更新成功才变为：
   - `status = ASSIGNED`
   - `companionId = companionId`
   - `assignedById = assignedById`
7. 写入 `order_status_logs`。
8. 如果有管理员 ID，写入 `admin_logs`。
9. 事务提交后调用 Bot 通知。

设计意图：

- `updateMany` + 状态条件用于防止并发重复派单。
- Bot 通知放在事务后，避免外部平台失败导致数据库事务回滚。

需要 Claude 重点审核：

- 管理员身份/RBAC 当前未实现。
- 没有校验陪玩资料是否 `LISTED`。
- 没有处理平台匹配订单 `PLATFORM_MATCH` 的自动候选逻辑。
- Bot 通知失败只记录失败，不会阻止派单；是否符合运营预期需要确认。

### 6.2 Discord 接单

Bot 文件：

```text
apps/discord-bot/src/index.ts
```

流程：

1. Discord Bot 监听按钮交互。
2. 按钮 ID 格式：

```text
order.accept.{orderId}
```

3. Bot 调用 API：

```text
POST /api/discord/orders/accept
Header: x-bot-token: BOT_INTERNAL_TOKEN
```

API 入口：

```text
apps/api-server/src/modules/discord/discord-webhook.controller.ts
```

鉴权：

```text
apps/api-server/src/modules/bot/bot-internal.guard.ts
```

后端处理：

```text
OrdersService.acceptOrderFromPlatform(BotPlatform.DISCORD, ...)
```

### 6.3 KOOK 接单

KOOK 公共 Webhook：

```text
apps/api-server/src/modules/kook/kook-webhook.controller.ts
POST /api/kook/webhook
```

KOOK 内部回写入口：

```text
POST /api/kook/orders/accept
Header: x-bot-token: BOT_INTERNAL_TOKEN
```

KOOK Adapter：

```text
apps/kook-adapter/src/index.ts
```

设计意图：

- API Server 负责接收 KOOK Webhook。
- `kook-adapter` 保留为平台适配层，负责发送消息、私信、创建语音房、同步角色。

需要 Claude 重点审核：

- KOOK Webhook 的 payload 解析是否符合 KOOK 实际回调格式。
- KOOK `verify_token` 校验是否足够。
- KOOK `compress=0` 等配置是否已在部署文档中明确。
- `kook-adapter` 当前是适配层，不是完整独立 Bot 服务。

## 7. 接单事务防重逻辑

核心方法：

```text
apps/api-server/src/modules/orders/orders.service.ts
OrdersService.acceptOrderFromPlatform()
```

当前逻辑：

1. 根据 `platform + externalUserId` 查询 `UserExternalAccount`。
2. 校验绑定用户必须是：
   - `role = COMPANION`
   - `status = ACTIVE`
3. 查询订单。
4. 只允许 `ASSIGNED` 状态接单。
5. 如果订单已经指定 `companionId`，则只能该陪玩接。
6. 使用 `updateMany` 条件更新：

```text
id = orderId
status = ASSIGNED
companionId = 当前陪玩 OR companionId = null
```

7. 成功后更新：

```text
status = ACCEPTED
acceptedAt = now()
companionId = 当前陪玩
```

8. 写入 `order_status_logs`。
9. 写入 `bot_events`。

设计意图：

- 防止 Discord 和 KOOK 同时点击导致重复接单。
- 防止未绑定平台账号的用户接单。
- 防止一个陪玩接另一个陪玩的指定订单。

需要 Claude 重点审核：

- Prisma transaction 隔离级别是否足够。
- `updateMany` 条件是否覆盖所有并发场景。
- 平台匹配订单是否应该在 `ASSIGNED` 且 `companionId = null` 下允许抢单。
- 接单成功后是否需要通知管理员、客户、另一个平台。

## 8. Bot 通知逻辑

核心文件：

```text
apps/api-server/src/modules/bot/bot-notification.service.ts
```

当前逻辑：

1. 查询订单信息。
2. 构造通知 payload。
3. 同时发送：
   - Discord
   - KOOK
4. 使用 `Promise.allSettled`，避免单个平台失败影响另一个平台。
5. 成功或失败都写 `bot_events`。

需要 Claude 重点审核的明显问题：

- 文件里出现中文编码乱码，例如 Discord/KOOK 通知文案不可读。
- KOOK 卡片内容疑似字符串插值错误，例如出现 `{payload.orderNo}` 字面量而不是 `${payload.orderNo}`。
- Discord Bot 回复文案也有乱码。
- 当前只实现订单派单通知，充值、提现、投诉、管理员提醒还没有完整实现。
- 没有重试队列或补偿任务。

## 9. 钱包与资金闭环

目标表：

```text
Wallet
WalletTransaction
RechargeRequest
WithdrawalRequest
```

目标原则：

- 客户充值审核通过：增加 `availableBalance`，写 `wallet_transactions`。
- 客户下单：后端计算金额，扣减或冻结客户余额，写流水。
- 订单完成：计算平台抽成和陪玩收益，增加陪玩 `pendingIncome` 或 `availableIncome`。
- 陪玩提现申请：冻结收益。
- 管理员确认打款：扣减冻结收益，写提现完成流水。
- 拒绝提现：释放冻结收益。

当前代码状态：

- 数据表已设计。
- `apps/api-server/src/modules/wallet` 仍是骨架。
- `AdminController.reviewRecharge()` 和 `reviewWithdrawal()` 目前只返回占位说明，没有真实资金事务。

需要 Claude 重点审核：

- 钱包闭环目前未跑通，是上线阻塞项。
- 必须补齐防负余额、防重复审核、防重复结算。
- 所有金额字段必须避免前端传入最终金额作为可信值。

## 10. 前端三端状态

### Customer Portal

目录：

```text
apps/customer-web
```

已有页面：

- 首页
- 陪玩列表
- 陪玩详情
- 下单页
- 充值页

当前特点：

- 展示语音偏好、试音、陪玩卡片。
- 下单支持指定陪玩和平台人工匹配的 UI 表达。
- 目前是静态数据，没有真实 API 调用。

### Companion Portal

目录：

```text
apps/companion-web
```

已有页面：

- 登录页
- 工作台
- 可接订单
- 我的订单
- 收益明细
- 提现申请
- 我的资料

当前状态：

- 静态页面。
- 没有登录态、接单 API、提现 API 对接。

### Admin Portal

目录：

```text
apps/admin-web
```

已有页面：

- 登录页
- 数据看板
- 用户管理
- 陪玩管理
- 添加陪玩
- 订单管理
- 派单页面
- 充值审核
- 提现审核
- 投诉处理
- 财务流水
- 操作日志

当前状态：

- 静态页面。
- 派单、审核、日志展示未接真实 API。

## 11. 多 Agent 分工

配置文件：

```text
agent_pipeline/agents.json
docs/MULTI_AGENT_WORKFLOW.md
```

当前是“多 Agent 分工规范 + 审核脚本骨架”，不是多个真实模型并发自动开发。

已定义 Agent：

- Project Manager Agent
- Database Agent
- Customer Agent
- Companion Agent
- Admin Agent
- Order Agent
- Wallet Agent
- Discord Agent
- KOOK Agent
- UI/UX Design Agent
- DevOps Agent
- QA Agent

建议 Claude 按这些 Agent 视角分别审核，最后汇总阻塞项。

## 12. 部署框架

核心文件：

```text
docker-compose.yml
infra/nginx/nginx.conf
infra/nginx/nginx.ssl.conf.template
scripts/server-bootstrap.sh
scripts/deploy.sh
scripts/enable-https.sh
scripts/backup-postgres.sh
```

包含服务：

- PostgreSQL
- API Server
- Customer Web
- Companion Web
- Admin Web
- Discord Bot
- KOOK Bot/Adapter
- Nginx
- Certbot

需要 Claude 重点审核：

- Dockerfile 是否能在干净环境构建。
- pnpm workspace 依赖是否完整。
- Next.js 多端端口和 Nginx 路由是否匹配。
- `.env.production.example` 是否覆盖所有必需变量。
- 数据库 migration、seed、初始化管理员脚本是否可执行。

## 13. 当前已知高优先级风险

P0，上线阻塞：

- JWT 登录/RBAC 未完成。
- 钱包充值、下单扣款、订单结算、提现资金事务未完成。
- 前端没有真实 API 对接。
- Prisma migration 未生成。
- 自动化测试未跑通。
- 本地环境缺少 Node/pnpm/docker，当前没有完成真实 build/test 验证。

P1，高风险：

- Bot 通知文案编码乱码。
- KOOK 通知字符串插值疑似错误。
- 管理员接口大部分仍是占位返回。
- 充值、提现、投诉、管理员提醒 Bot 通知未完整实现。
- 没有失败通知重试机制。
- 没有完整审计日志覆盖所有管理员操作。

P2，需要改进：

- UI 是静态原型，缺少表单校验和错误状态。
- KOOK 语音房创建只在 adapter 保留方法，业务流程未串起来。
- 订单 `IN_PROGRESS`、`COMPLETED`、`REFUND_REQUESTED`、`REFUNDED`、`DISPUTED` 等状态流转未实现。
- 多 Agent 当前是流程定义，不是真实自动编排执行。

## 14. 建议 Claude 审核任务

请 Claude 优先回答：

1. 当前代码能否跑通最小商业闭环？如果不能，缺哪些 P0？
2. `OrdersService.assignOrder()` 的事务与并发防重是否正确？
3. `OrdersService.acceptOrderFromPlatform()` 是否能防止 Discord/KOOK 重复接单？
4. `UserExternalAccount` 的账号绑定设计是否足够支持 Discord/KOOK 双平台运营？
5. Bot 通知失败写入 `bot_events` 的方式是否合理？
6. 当前 Prisma schema 是否能支撑充值、订单、结算、提现、投诉闭环？
7. 钱包系统应该如何补齐事务，避免负余额、重复审核、重复结算？
8. Docker Compose 与 Nginx 是否能支撑第一阶段部署？
9. 前端三端页面是否覆盖运营需要，哪些页面必须先接 API？
10. 哪些问题必须在继续开发新功能前修复？

## 15. 可直接粘贴给 Claude 的提示词

```text
你是高级代码审核 Agent。请审核这个 DFC 电竞陪玩平台 Monorepo。

审核目标：
1. 判断最小商业闭环是否能真实跑通。
2. 找出 P0/P1/P2 问题。
3. 重点审查订单、钱包、Bot 双平台、权限、安全、事务、防重复接单。
4. 不要建议开发 APP、小程序、多游戏、自动支付、自动提现。
5. 不要泛泛而谈，必须引用具体文件路径和代码逻辑。

重点文件：
- packages/database/prisma/schema.prisma
- apps/api-server/src/modules/orders/orders.service.ts
- apps/api-server/src/modules/bot/bot-notification.service.ts
- apps/api-server/src/modules/bot/bot-internal.guard.ts
- apps/api-server/src/modules/admin/admin.controller.ts
- apps/api-server/src/modules/discord/discord-webhook.controller.ts
- apps/api-server/src/modules/kook/kook-webhook.controller.ts
- apps/discord-bot/src/index.ts
- apps/kook-adapter/src/index.ts
- docker-compose.yml
- agent_pipeline/agents.json
- docs/CLAUDE_REVIEW_BRIEF.md

请按以下格式输出：
1. 总体结论：是否可上线，是否跑通闭环。
2. P0 阻塞问题。
3. P1 高风险问题。
4. P2 改进建议。
5. 订单派单/接单事务审查。
6. 钱包资金闭环审查。
7. Discord/KOOK 双平台审查。
8. 安全与权限审查。
9. 部署与测试审查。
10. 下一步最小修复计划。
```

