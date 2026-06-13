# May猫饼电竞 / DFC 平台 Claude 审查包

日期：2026-06-13  
目标：请 Claude 按“真实可运营的陪玩平台”标准审查当前代码架构、业务闭环、资金安全、Bot/AI、权限和部署风险。

> 审查时请不要只看演示效果。重点看：真实用户、真实余额、真实订单、真实提现、KOOK/Discord 消息重复、管理员权限、生产迁移和异常回滚。

## 0. 给 Claude 的审查指令

请按以下优先级审查：

1. 先找 P0/P1 风险：资金、余额、订单结算、提现、权限绕过、Bot 重复处理、生产迁移不一致。
2. 再判断最小商业闭环是否能真实跑通。
3. 再审查 KOOK/Discord、AI 客服、多游戏、移动端后台和部署稳定性。
4. 不要优先建议 APP、小程序、自动支付、自动提现。
5. 每个问题请给出：严重级别、文件路径、问题原因、最小修复建议、验证方法。

建议输出格式：

```text
总体结论：
P0 阻塞：
P1 高风险：
P2 改进：
资金闭环审查：
Bot/AI 审查：
权限/RBAC 审查：
部署/迁移审查：
建议下一步：
```

## 1. 项目定位

品牌：

- May猫饼电竞
- Maycat Club

项目原始定位：

- 电竞陪玩平台
- KOOK / Discord 社群俱乐部
- 管理后台
- 订单系统
- 钱包系统
- 人工充值审核
- 人工提现审核
- Bot 通知与人工派单
- AI 客服辅助

当前经营策略：

- 国内市场以 KOOK、微信客服、人工充值为主。
- 海外/加拿大市场预留 Discord。
- 当前仍以 H5 网站为主，没有正式 APP。
- 陪玩不能自助注册，需要联系客服考核后由管理员开通。

## 2. 生产部署现状

生产域名：

```text
https://maycatplay.com
```

入口：

```text
/customer
/companion
/admin
/api
```

部署环境：

- 腾讯云轻量服务器
- Ubuntu
- Docker Compose
- Nginx
- PostgreSQL
- HTTPS 已启用

常用生产更新命令：

```bash
cd /opt/companion-play-system
sudo git pull origin main
sudo docker compose run --rm api-server pnpm --filter @dfc/database prisma:deploy
sudo docker compose up -d --build api-server customer-web companion-web admin-web nginx
sudo docker compose restart api-server customer-web companion-web admin-web nginx
```

重要生产事件：

- `202606130001_financial_safety_guards` 初次迁移失败。
- 原因：`ai_support_conversations` 已存在重复 KOOK `platformMessageId`，创建唯一索引失败。
- 用户已手动清理重复数据，并执行过 `prisma migrate resolve --applied 202606130001_financial_safety_guards`。

请 Claude 重点确认：

- 生产数据库实际 schema 是否与 Prisma migration 状态一致。
- `_prisma_migrations` 是否存在“标记 applied 但 SQL 没完整执行”的风险。
- 是否需要补一个安全检查脚本，部署前扫描重复 `platformMessageId`。
- 当前更新流程是否仍会短暂 502，是否需要 healthcheck / 蓝绿 / 滚动发布。

## 3. Monorepo 架构

```text
apps/
  customer-web      客户端 Next.js，basePath /customer
  companion-web     陪玩端 Next.js，basePath /companion
  admin-web         管理后台 Next.js，basePath /admin
  api-server        NestJS API
  discord-bot       Discord Bot
  kook-adapter      KOOK Bot / 适配层

packages/
  database          Prisma schema / migrations
  shared            共享类型
  auth              认证工具
  ui                Tailwind 主题
  config            配置包

docs/
  API、数据库、订单、钱包、Bot、部署、UI、Claude 审查文档

scripts/
  init-admin.ts
  update-production.sh
  backup-postgres.sh
  enable-https.sh
  setup-kook-channels.js
  post-kook-welcome.js
```

最近关键提交：

```text
58132ae Fix admin mobile layout navigation
4b7017e Patch financial and AI safety guards
1497697 Add customer settings page and AI settings guidance
e9b7d73 Add Claude review brief for current platform state
7bb3903 Deduplicate KOOK support replies
00f0821 Tighten AI support replies
033d98b Support configurable AI provider endpoint
```

