# API 说明

API 前缀：

```text
/api
```

认证：JWT。

权限：RBAC，角色包括 `CUSTOMER`、`COMPANION`、`ADMIN`、`SUPER_ADMIN`。

## Auth

### POST /api/auth/register/customer

客户注册。

请求：

```json
{
  "email": "customer@example.com",
  "password": "ChangeMe123!",
  "displayName": "客户A"
}
```

处理：

- 创建 `CUSTOMER` 用户。
- 创建钱包。
- 返回 JWT。

### POST /api/auth/login

三端登录共用接口，通过 `portal` 校验入口权限。

请求：

```json
{
  "email": "admin@dfc.local",
  "password": "ChangeMe123!",
  "portal": "admin"
}
```

规则：

- `/customer` 只允许 `CUSTOMER`。
- `/companion` 只允许 `COMPANION`。
- `/admin` 只允许 `ADMIN`、`SUPER_ADMIN`。

## Admin

### POST /api/admin/companions

创建陪玩账号。写入 `admin_logs`。

### PATCH /api/admin/companions/:id

编辑陪玩资料。

### PATCH /api/admin/companions/:id/reset-password

重置陪玩密码。

### PATCH /api/admin/companions/:id/ban

封禁陪玩。

### PATCH /api/admin/companions/:id/list

上架陪玩。

### PATCH /api/admin/companions/:id/unlist

下架陪玩。

### PATCH /api/admin/recharges/:id/review

审核充值。

请求：

```json
{
  "status": "APPROVED",
  "note": "截图有效"
}
```

通过时：

- 增加客户 `available_balance`。
- 写入 `wallet_transactions`。
- 写入 `admin_logs`。
- 同步发送 Discord 和 KOOK 通知。

### PATCH /api/admin/withdrawals/:id/review

审核提现。

### PATCH /api/admin/withdrawals/:id/mark-paid

后台确认人工打款完成。

### PATCH /api/admin/orders/:id/assign

派单。

请求：

```json
{
  "companionId": "companion_user_id",
  "assignedById": "admin_user_id"
}
```

处理：

- 只允许 `PAID` 订单派单。
- 使用事务将订单改为 `ASSIGNED`。
- 写入 `order_status_logs`。
- 写入 `admin_logs`。
- 事务提交后同步发送 Discord 与 KOOK 订单通知。
- 通知失败只写入 `bot_events`，不回滚订单。

### POST /api/admin/companions/:id/external-accounts

绑定陪玩的 Discord 或 KOOK 用户 ID。

请求：

```json
{
  "platform": "KOOK",
  "externalUserId": "kook_user_id",
  "displayName": "陪玩KOOK昵称",
  "actorId": "admin_user_id"
}
```

规则：

- `platform` 只能是 `DISCORD` 或 `KOOK`。
- 一个陪玩在同一平台只能绑定一个外部账号。
- 同一个外部账号不能绑定多个陪玩。
- 写入 `admin_logs`。

### PATCH /api/admin/complaints/:id/resolve

处理投诉。

## Wallet

### GET /api/wallet/me

查看当前用户钱包和流水。

### POST /api/wallet/recharge-requests

客户提交充值申请。

### POST /api/wallet/withdrawal-requests

陪玩提交提现申请。

## Orders

### POST /api/orders

客户下单。金额必须由后端按陪玩价格、时长、平台规则计算。

请求需要支持：

```json
{
  "assignmentType": "DIRECT_COMPANION",
  "companionId": "companion_user_id",
  "mode": "烽火地带",
  "hours": "2",
  "voiceTrialRequested": true,
  "notes": "希望先试音，偏教学"
}
```

平台代选时：

```json
{
  "assignmentType": "PLATFORM_MATCH",
  "mode": "烽火地带",
  "hours": "2",
  "voicePreference": "可语音",
  "notes": "希望管理员安排耐心教学型陪玩"
}
```

规则：

- `DIRECT_COMPANION` 必须传 `companionId`。
- `PLATFORM_MATCH` 不传 `companionId`，由管理员在派单页面人工挑选。
- `voiceTrialRequested=true` 时，派单后可创建临时语音房。

### PATCH /api/orders/:id/start

订单开始。

### PATCH /api/orders/:id/complete

订单完成并结算。

## Discord

### POST /api/discord/orders/accept

Discord Bot 按钮接单回写。

要求：

- Bot 请求必须有服务端签名或内部 token。
- 请求头必须带 `x-bot-token: BOT_INTERNAL_TOKEN`。
- 根据 Discord 用户映射陪玩。
- 使用事务和条件更新防重复接单。

## KOOK

### POST /api/kook/orders/accept

KOOK Bot 按钮接单回写。

要求：

- Bot 请求必须有服务端签名或内部 token。
- 内部接口请求头必须带 `x-bot-token: BOT_INTERNAL_TOKEN`。
- 根据 KOOK 用户映射陪玩。
- 使用事务和条件更新防重复接单。
- 写入 `bot_events.platform = KOOK`。

### POST /api/kook/webhook

KOOK 官方 Webhook 回调。

用途：

- 处理 KOOK Challenge 校验。
- 校验 `KOOK_VERIFY_TOKEN`。
- 从按钮事件中读取 `order.accept.{orderId}`。
- 根据 KOOK 用户 ID 接单。

部署时建议在 KOOK 开发者后台配置：

```text
https://你的域名/api/kook/webhook?compress=0
```
