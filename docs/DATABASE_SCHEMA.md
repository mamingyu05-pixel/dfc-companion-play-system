# 数据库设计

数据库使用 PostgreSQL，ORM 使用 Prisma。Schema 位于：

```text
packages/database/prisma/schema.prisma
```

## 核心原则

- 统一 `users` 表，不建立多账户系统。
- `role` 区分 `CUSTOMER`、`COMPANION`、`ADMIN`、`SUPER_ADMIN`。
- 钱包使用同一张 `wallets` 表，客户余额与陪玩收益字段并存。
- 订单状态变化写入 `order_status_logs`。
- 钱包变动写入 `wallet_transactions`。
- 管理员操作写入 `admin_logs`。
- 第一阶段 `game` 固定为 `DELTA_FORCE`。

## 核心表

### users

统一账号表。字段包括邮箱、密码哈希、角色、状态、展示名。

### user_external_accounts

陪玩外部平台账号绑定表。用于把系统陪玩账号与 Discord/KOOK 用户 ID 绑定。

- `platform`: `DISCORD` 或 `KOOK`。
- `externalUserId`: Discord/KOOK 用户 ID。
- 同一平台的同一外部用户只能绑定一个系统用户。
- 同一系统用户在同一平台只能绑定一个外部账号。

### companion_profiles

陪玩资料表。字段包括昵称、头像、性别、游戏、三角洲段位、擅长模式、价格、在线状态、简介、语音偏好、审核/上架状态。

### wallets

钱包表。

- `available_balance`: 客户可用余额。
- `frozen_balance`: 客户冻结余额。
- `available_income`: 陪玩可提现收益。
- `pending_income`: 陪玩待结算收益。

### orders

订单表。状态包括：

- `PENDING_PAYMENT`
- `PAID`
- `ASSIGNED`
- `ACCEPTED`
- `IN_PROGRESS`
- `COMPLETED`
- `CANCELLED`
- `REFUND_REQUESTED`
- `REFUNDED`
- `DISPUTED`

### order_status_logs

订单状态日志。任何状态变化必须记录旧状态、新状态、操作者、原因。

### wallet_transactions

钱包流水。任何余额、收益、冻结变化必须记录类型、方向、金额、变动后余额、关联业务对象。

### recharge_requests

人工充值申请。客户提交金额、截图和备注，管理员审核为 `APPROVED` 或 `REJECTED`。

### withdrawal_requests

提现申请。陪玩提交提现金额和收款信息，管理员审核，人工打款后标记 `PAID`。

### complaints

投诉记录。支持订单投诉、后台处理和结果记录。

### admin_logs

管理员操作日志。覆盖创建陪玩、编辑资料、重置密码、封禁、上架、下架、审核充值、审核提现、派单、处理投诉等动作。

### bot_events

Bot 事件记录。通过 `platform` 区分 `DISCORD` 和 `KOOK`，覆盖通知发送、按钮接单、管理员提醒等事件。

事件状态：

- `PENDING`
- `SENT`
- `FAILED`

通知失败必须记录 `error`，便于后台补发或排查。

## 事务要求

必须使用事务的场景：

- 注册用户并创建钱包。
- 管理员创建陪玩账号、钱包和资料。
- 审核充值通过并增加余额。
- 下单扣款并创建订单。
- 派单并写订单日志。
- 接单防重复检查并更新订单状态。
- 完成订单并结算平台抽成与陪玩收益。
- 提现审核、冻结、打款完成、生成流水。