## 4. 前端页面入口

Customer Portal：

```text
/customer/
/customer/home/
/customer/companions/
/customer/companions/[id]/
/customer/order/
/customer/recharge/
/customer/complaints/
/customer/support/
/customer/settings/
/customer/oauth-callback/
```

Companion Portal：

```text
/companion/
/companion/dashboard/
/companion/profile/
/companion/available-orders/
/companion/orders/
/companion/earnings/
/companion/withdrawals/
/companion/oauth-callback/
```

Admin Portal：

```text
/admin/
/admin/dashboard/
/admin/users/
/admin/companions/
/admin/companions/new/
/admin/orders/
/admin/order-drafts/
/admin/dispatch/
/admin/promotions/
/admin/recharges/
/admin/withdrawals/
/admin/complaints/
/admin/finance/
/admin/logs/
```

移动端后台最近修复：

- 文件：`apps/admin-web/app/components.tsx`
- 左侧固定菜单改为 `xl` 以上显示。
- 手机/平板使用顶部横向菜单。
- 修复手机只看到菜单、看不到操作区的问题。

请 Claude 复核：

- 后台表格在手机端是否仍存在按钮看不到、列太宽、横向滚动体验差的问题。
- 后台是否应该提示“建议 PC 管理”，手机只做应急操作。

## 5. 后端 API 模块

控制器：

```text
apps/api-server/src/modules/auth/auth.controller.ts
apps/api-server/src/modules/admin/admin.controller.ts
apps/api-server/src/modules/orders/orders.controller.ts
apps/api-server/src/modules/wallet/wallet.controller.ts
apps/api-server/src/modules/complaints/complaints.controller.ts
apps/api-server/src/modules/support/support.controller.ts
apps/api-server/src/modules/kook/kook-webhook.controller.ts
apps/api-server/src/modules/discord/discord-webhook.controller.ts
```

关键服务：

```text
apps/api-server/src/modules/auth/auth.service.ts
apps/api-server/src/modules/orders/orders.service.ts
apps/api-server/src/modules/orders/order-drafts.service.ts
apps/api-server/src/modules/wallet/wallet.service.ts
apps/api-server/src/modules/support/platform-support.service.ts
apps/api-server/src/modules/bot/bot-notification.service.ts
```

请 Claude 重点审查：

- Controller 是否过胖，业务逻辑是否有漏到 controller。
- 写操作是否都通过事务处理。
- 金额是否全部后端计算。
- 管理员操作是否完整写入 `admin_logs`。

## 6. 用户、认证与权限

统一 `users` 表角色：

```text
CUSTOMER
COMPANION
ADMIN
SUPER_ADMIN
```

入口权限：

- customer portal 只允许 CUSTOMER。
- companion portal 只允许 COMPANION。
- admin portal 只允许 ADMIN / SUPER_ADMIN。

邮箱注册：

- 客户邮箱注册需要验证码。
- 同邮箱重复注册已拦截。
- 用户名按角色维度唯一。
- 忘记密码/重置密码已有后端能力，但需要继续确认前端入口是否完整。

第三方登录：

- Discord OAuth 代码存在。
- KOOK OAuth 代码存在，但 KOOK OAuth 权限仍在申请/审核中。
- KOOK Bot Token 已能发消息，不等于 KOOK OAuth 登录已开通。

KOOK OAuth 需要配置：

```env
KOOK_CLIENT_ID=
KOOK_CLIENT_SECRET=
KOOK_REDIRECT_URI=https://maycatplay.com/api/auth/oauth/kook/callback
KOOK_OAUTH_SCOPE=user
```

陪玩注册规则：

- 陪玩不能自助注册。
- 陪玩需要联系客服考核。
- 管理员创建陪玩账号并绑定 KOOK/Discord 后，陪玩才可登录。

请 Claude 重点审查：

- KOOK 登录是否可能创建第二个客户账号，而不是绑定到已登录邮箱账号。
- `UserExternalAccount` 绑定是否能防止同一 KOOK/Discord ID 绑定多个账号。
- 已注册普通用户升级为管理员是否只允许 SUPER_ADMIN。
- 管理员重置密码功能是否应保留在后台，同时客户侧提供“忘记密码”。

## 7. 数据库模型与迁移

核心模型：

