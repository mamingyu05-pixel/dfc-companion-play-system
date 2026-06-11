# DFC 项目计划

## 阶段目标

第一阶段只交付《三角洲行动》陪玩业务最小商业闭环：

1. 管理员创建陪玩账号并上架。
2. 客户注册并提交人工充值申请。
3. 管理员审核充值，客户余额增加。
4. 客户使用余额下单。
5. 管理员派单，Discord 与 KOOK 频道同步通知。
6. 陪玩通过 Discord 或 KOOK 按钮接单。
7. 订单开始并完成。
8. 后端计算平台抽成，陪玩收益增加。
9. 陪玩提交提现申请。
10. 管理员审核提现并人工打款确认完成。

闭环未稳定前，不开发 APP、小程序、多游戏、自动支付、自动提现。

## 市场与 Bot 策略

- 国内运营和陪玩团队优先保证 KOOK 可用。
- 加拿大和海外市场同步保证 Discord 可用。
- Discord 与 KOOK 只负责通知、按钮交互、私信、语音房和角色同步。
- 订单、钱包、结算、权限逻辑只在 API Server 实现，不允许在 Bot 中复制业务逻辑。

## 模块边界

- `apps/customer-web`: 客户注册、登录、余额、充值申请、下单、订单列表、投诉。
- `apps/companion-web`: 陪玩登录、资料、订单、收益、提现申请。
- `apps/admin-web`: 陪玩管理、充值审核、提现审核、派单、投诉、流水、报表、操作日志。
- `apps/api-server`: 认证、RBAC、订单、钱包、审核、日志、Discord/KOOK 回写。
- `apps/discord-bot`: Discord 订单通知、按钮接单、管理员提醒。
- `apps/kook-adapter`: KOOK 订单通知、按钮接单、管理员提醒、私信、语音房、角色同步。
- `packages/database`: Prisma Schema、Client、Migration、Seed。
- `packages/shared`: 共享枚举、DTO 基础类型、BotAdapter。
- `packages/auth`: 密码哈希、JWT/RBAC 辅助能力。

## 多 Agent 分工

- Project Manager Agent: 拆任务、审架构、审业务、集成测试。
- Database Agent: Prisma、Migration、Seed、Schema。
- Customer Agent: 客户端。
- Companion Agent: 陪玩端。
- Admin Agent: 管理后台。
- Order Agent: 订单系统。
- Wallet Agent: 钱包系统。
- Discord Agent: Discord Bot。
- KOOK Agent: KOOK Bot 与适配层。
- UI/UX Design Agent: 全站视觉风格、三端 UI、响应式体验、组件规范和流程优化。
- DevOps Agent: Docker、HTTPS、备份、监控、日志、回滚、零停机。
- QA Agent: 自动化测试、安全测试、权限测试、业务闭环测试。

## 里程碑

### M1 工程基线

- Monorepo 结构。
- `.env.example`。
- Docker Compose PostgreSQL。
- Prisma Schema。
- 文档与测试清单。

### M2 后端闭环

- JWT 登录。
- RBAC。
- 用户/陪玩管理。
- 充值审核。
- 钱包事务。
- 订单状态机。
- 提现审核。
- 管理员日志和订单日志。

### M3 门户闭环

- 三个入口页面。
- 表单、列表、审核动作。
- 错误提示和权限拦截。
- UI/UX Design Agent 输出三端页面原型、Tailwind 主题和可复用组件规范。

### M4 双 Bot 闭环

- Discord 订单通知。
- KOOK 订单通知。
- Discord 按钮接单。
- KOOK 按钮接单。
- 充值/提现/投诉/管理员提醒双平台发送。
- KOOK 语音房创建。
- KOOK/Discord 用户与系统陪玩账号绑定。
- Bot 事件按平台回写数据库。

### M5 部署与 QA

- Docker 化部署。
- HTTPS/Nginx。
- 备份策略。
- 监控日志。
- 闭环测试报告。

## 验收原则

- 金额只由后端计算。
- 所有资金变化必须进入 `wallet_transactions`。
- 所有订单状态变化必须进入 `order_status_logs`。
- 所有管理员动作必须进入 `admin_logs`。
- 所有 Bot 事件必须进入 `bot_events` 并记录平台。
- 所有三端页面必须符合 UI/UX Design Agent 输出的组件规范和响应式规范。
- 所有关键业务写操作必须使用数据库事务。
- 双平台同时点击接单时，后端只能允许一次成功。
- 失败必须回滚，不允许半完成资金状态。
