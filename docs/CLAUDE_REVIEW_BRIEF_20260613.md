# May猫饼电竞 / DFC 陪玩平台 Claude 审核说明

日期：2026-06-13

本文档用于交给 Claude 或其他代码审核 Agent 快速理解当前项目状态。审核目标不是只看代码风格，而是判断系统是否已经接近可运营、哪里还存在业务闭环、资金安全、Bot 接入、部署稳定性和权限安全风险。

## 1. 项目当前定位

项目名称当前对外使用：

- May猫饼电竞
- Maycat Club

项目原始名称：

- Delta Force Club（DFC）电竞陪玩俱乐部

当前业务定位：

- 电竞陪玩平台
- KOOK / Discord 社群客服和派单
- 管理后台
- 人工充值审核
- 人工提现审核
- 订单与钱包系统
- AI 客服辅助接待

重要范围变化：

- 原始需求第一阶段只做《三角洲行动》。
- 后续用户明确要求扩展为市面热门游戏，并加入游戏列表。
- 这意味着 Claude 审核时需要特别检查“单游戏模型”到“多游戏模型”的改造是否完整，避免只在 UI 展示多游戏但后端订单、陪玩、派单仍按单游戏处理。

仍然禁止或暂不做：

- APP
- 小程序
- 自动支付
- 自动提现

当前仍以“人工充值、人工派单、人工提现”为核心闭环。

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

服务器：

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
sudo docker compose build api-server customer-web admin-web companion-web
sudo docker compose up -d api-server customer-web admin-web companion-web kook-bot nginx
sudo docker compose run --rm api-server pnpm --filter @dfc/database prisma:deploy
```

当前已修复过的问题：

- 每次更新后 nginx 配置被 git pull 覆盖导致 502。
- `infra/nginx/nginx.conf` 本地改动阻止 `git pull`。
- HTTPS 443 端口未映射导致无法访问。
- `scripts/update-production.sh` 路径不存在或未拉取到最新代码。
- Prisma deploy 因容器缺少 OpenSSL 检测异常失败，后续通过重新构建修复。

仍需 Claude 重点审核：

- 更新脚本是否足够稳定，是否能避免每次部署短暂 502。
- Nginx 配置是否应拆分为生产模板和本地模板，避免再次被覆盖。
- 数据库备份脚本和 cron 是否完整可恢复。
- 是否有健康检查、回滚方案、日志轮转。

## 3. Monorepo 结构

```text
apps/
  customer-web      客户端 Next.js
  companion-web     陪玩端 Next.js
  admin-web         管理后台 Next.js
  api-server        NestJS API
  discord-bot       Discord Bot
  kook-adapter      KOOK 适配层 / Bot 相关

packages/
  database          Prisma schema / migrations
  shared            共享类型
  auth              认证相关占位
  ui                Tailwind 主题
  config            配置包

docs/
  业务、部署、Bot、UI、Postman、测试文档

scripts/
  初始化管理员、备份、KOOK 频道创建、KOOK 欢迎消息等脚本