```text
User
EmailVerificationCode
UserExternalAccount
CompanionProfile
Wallet
Order
UserReferral
OrderDraft
OrderDraftCandidate
OrderDraftEvent
OrderStatusLog
WalletTransaction
RechargeRequest
PromotionCode
WithdrawalRequest
Complaint
AdminLog
PlatformSetting
AiSupportConversation
BotEvent
```

迁移列表：

```text
202606110001_initial
202606110002_expand_game_codes
202606110003_email_verification_codes
202606120001_unique_display_name_per_role
202606120002_order_drafts
202606120003_promotion_settings
202606120004_referrals_payout_support
202606120005_ai_dispatch_assistant
202606120006_platform_ai_support
202606120007_promotion_codes
202606120008_promotion_code_once_per_customer
202606130001_financial_safety_guards
```

最新安全迁移：

```sql
ALTER TABLE "orders"
  ADD COLUMN "commissionRateSnapshot" DECIMAL(5,4) NOT NULL DEFAULT 0.2;

CREATE UNIQUE INDEX "ai_support_conversations_platform_message_unique"
  ON "ai_support_conversations"("platform", "platformMessageId");
```

请 Claude 重点审查：

- 唯一索引中 `platformMessageId` 可为空，PostgreSQL 对多个 null 不视为重复，这是否符合预期。
- 历史重复数据清理是否应写成正式 migration 前置脚本。
- 是否需要数据库层面约束钱包余额非负。
- 是否需要禁止删除 `wallet_transactions` 的 DB trigger 或权限策略。

## 8. 最小商业闭环

目标闭环：

```text
管理员创建陪玩
客户注册
客户提交充值申请
管理员审核充值或人工加余额
客户余额增加并写钱包流水
客户下单
订单进入待派单或指定陪玩
KOOK/Discord 通知
陪玩报名或接单
订单开始
订单完成
平台抽成
陪玩收益增加
陪玩申请提现
管理员审核提现
人工打款
后台确认提现完成
```

当前已实现能力：

- 客户邮箱验证码注册/登录。
- 客户 KOOK/Discord 登录入口预留，KOOK OAuth 等官方审核。
- 管理员创建陪玩、上下架、设置抽成。
- 客户提交人工充值申请。
- 管理员审核充值。
- 管理员人工加/扣余额。
- 钱包流水记录。
- 客户下单，指定陪玩或平台匹配。
- 管理端试音派单草稿。
- KOOK/Discord 通知、报名、接单事件回写。
- 陪玩提现资料和提现申请。
- 管理员审核/确认提现。

请 Claude 重点审查：

- 是否有完整 E2E 测试覆盖上述闭环。
- 退款、取消、投诉后的钱包回滚是否完整。
- 管理员人工加余额是否可能绕过流水或日志。
- 订单完成是否能重复结算。
- 陪玩收益是否能重复入账。

## 9. 钱包、充值、提现、优惠码

关键文件：

```text
apps/api-server/src/modules/wallet/wallet.service.ts
apps/api-server/src/modules/orders/orders.service.ts
packages/database/prisma/schema.prisma
```

已实现防护：

- 人工加/扣余额写 `wallet_transactions`。
- 人工加/扣余额写 `admin_logs`。
- 充值审核使用 `updateMany` 并检查 `count !== 1`。
- 提现审核使用状态流转和 `updateMany`。
- 下单冻结余额时检查可用余额。
- 完成订单时检查订单状态和冻结余额。
- 提现冻结、拒绝释放、确认打款均有流水。

优惠码现状：

- `promotion_codes.code` 唯一。
- `recharge_requests` 有部分唯一索引，限制同一客户同一优惠码非 REJECTED 状态只能使用一次。
- 提交充值申请时预占 `usedCount`。
- 充值申请被 REJECTED 时释放 `usedCount`。
- 审核 APPROVED 时不重复增加 `usedCount`。

请 Claude 重点审查：

- `usedCount` 预占与释放是否在并发审核下仍安全。
- `usageLimit === null` 无上限使用是否符合业务。
- 是否应该新增 `PromotionCodeRedemption` 表，避免把“使用记录”绑定在充值申请上。
- 是否需要充值码和优惠码分开建模。
- 是否需要单独审计“扣余额”权限，避免误操作或恶意操作。

## 10. 订单与抽成

关键文件：

