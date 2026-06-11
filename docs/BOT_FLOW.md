# Bot 流

第一阶段同步支持 Discord 和 KOOK。

## 平台策略

- 国内运营和陪玩团队优先使用 KOOK。
- 加拿大和海外市场优先使用 Discord。
- API Server 是唯一业务真源。
- Bot 只负责通知、按钮交互、私信、语音房和角色同步。
- Discord 与 KOOK 不允许各自复制订单、钱包、结算逻辑。

## 第一阶段职责

- Discord 订单通知。
- KOOK 订单通知。
- Discord 充值通知。
- KOOK 充值通知。
- Discord 提现通知。
- KOOK 提现通知。
- Discord 投诉通知。
- KOOK 投诉通知。
- Discord 按钮接单。
- KOOK 按钮接单。
- 双平台管理员提醒。
- KOOK 语音房创建。
- KOOK 角色同步。
- Bot 事件回写数据库。

## 订单通知

触发：管理员派单后，订单状态变为 `ASSIGNED`。

流程：

1. API Server 生成订单通知载荷。
2. Discord Bot 向 Discord 订单频道发送订单卡片。
3. KOOK Bot 向 KOOK 订单频道发送订单卡片。
4. 卡片包含订单编号、模式、时长、价格、陪玩信息。
5. 卡片附带“接单”按钮。
6. 分别写入 `bot_events.ORDER_NOTIFICATION_SENT`，并记录 `platform`。

## Discord 按钮接单

触发：陪玩点击 Discord 按钮。

流程：

1. Discord Bot 获取 `orderId` 和 Discord 用户 ID。
2. Discord Bot 调用 `POST /api/discord/orders/accept`。
3. API 校验 Bot 内部凭证。
4. API 映射 Discord 用户到陪玩账号。
5. API 使用事务和条件更新防重复接单。
6. 成功后订单状态变为 `ACCEPTED`。
7. 写入 `order_status_logs`。
8. 写入 `bot_events.ORDER_ACCEPT_CLICKED`，`platform=DISCORD`。

## KOOK 按钮接单

触发：陪玩点击 KOOK 按钮。

流程：

1. KOOK Bot 获取 `orderId` 和 KOOK 用户 ID。
2. KOOK Bot 调用 `POST /api/kook/orders/accept`。
3. API 校验 Bot 内部凭证。
4. API 映射 KOOK 用户到陪玩账号。
5. API 使用事务和条件更新防重复接单。
6. 成功后订单状态变为 `ACCEPTED`。
7. 写入 `order_status_logs`。
8. 写入 `bot_events.ORDER_ACCEPT_CLICKED`，`platform=KOOK`。

## 充值、提现、投诉通知

触发场景：

- 新充值申请。
- 新提现申请。
- 新投诉。
- 订单长时间未派单。
- Bot 接单异常。

处理规则：

- Discord 和 KOOK 同步通知管理员频道。
- 任一平台失败，不得阻断核心数据库事务。
- 失败必须写入日志，供管理员补发或排查。

## KOOK 语音房和角色

KOOK 第一阶段同步支持：

- `sendOrderNotification()`
- `sendAdminAlert()`
- `sendDirectMessage()`
- `createVoiceRoom()`
- `syncRole()`

`createVoiceRoom()` 使用 KOOK 频道创建接口创建语音频道。`syncRole()` 使用 KOOK 服务器角色授权接口。

## 试音语音房

触发场景：

- 客户在陪玩详情页点击“申请试音”。
- 管理员在派单前为平台代选订单安排试音。
- 陪玩接单后，客户希望先确认语音沟通。

处理规则：

1. API Server 创建试音请求或在订单上标记 `voiceTrialRequested=true`。
2. Bot Adapter 调用 `createVoiceRoom(orderId)` 创建临时语音房。
3. 国内优先创建 KOOK 语音房。
4. 加拿大/海外优先创建 Discord 语音房。
5. 语音房 ID 写入订单 `voiceRoomId` 或后续独立试音表。
6. Bot 私信客户和陪玩进入语音房。
7. 试音结束后由管理员或系统关闭语音房。

边界：

- 试音不是订单开始。
- 试音不触发陪玩收益结算。
- 试音失败不自动退款，进入客服处理。

## 配置要求

Discord 需要：

```text
DISCORD_TOKEN
DISCORD_GUILD_ID
DISCORD_ORDER_CHANNEL_ID
DISCORD_ADMIN_CHANNEL_ID
DISCORD_RECHARGE_CHANNEL_ID
DISCORD_WITHDRAWAL_CHANNEL_ID
DISCORD_COMPLAINT_CHANNEL_ID
```

KOOK 需要：

```text
KOOK_TOKEN
KOOK_VERIFY_TOKEN
KOOK_GUILD_ID
KOOK_ORDER_CHANNEL_ID
KOOK_ADMIN_CHANNEL_ID
KOOK_RECHARGE_CHANNEL_ID
KOOK_WITHDRAWAL_CHANNEL_ID
KOOK_COMPLAINT_CHANNEL_ID
KOOK_VOICE_CATEGORY_ID
KOOK_CUSTOMER_ROLE_ID
KOOK_COMPANION_ROLE_ID
KOOK_ADMIN_ROLE_ID
KOOK_SUPER_ADMIN_ROLE_ID
```

KOOK 开发者后台 Webhook 回调地址建议配置：

```text
https://你的域名/api/kook/webhook?compress=0
```

使用 `compress=0` 是为了让 API Server 直接接收 JSON。后续如需启用压缩或加密，再增加 zlib/AES 解压解密处理。