```

## 4. 核心业务闭环

目标闭环：

```text
管理员创建陪玩
客户注册
客户提交充值申请
管理员审核充值或人工加余额
客户余额增加并写钱包流水
客户下单
订单进入待派单或指定陪玩
KOOK / Discord 通知
陪玩报名或接单
订单开始
订单完成
平台抽成
陪玩收益增加
陪玩申请提现
管理员审核提现
人工打款
后台确认提现完成
流程结束
```

Claude 审核重点：

- 每一步是否有真实数据库写入。
- 钱包金额是否全部由后端计算。
- 是否存在前端可伪造金额、余额、收益、优惠的风险。
- 充值、人工加余额、优惠码、充值码、推荐奖励是否全部写 `wallet_transactions`。
- 订单状态是否全部写 `order_status_logs`。
- 管理员操作是否全部写 `admin_logs`。
- 订单结算、提现、退款是否使用事务。
- 是否防重复接单、防重复结算、防负余额。

## 5. 账户与权限

统一账户表：

```text
users
```

角色：

```text
CUSTOMER
COMPANION
ADMIN
SUPER_ADMIN
```

已实现方向：

- 客户邮箱验证码注册。
- 客户登录。
- 管理员登录。
- 管理端可创建管理员账号。
- 管理端可将已注册用户升级为管理员。
- 用户邮箱、昵称应禁止重复。
- 注册生成邀请码。
- 用户有独立客户中心和钱包数据。

Claude 重点审核：

- RBAC 是否覆盖所有后台接口。
- `ADMIN` 与 `SUPER_ADMIN` 权限边界是否清晰。
- 创建管理员、升级管理员是否仅允许 `SUPER_ADMIN`。
- 客户、陪玩、管理员是否可能跨入口登录。
- 密码重置是否应在登录页而不是管理端重置。
- 是否存在任意用户通过 API 改角色、改余额、改状态的风险。

## 6. 客户端 UI 与品牌

最近更新：

- 客户端已根据 Maycat Club 霓虹猫图改版。
- 新增品牌图：

```text
apps/customer-web/public/brand/maycat-club-neon.jpg
```

主要文件：

```text
apps/customer-web/styles.css
apps/customer-web/app/brand.tsx
apps/customer-web/app/components.tsx
apps/customer-web/app/auth-form.tsx
```

风格：

- 暗黑电竞
- 蓝粉霓虹
- 少量金色
- 玻璃卡片
- 移动端优先客户入口

Claude 重点审核：

- UI 是否影响业务逻辑。
- 移动端是否可用。
- 注册页是否仍可能被浏览器自动填错邮箱密码。
- 登录后点击 Logo 或“注册/登录”是否会误退出。
- 客户中心、充值、陪玩列表、客服页是否全部使用真实用户数据。

## 7. KOOK 接入现状

已完成：

- KOOK Bot 已加入服务器。
- KOOK webhook challenge 已通过。
- KOOK Bot 可发送频道消息。
- 已创建核心运营频道：

```text
客服接待
人工派单
充值审核
提现审核
投诉处理
管理提醒
试音等候室
```

相关脚本：

```text
scripts/setup-kook-channels.js
scripts/post-kook-welcome.js
```

已配置过的 KOOK 环境变量包括：

```env
KOOK_TOKEN=
KOOK_VERIFY_TOKEN=
KOOK_ENCRYPT_KEY=
KOOK_GUILD_ID=
KOOK_SUPPORT_CHANNEL_ID=
KOOK_DISPATCH_CHANNEL_ID=
KOOK_RECHARGE_CHANNEL_ID=
KOOK_WITHDRAWAL_CHANNEL_ID=
KOOK_COMPLAINT_CHANNEL_ID=
KOOK_ADMIN_CHANNEL_ID=
KOOK_VOICE_CATEGORY_ID=
KOOK_CUSTOMER_ROLE_ID=
KOOK_COMPANION_ROLE_ID=
KOOK_ADMIN_ROLE_ID=
KOOK_SUPER_ADMIN_ROLE_ID=
```

注意：

- 不要把真实 Token 写入文档。
- 当前 KOOK Bot 在 HTTP POST callback 模式下显示离线属于正常现象，只要能收 webhook 和发消息即可。

已修复：

- KOOK Bot 频道 ID / Guild ID 混淆。
- Bot 未入服务器或权限不足导致创建频道失败。
- KOOK webhook 通过 nginx 时 502。
- KOOK AI 客服重复回复同样内容，已加应用层去重。

Claude 重点审核：

- KOOK webhook 是否正确校验 `verify_token`。
- 加密 webhook 是否完整支持。
- KOOK `messageId` 去重是否足够可靠。
- 是否存在两个入口同时回复同一消息：HTTP webhook 与独立 kook-bot 进程。
- KOOK 客服频道是否只在指定频道回复，避免所有频道刷屏。
- KOOK 私聊回复是否可能泄露敏感数据。

## 8. Discord 接入现状

已规划并有骨架：

- Discord Bot 通知。
- Discord 按钮接单。
- Discord 客服消息入口。
- Discord 外部账号绑定。

Claude 重点审核：

- Discord 是否已真实配置 Token、Guild、频道 ID。
- Discord Bot 是否开启 Message Content Intent。
- Discord 与 KOOK 是否共用相同订单派单逻辑。
- Discord 与 KOOK 同时接单时事务防重是否可靠。

## 9. AI 客服现状

最初目标：

- KOOK / Discord 频道内 AI 客服处理大部分常见问题。
- 客户私聊 Bot 或在客服频道发需求。
- AI 能收集游戏、模式、时长、预算、试音偏好。
- 复杂问题转人工。
- 未来支持 AI 生成派单草稿，陪玩报名后给客户选择。

当前实现：

核心文件：

```text
apps/api-server/src/modules/support/platform-support.service.ts
apps/api-server/src/modules/kook/kook-webhook.controller.ts
apps/api-server/src/modules/discord/discord-webhook.controller.ts
```

已支持：

- Web 客服自动回复。
- KOOK 客服频道自动回复。
- KOOK 私聊自动回复。
- Discord support messages 入口。
- AI 回复历史记录：

```text
ai_support_conversations
```

- 支持 OpenAI Responses API。
- 支持 OpenAI-compatible Chat Completions API。
- 可切换 DeepSeek / 通义千问等兼容模型。
- AI 回复失败会写日志。
- AI 回复去重。
- 短游戏名识别：
  - 瓦 -> 无畏契约
  - LOL -> 英雄联盟
  - 三角洲 -> 三角洲行动
  - 王者 -> 王者荣耀
  - 吃鸡/PUBG -> 和平精英/PUBG
  - 永劫 -> 永劫无间
- 陪玩数量问题会查数据库真实数量。

当前推荐国内服务器配置：

```env
AI_SUPPORT_ENABLED=true
AI_SUPPORT_API_KEY=不要写入文档
AI_SUPPORT_MODEL=deepseek-v4-flash
AI_SUPPORT_BASE_URL=https://api.deepseek.com
AI_SUPPORT_API_STYLE=chat_completions
```

OpenAI 访问问题：

- 腾讯云当前服务器访问 OpenAI API 返回：

```text
403 unsupported_country_region_territory
```

- 说明不是余额问题，而是服务器地区被 OpenAI 拒绝。
- 因此国内/香港服务器建议先用 DeepSeek 或通义兼容接口。
- 如果未来做加拿大市场，可考虑加拿大/美国服务器使用 OpenAI。

Claude 重点审核：

- AI 是否可能胡乱承诺“已退款、已加余额、已提现”。
- AI 是否会泄露内部 Token、验证码、密码相关提示。
- AI 是否应增加强规则层，而不是完全依赖模型。
- DeepSeek 请求中的 `thinking: { type: "disabled" }` 是否兼容所选模型。
- `AI_SUPPORT_API_STYLE=chat_completions` 是否覆盖国内模型响应格式。
- 是否需要给 AI 客服加敏感操作分类器。
- 是否需要给 AI 回复加长度、重复、敏感词二次过滤。

## 10. 钱包、充值、优惠与推荐

当前用户要求已加入的方向：

- 人工充值。
- 管理端搜索客户并人工加余额。
- 优惠码系统。
- 充值码系统。
- 首充赠送。
- 老带新奖励。
- 陪玩带客奖励。
- 每个陪玩可设置抽成比例。
- 陪玩可设置支付宝收款信息。
- 充值码和优惠码应只能使用一次。

Claude 重点审核：

- 优惠码、充值码是否真的一次性使用。
- 是否有唯一约束或事务防并发重复使用。
- 管理员人工加余额是否写流水。
- 是否能删除或冲正错误余额。
- 是否应该禁止直接删除钱包流水，而使用反向调整流水。
- 充值申请、人工加余额、优惠奖励、推荐奖励是否区分类型。
- 陪玩抽成比例是否在订单完成结算时读取快照，避免后续修改影响历史订单。
- 支付宝收款信息是否只允许陪玩本人和管理员查看。

## 11. Postman 与运营工具

已配置 Postman：

```text
docs/postman/maycatplay-ops.postman_collection.json
docs/postman/maycatplay-production.postman_environment.json
```

已测试过：

- 管理员登录。
- 查询用户。
- 人工加余额接口。

注意：

- Postman 的 `admin_token` 应存为 Secret，不要提交真实 Token。
- 手工 API 调余额测试会产生真实钱包变动，应通过后台或冲正流水处理。

Claude 重点审核：

- Postman collection 是否覆盖关键运营接口。
- 是否有危险接口未加 RBAC。
- 是否需要增加“只读健康检查”和“运营自检”接口。

## 12. 数据库与迁移

Prisma schema：

```text
packages/database/prisma/schema.prisma
```

迁移目录：

```text
packages/database/prisma/migrations/
```

生产迁移命令：

```bash
sudo docker compose run --rm api-server pnpm --filter @dfc/database prisma:deploy
```

已遇到过：

- 初始化管理员脚本路径在 Docker 镜像中找不到，后续修复。
- Prisma deploy 在容器中因 OpenSSL 检测失败报错，后续通过重构镜像修复。

Claude 重点审核：

- 所有新增字段是否都有 migration。
- 生产迁移是否幂等。
- `ai_support_conversations.platformMessageId` 是否应加唯一约束。
- 加唯一约束前是否需要清理已有重复数据。
- `wallet_transactions` 是否不可删除。
- 是否需要资金表增加审计字段。

## 13. 当前已知风险

高优先级：

1. 资金安全仍需完整审计：人工加余额、充值码、优惠码、退款、提现必须全部事务化并留流水。
2. 管理端权限需要重点审计：创建管理员、升级用户为管理员、封禁、加余额、改陪玩抽成。
3. KOOK/Discord 双入口可能重复处理同一消息，KOOK 已加应用层去重，但仍需生产验证。
4. AI 客服不能替代人工处理资金、投诉、提现。
5. 多游戏范围变化可能导致旧的单游戏字段和流程不完整。

中优先级：

1. 管理后台仍可能存在静态数据或 UI 与真实接口混用。
2. 陪玩端注册应禁止自助注册，应由客服考核后管理员创建。
3. 客户端 OAuth 登录按钮存在，但 KOOK/Discord OAuth 是否完整可用需验证。
4. 微信客服二维码资源和公网路径需要规范管理。
5. UI 改版集中在 customer-web，admin/companion 仍需统一视觉但不能影响效率。

低优先级：

1. KOOK 频道顺序目前主要由人工拖动，脚本负责创建频道和发送欢迎规则。
2. Bot HTTP callback 模式下显示离线可能引起误解，需要运营文档说明。
3. 部分旧文档仍写“第一阶段只支持三角洲”，需要统一更新。

## 14. 建议 Claude 审核清单

请 Claude 按以下顺序审核：

1. 资金闭环：
   - 充值申请
   - 管理员加余额
   - 下单扣款
   - 订单完成结算
   - 平台抽成
   - 陪玩收益
   - 提现冻结、审核、打款
   - 退款与投诉

2. 权限安全：
   - JWT
   - RBAC
   - Admin/Super Admin 边界
   - 客户/陪玩/管理员入口隔离
   - API 是否可被越权调用

3. Bot 与 AI：
   - KOOK webhook 验证
   - Discord Bot 回调
   - 双平台重复接单
   - AI 客服重复回复
   - AI 是否会执行敏感承诺

4. 数据库：
   - Prisma schema 与 migration 一致性
   - 事务
   - 唯一约束
   - 钱包流水不可篡改

5. 前端真实数据：
   - customer-web 是否都用真实用户数据
   - admin-web 是否仍有 mock/static 数据
   - companion-web 是否有真实登录和权限

6. 部署：
   - Dockerfile
   - docker-compose.yml
   - Nginx
   - HTTPS
   - 备份
   - 更新脚本
   - 回滚策略

## 15. 最近关键提交

```text
7bb3903 Deduplicate KOOK support replies
00f0821 Tighten AI support replies
033d98b Support configurable AI provider endpoint
b2ef3d7 Improve AI support fallback understanding
5e50b1f Improve KOOK channel welcome layout
7283405 Refresh Maycat customer UI
a90b31c Improve KOOK AI support flow and layout docs
a7d3758 Improve KOOK support conversation replies
916ddcc Improve platform AI support replies
6cfad7c Fix KOOK adapter start path
8d3e9b2 Read KOOK setup env from container environment
a7a459f Add KOOK channel setup script
```

## 16. 已运行验证

本地已运行过：

```bash
pnpm --filter @dfc/api-server build
pnpm --filter @dfc/customer-web build
pnpm --filter @dfc/customer-web lint
```

生产已验证过：

- Docker Compose 服务可启动。
- Prisma migration 可 deploy。
- HTTPS 可访问。
- 客户站可打开。
- 管理员初始化可执行。
- KOOK webhook challenge 可通过。
- KOOK Bot 可发送频道消息。
- DeepSeek API Key 有效，但余额不足时返回 `402 Insufficient Balance`。
- OpenAI API 在当前服务器返回地区不支持 `403 unsupported_country_region_territory`。

仍需执行：

```bash
pnpm build
pnpm test
pnpm --filter @dfc/admin-web build
pnpm --filter @dfc/companion-web build
```

以及端到端业务测试：

- 客户注册
- 邮箱验证码
- 登录
- 充值申请
- 管理员审核充值
- 客户下单
- KOOK/Discord 派单通知
- 陪玩接单
- 订单完成
- 钱包结算
- 提现申请
- 管理员审核提现

## 17. 给 Claude 的输出要求

请 Claude 输出：

1. P0/P1/P2 问题列表，按严重程度排序。
2. 每个问题给出文件路径和具体函数/接口。
3. 明确哪些问题会影响真实运营。
4. 明确哪些问题会导致资金风险。
5. 明确哪些问题会导致 KOOK/Discord 重复消息、漏消息、误处理。
6. 给出最小修复方案，不要建议大规模重构。
7. 优先保证最小商业闭环，不要优先加新功能。