```text
apps/api-server/src/modules/orders/orders.service.ts
packages/database/prisma/schema.prisma
```

最近修复：

- `Order` 增加 `commissionRateSnapshot`。
- 创建订单时写入抽成快照。
- 管理员派单时写入陪玩当前抽成快照。
- KOOK/Discord 平台接单时写入陪玩当前抽成快照。
- 完成订单时优先读取 `order.commissionRateSnapshot` 结算。

请 Claude 重点审查：

- 平台匹配订单在未指定陪玩时先用默认抽成，后续派单是否正确覆盖。
- 指定陪玩下单时是否读取该陪玩抽成。
- 订单取消、退款、争议处理是否完整。
- 平台抽成和陪玩收益是否需要四舍五入规则。
- 订单状态日志是否覆盖每个状态转换。

## 11. 多游戏现状

当前 `GameCode` 已扩展：

```text
DELTA_FORCE
LEAGUE_OF_LEGENDS
VALORANT
COUNTER_STRIKE_2
PUBG
PUBG_MOBILE
NARAKA
APEX_LEGENDS
OVERWATCH_2
HONOR_OF_KINGS
```

当前限制：

- `Order` 有 `game` 字段。
- `CompanionProfile` 仍是单 `game` 字段。
- 陪玩价格 `pricePerHour` 仍是单价格。
- 还没有“陪玩支持多个游戏，每个游戏独立价格/段位/模式”的关系表。

请 Claude 判断：

- 当前多游戏是否只是可运行的简化版本，不是完整多游戏系统。
- 是否应该新增 `CompanionGameProfile`。
- 下单、派单、候选推荐是否都按游戏过滤。

## 12. KOOK / Discord / AI 客服

关键文件：

```text
apps/api-server/src/modules/kook/kook-webhook.controller.ts
apps/api-server/src/modules/discord/discord-webhook.controller.ts
apps/api-server/src/modules/support/platform-support.service.ts
apps/api-server/src/modules/bot/bot-notification.service.ts
apps/kook-adapter/src/main.ts
apps/discord-bot/src/index.ts
```

KOOK 现状：

- KOOK webhook challenge 已测试成功。
- KOOK Bot 可以通过 API 发消息。
- KOOK 频道已创建：客服接待、人工派单、充值审核、提现审核、投诉处理、管理提醒、试音等候室。
- KOOK OAuth 登录仍需要官方权限审核。

AI 客服现状：

- 支持 OpenAI / DeepSeek 风格的 Chat Completions。
- 中国服务器调用 OpenAI 可能出现 `unsupported_country_region_territory`。
- DeepSeek 可用但需要充值。
- AI 支持配置：

```env
AI_SUPPORT_ENABLED=true
AI_SUPPORT_API_KEY=
AI_SUPPORT_BASE_URL=
AI_SUPPORT_API_STYLE=chat_completions
AI_SUPPORT_MODEL=
```

AI 安全修复：

- 禁止声称已完成退款、加余额、提现、转账、到账。
- 禁止承诺具体到账时间/金额。
- 禁止泄露 token、验证码、管理员联系方式。
- 禁止对投诉做处理决定。
- 回复前过滤危险短语：
  - 已退款
  - 已加余额
  - 已到账
  - 已处理
  - 已转账
  - 已提现
  - 退款成功
  - 余额已增加
  - 提现完成
  - 投诉成立
- 移除 DeepSeek 不兼容的 `thinking: { type: "disabled" }`。

重复回复防护：

- 应用层检查重复消息。
- 数据库唯一索引：`ai_support_conversations(platform, platformMessageId)`。

请 Claude 重点审查：

- AI 回复是否仍可能编造网站功能，例如错误描述“APP 首页”。
- 危险短语过滤是否过窄。
- AI 失败时是否有足够降级回复和管理员提醒。
- KOOK 加密/压缩 payload 处理是否完全符合官方文档。
- Bot 离线但 API 可发消息时，是否影响事件触发方式。
- 同一消息是否仍可能被 KOOK webhook 与 bot gateway 双路重复处理。

## 13. 管理后台

关键文件：

```text
apps/admin-web/app/components.tsx
apps/admin-web/app/users/page.tsx
apps/admin-web/app/recharges/page.tsx
apps/admin-web/app/withdrawals/page.tsx
apps/admin-web/app/order-drafts/page.tsx
apps/admin-web/app/promotions/page.tsx
```

