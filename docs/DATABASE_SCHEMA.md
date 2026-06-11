# 数据库设计

数据库使用 PostgreSQL，ORM 使用 Prisma。Schema 位于：

```text
packages/database/prisma/schema.prisma
```

## 核心原则

- 统一 `users` 表，不建立多账户系统。
- `role` 区分 `CUSTOMER`、`COMPANION`、`ADMIN`、`SUPER_ADMIN`。
- 陪玩和订单都记录 `game`，用于多游戏业务。
- 钱包使用同一张 `wallets` 表，客户余额和陪玩收益字段并存。
- 订单状态变化写入 `order_status_logs`。
- 钱包变动写入 `wallet_transactions`。
- 管理员操作写入 `admin_logs`。

## GameCode

`GameCode` 首批支持：

- `DELTA_FORCE`
- `LEAGUE_OF_LEGENDS`
- `VALORANT`
- `COUNTER_STRIKE_2`
- `PUBG`
- `PUBG_MOBILE`
- `APEX_LEGENDS`
- `NARAKA_BLADEPOINT`
- `HONOR_OF_KINGS`
- `PEACEKEEPER_ELITE`
- `DOTA_2`
- `OVERWATCH_2`
- `RAINBOW_SIX_SIEGE`
- `ROCKET_LEAGUE`
- `EA_SPORTS_FC`
- `STREET_FIGHTER_6`
- `CALL_OF_DUTY`
- `WILD_RIFT`
- `MOBILE_LEGENDS`
- `MINECRAFT`
- `GENSHIN_IMPACT`

## 核心表

### users

统一账号表。字段包括邮箱、密码哈希、角色、状态、展示名和展示名唯一键。

- `displayName`：页面展示昵称。
- `displayNameKey`：规范化后的昵称，用于唯一约束。
- `@@unique([role, displayNameKey])`：同一角色下昵称不能重复，客户用户名重复会被数据库拒绝。

### email_verification_codes

邮箱验证码表。用于客户自助注册前验证真实邮箱，记录邮箱、用途、验证码哈希、失败次数、过期时间和消费时间。

### companion_profiles

陪玩资料表。字段包括昵称、头像、性别、游戏、段位/水平、擅长模式、价格、在线状态、简介、语音偏好、审核/上架状态。

### orders

订单表。订单记录客户、陪玩、派单人、游戏、模式、时长、单价、总价、平台抽成、陪玩收益和状态。

### wallets

- `available_balance`：客户可用余额。
- `frozen_balance`：客户订单冻结余额。
- `available_income`：陪玩可提现收益。
- `pending_income`：陪玩待结算收益。
- `frozen_income`：陪玩提现审核/打款期间冻结收益。

### recharge_requests

人工充值申请。客户提交金额、截图和备注，管理员审核为 `APPROVED` 或 `REJECTED`。

### withdrawal_requests

提现申请。陪玩提交提现金额和收款信息，管理员审核，人工打款后标记 `PAID`。

### complaints

投诉记录。支持订单投诉、后台处理和结果记录。

### admin_logs

管理员操作日志。覆盖创建陪玩、上架、下架、封禁、审核充值、审核提现、派单、处理投诉等动作。

### bot_events

Bot 事件记录。通过 `platform` 区分 `DISCORD` 和 `KOOK`，覆盖通知发送、按钮接单、管理员提醒等事件。

## 事务要求

必须使用事务的场景：

- 注册用户并创建钱包。
- 校验并消费邮箱验证码、注册用户并创建钱包。
- 管理员创建陪玩账号、钱包和资料。
- 审核充值通过并增加余额。
- 下单扣款并创建订单。
- 派单并写订单日志。
- 接单防重复检查并更新订单状态。
- 完成订单并结算平台抽成与陪玩收益。
- 提现审核、冻结、打款完成、生成流水。
