# Claude 审核报告处理记录

处理日期：2026-06-11

来源文件：`docs/CLAUDE_REVIEW_BRIEF.md` 与用户粘贴的 Claude 审核报告。

## 已处理

## 第二次复审后新增处理

### RBAC 复审点

已调整：

- `RolesGuard` 增加 `SUPER_ADMIN` 继承 `ADMIN` 权限。
- 当前没有启用全局 `JwtAuthGuard`，而是在需要登录的 Controller/Route 上显式使用：
  - `/api/admin/*`
  - `/api/orders/*`
  - `/api/wallet/*`
- 原因：第一阶段 Bot 内部接口 `/api/discord/orders/accept`、`/api/kook/orders/accept` 使用 `BotInternalGuard + x-bot-token`，不应被全局 JWT 拦截。
- 后续如果改全局守卫，需要同时实现 `@Public()` 和 `@BotInternal()` 路由元数据，避免 Bot 回写被误拦截。

### 陪玩封禁登录

已调整：

- 陪玩登录 `portal = companion` 时，如果 `CompanionProfile.status = BANNED`，拒绝登录。
- `PENDING_REVIEW` / `UNLISTED` 仍允许登录，便于陪玩查看资料或等待审核；是否限制功能由后续接口权限控制。

### 下单资金语义

已调整：

- 客户下单不再只是扣 `availableBalance`。
- 当前实现为：
  - `availableBalance -= totalAmount`
  - `frozenBalance += totalAmount`
- 订单完成结算时：
  - `frozenBalance -= totalAmount`
  - 计算平台抽成
  - 增加陪玩 `availableIncome`

说明：

- 第一阶段暂不设置争议期，所以完成订单后陪玩收益直接进入 `availableIncome`。
- `pendingIncome` 保留给后续争议期/延迟结算机制。

### 下单时长上限

已调整：

- 新增 `ORDER_MAX_HOURS` 环境变量。
- 默认最大下单时长为 `8` 小时。
- `hours <= 0` 或超过上限会拒绝。

### 提现状态机核对

当前实现：

- `createWithdrawalRequest()`
  - `availableIncome -= amount`
  - `frozenIncome += amount`
  - 创建 `PENDING` 提现申请
- `PENDING -> APPROVED`
  - 只改状态，不重复扣款
- `PENDING -> REJECTED`
  - `frozenIncome -= amount`
  - `availableIncome += amount`
- `APPROVED -> PAID`
  - `frozenIncome -= amount`
  - 写 `WITHDRAWAL_COMPLETED`

所有状态变更都使用 `updateMany + 当前状态`，并检查 `count !== 1`。

### migration 说明

Claude 提到 `_prisma_migrations` 插入语句风险。说明如下：

- Prisma migration 文件本身通常不手写插入 `_prisma_migrations`。
- `prisma migrate deploy` 会执行 migration 并记录到 `_prisma_migrations`。
- 如果生产数据库已经手工建表，才需要用 `prisma migrate resolve --applied 202606110001_initial` 标记。

### P0-1 JWT 登录与 RBAC

新增：

- `apps/api-server/src/modules/auth/auth.service.ts`
- `apps/api-server/src/modules/auth/jwt-auth.guard.ts`
- `apps/api-server/src/modules/auth/roles.guard.ts`
- `apps/api-server/src/modules/auth/roles.decorator.ts`
- `apps/api-server/src/modules/auth/current-user.decorator.ts`
- `apps/api-server/src/modules/auth/auth.types.ts`

完成内容：

- 客户注册会创建 `CUSTOMER` 用户和钱包。
- 登录会校验密码、用户状态、入口 portal 与角色匹配。
- 登录成功签发 JWT。
- 管理员路由 `/api/admin/*` 强制要求 `ADMIN` 或 `SUPER_ADMIN`。
- 订单和钱包关键接口按角色保护：
  - 客户：下单、充值申请、查看钱包
  - 陪玩：提现申请、开始订单
  - 管理员：派单、充值审核、提现审核、订单完成结算

### P0-2 钱包资金事务

新增：

- `apps/api-server/src/modules/wallet/wallet.service.ts`

完成内容：

- 充值申请创建。
- 管理员审核充值：
  - `PENDING -> APPROVED/REJECTED`
  - 使用 `updateMany + status = PENDING` 防重复审核
  - 审核通过增加客户 `availableBalance`
  - 写入 `wallet_transactions`
  - 写入 `admin_logs`