已有能力：

- 用户管理。
- 封禁/激活。
- 重置用户密码。
- 创建管理员。
- 升级已有用户为管理员。
- 人工加/扣客户余额。
- 创建陪玩。
- 上下架陪玩。
- 设置陪玩抽成。
- 充值审核。
- 提现审核。
- 投诉处理。
- 财务流水。
- 操作日志。
- 试音派单草稿。
- 优惠配置和优惠码管理。

权限边界：

- `AdminController` 全局要求 ADMIN / SUPER_ADMIN。
- 创建管理员要求 SUPER_ADMIN。
- 修改用户角色要求 SUPER_ADMIN。
- 普通 ADMIN 不能重置 ADMIN / SUPER_ADMIN 密码。

请 Claude 重点审查：

- 所有管理端写操作是否都有 `admin_logs`。
- 人工加余额是否可能被 CSRF 或 token 泄露利用。
- 创建管理员/升级管理员是否有边界漏洞。
- 手机端后台是否还能实际完成关键操作。

## 14. 客户端

关键文件：

```text
apps/customer-web/app/auth-form.tsx
apps/customer-web/app/home/page.tsx
apps/customer-web/app/recharge/page.tsx
apps/customer-web/app/order/page.tsx
apps/customer-web/app/support/page.tsx
apps/customer-web/app/settings/page.tsx
```

最近新增：

- `/customer/settings/` 个人设置页。
- 显示当前账号、邀请码、钱包状态、KOOK/Discord 绑定状态、客服入口。
- 手机底部导航新增“设置”。
- AI 客服回答个人设置时不再编造 APP 入口。

请 Claude 重点审查：

- OAuth 登录后写 localStorage 的安全性。
- 客户侧是否只显示当前用户自己的数据。
- 充值页是否清楚说明人工充值流程。
- 是否存在前端伪造金额后端未校验风险。
- 客户点击品牌/注册登录入口是否会误退出登录。

## 15. 陪玩端

关键文件：

```text
apps/companion-web/app/login-form.tsx
apps/companion-web/app/dashboard/page.tsx
apps/companion-web/app/profile/page.tsx
apps/companion-web/app/available-orders/page.tsx
apps/companion-web/app/withdrawals/page.tsx
```

规则：

- 陪玩不能自助注册。
- 陪玩需要先联系客服考核。
- 管理员创建陪玩账号并上架。
- KOOK/Discord 登录需要先绑定到陪玩账号。
- 陪玩可设置支付宝等提现资料，供后台人工打款。

请 Claude 重点审查：

- 是否仍存在绕过路径可创建 COMPANION。
- 陪玩收款信息是否只暴露给本人和管理员。
- 客户端是否可能看到陪玩收款账号。
- 陪玩接单是否防重复接单。

## 16. UI / 品牌 / 体验

当前设计方向：

- May猫饼电竞。
- 暗黑电竞风。
- 霓虹蓝紫点缀。
- 少量金色用于推荐/VIP。
- 客户端优先手机 H5。
- 管理后台优先 PC，手机做应急管理。

用户提供的新视觉参考：

- 赛博霓虹街区背景。
- Maycat Club 猫形象。
- 蓝紫粉霓虹。

请 Claude 重点审查：

- 网站是否已经形成统一品牌识别。
- Logo/favicon 是否完整。
- 客户端充值/下单/客服流程是否足够清楚。
- 陪玩卡片是否需要真实照片、语音偏好、试音状态。
- 后台是否为了“好看”牺牲了效率。

## 17. 部署与运维

关键文件：

```text
docker-compose.yml
infra/nginx/nginx.conf
infra/nginx/nginx.ssl.conf.template
scripts/update-production.sh
scripts/backup-postgres.sh
scripts/enable-https.sh
scripts/deploy.sh
```

已遇到的问题：

- HTTPS 443 未映射。
- Nginx 循环跳转。
- `infra/nginx/nginx.conf` 本地修改阻止 `git pull`。
- 重建容器时短暂 502。
- Prisma migration 因重复数据失败。

请 Claude 重点审查：

- `update-production.sh` 是否足够稳定。
- Nginx 生产配置是否应该从 template 生成，避免 git pull 冲突。
- 是否需要健康检查和零停机策略。
- 数据库备份是否可恢复。
- 是否需要部署前自动检查 migrations drift。

## 18. 当前已知风险清单

P0 / 需要优先复核：

1. `202606130001_financial_safety_guards` 曾失败并手动 resolve，需要确认生产 schema 与迁移状态一致。
2. AI 客服虽有危险短语过滤，但仍可能用其他表达做资金承诺。
3. 优惠码 `usedCount` 预占/释放逻辑需要并发审查。
4. KOOK OAuth 权限尚未通过，登录入口依赖官方审核结果。

P1 / 高风险：

1. 多游戏模型仍是简化版本，不是完整多游戏陪玩系统。
2. 退款、取消、争议订单闭环需要加强。
3. Bot 历史重复消息清理流程需要文档化和自动化。
4. 管理后台手机端仍需要人工回归测试。
5. 支付宝/提现信息脱敏与权限需要复核。

P2 / 改进：

1. PWA / APP 暂未做。
2. AI 客服多轮上下文质量仍需要继续优化。
3. Postman 集合需要跟最新接口同步。
4. README 仍有“第一阶段只支持三角洲”的旧描述，和当前多游戏方向不完全一致。

## 19. 建议 Claude 重点查看文件

资金与订单：

```text
apps/api-server/src/modules/wallet/wallet.service.ts
apps/api-server/src/modules/orders/orders.service.ts
packages/database/prisma/schema.prisma
packages/database/prisma/migrations/202606130001_financial_safety_guards/migration.sql
```

AI / Bot：

```text
apps/api-server/src/modules/support/platform-support.service.ts
apps/api-server/src/modules/kook/kook-webhook.controller.ts
apps/api-server/src/modules/discord/discord-webhook.controller.ts
apps/api-server/src/modules/bot/bot-notification.service.ts
apps/kook-adapter/src/main.ts
apps/discord-bot/src/index.ts
```

权限：

```text
apps/api-server/src/modules/auth/auth.service.ts
apps/api-server/src/modules/auth/roles.guard.ts
apps/api-server/src/modules/auth/jwt-auth.guard.ts
apps/api-server/src/modules/admin/admin.controller.ts
```

前端入口：

```text
apps/customer-web/app/auth-form.tsx
apps/customer-web/app/settings/page.tsx
apps/admin-web/app/components.tsx
apps/admin-web/app/users/page.tsx
apps/companion-web/app/login-form.tsx
```

部署：

```text
docker-compose.yml
scripts/update-production.sh
infra/nginx/nginx.conf
infra/nginx/nginx.ssl.conf.template
```

## 20. 本地验证命令

```bash
pnpm --filter @dfc/database prisma:generate
pnpm --filter @dfc/api-server build
pnpm --filter @dfc/customer-web build
pnpm --filter @dfc/admin-web build
pnpm --filter @dfc/companion-web build
```

Prisma schema 校验：

```bash
DATABASE_URL=postgresql://dfc:dfc@localhost:5432/dfc pnpm --filter @dfc/database exec prisma validate --schema prisma/schema.prisma
```

生产迁移检查：

```bash
cd /opt/companion-play-system
sudo docker compose run --rm api-server pnpm --filter @dfc/database prisma:deploy
```

生产健康检查：

```bash
curl -Ik https://maycatplay.com/customer/
curl -Ik https://maycatplay.com/admin/
curl -Ik https://maycatplay.com/companion/
curl -i -sS -X POST 'https://maycatplay.com/api/kook/webhook?compress=0' \
  -H 'Content-Type: application/json' \
  --data '{"challenge":"codex-test"}'
```

## 21. Claude 最终需要回答的问题

1. 当前版本是否能真实运营，还是仍有上线阻塞？
2. 是否存在资金可被重复入账、重复提现、重复结算、负余额的路径？
3. AI 客服是否仍可能制造资金承诺或纠纷？
4. KOOK/Discord 是否可能重复处理同一消息？
5. KOOK OAuth 接入前后，是否会造成重复账号或绑定混乱？
6. 管理员权限边界是否足够安全？
7. 陪玩自助注册是否完全禁止？
8. 当前多游戏模型是否可接受，还是必须马上重构？
9. 生产迁移失败后手动 resolve 是否留下风险？
10. 下一轮最小修复清单是什么？