- 客户下单：
  - 后端计算价格
  - 使用 `updateMany + availableBalance >= totalAmount` 防负余额
  - 扣客户余额
  - 创建 `PAID` 订单
  - 写入订单状态日志和钱包流水
- 订单完成结算：
  - `IN_PROGRESS -> COMPLETED`
  - 计算平台抽成和陪玩收入
  - 增加陪玩 `availableIncome`
  - 写入 `wallet_transactions` 和 `order_status_logs`
- 陪玩提现申请：
  - 使用 `availableIncome >= amount` 防负收益
  - `availableIncome -> frozenIncome`
  - 创建 `PENDING` 提现申请
  - 写入冻结流水
- 管理员审核提现：
  - `PENDING -> APPROVED`
  - `PENDING -> REJECTED` 时释放冻结收益
  - `APPROVED -> PAID` 时扣除冻结收益
  - 使用 `updateMany + 当前状态` 防重复审核
  - 写入 `wallet_transactions` 和 `admin_logs`

### P0-3 Prisma migration

新增：

- `packages/database/prisma/migrations/202606110001_initial/migration.sql`

完成内容：

- 初始数据库表结构 SQL
- 枚举、表、索引、唯一约束、外键约束
- 新增 `Wallet.frozenIncome` 字段支持提现冻结

说明：

- 当前环境不能运行 `prisma migrate dev`，所以 migration 是按当前 Prisma schema 手工整理的 SQL。
- 需要在有 Node/pnpm/Prisma 的机器上执行 `pnpm --filter @dfc/database prisma migrate deploy` 做最终验证。

### P1-2 派单陪玩状态校验

修改：

- `apps/api-server/src/modules/orders/orders.service.ts`

完成内容：

- 管理员派单时要求陪玩：
  - `role = COMPANION`
  - `status = ACTIVE`
  - `companionProfile.status = LISTED`
- Discord/KOOK 接单时也校验绑定陪玩资料必须 `LISTED`。

### P1-6 审计日志

完成内容：

- 管理员派单从 JWT 当前用户获取管理员 ID，不再信任请求体。
- 创建陪玩、充值审核、提现审核、派单均写入 `admin_logs`。

### Bot 文案与插值

检查结果：

- `apps/api-server/src/modules/bot/bot-notification.service.ts` 当前 UTF-8 读取为正常中文。
- KOOK 卡片当前使用 `${payload.orderNo}` 等模板字符串插值。
- `apps/discord-bot/src/index.ts` 当前 UTF-8 读取为正常中文。

补充说明：

- PowerShell 默认编码可能显示乱码，但指定 `-Encoding UTF8` 后正常。

## 仍未完成

### 前端真实 API 对接

仍未完成：

- Customer Portal 静态数据接真实登录、充值申请、下单、钱包流水 API。
- Companion Portal 静态数据接真实订单、收益、提现 API。
- Admin Portal 静态数据接真实充值审核、派单、提现审核、操作日志 API。

### Bot 完整通知闭环

仍未完成：

- 充值通知
- 提现通知
- 投诉通知
- 管理员提醒
- 接单成功后通知客户/管理员
- 接单成功后更新 Discord/KOOK 原消息按钮状态
- 失败通知重试队列

### 投诉/退款闭环

仍未完成：

- 投诉处理真实事务
- 退款申请
- 退款审核
- 钱包退款流水

### 自动化测试

仍未完成：

- Jest 单元测试
- 订单并发测试
- 钱包重复审核测试
- RBAC 权限测试
- 端到端业务闭环测试

## 当前验证结果

已执行：

```text
git diff --check
```

结果：

- 通过，无空白错误。

无法执行：

```text
pnpm --version
node --version
pnpm -r lint
pnpm -r build
pnpm --filter @dfc/database prisma validate
```

原因：

- 当前机器 `pnpm` 未安装。
- 当前环境 `node.exe` 拒绝访问。

## 建议 Claude 复审重点

请 Claude 重点复审：

1. `JwtAuthGuard` 和 `RolesGuard` 是否满足当前 RBAC 要求。
2. `WalletService.reviewRecharge()` 是否能防重复审核和防错误入账。
3. `OrdersService.createOrder()` 是否能防负余额和后端计算金额。
4. `OrdersService.completeOrder()` 是否能防重复结算。
5. `WalletService.createWithdrawalRequest()` 与 `reviewWithdrawal()` 是否能防负收益、防重复审核。
6. `packages/database/prisma/migrations/202606110001_initial/migration.sql` 是否与 schema 一致。
7. 是否需要把 `availableIncome` 和 `pendingIncome` 的业务含义进一步拆清。
