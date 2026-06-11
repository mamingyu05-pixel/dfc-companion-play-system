# 订单流

## 状态机

```text
PENDING_PAYMENT
  -> PAID
  -> ASSIGNED
  -> ACCEPTED
  -> IN_PROGRESS
  -> COMPLETED
```

异常状态：

```text
CANCELLED
REFUND_REQUESTED
REFUNDED
DISPUTED
```

## 正常流程

1. 客户下单，可选择指定陪玩或平台代选。
2. 后端计算金额。
3. 检查客户 `available_balance`。
4. 扣减客户 `available_balance`，增加客户 `frozen_balance`。
5. 创建订单，状态为 `PAID`。
6. 写入 `wallet_transactions`。
7. 写入 `order_status_logs`。
8. 如果客户指定陪玩，管理员可确认派给该陪玩；如果客户选择平台代选，管理员必须人工挑选陪玩并派单，状态为 `ASSIGNED`。
9. Discord 与 KOOK 同步发送订单通知。
10. 陪玩在 Discord 或 KOOK 点击接单按钮。
11. API 防重复接单，状态为 `ACCEPTED`。
12. 陪玩或管理员开始订单，状态为 `IN_PROGRESS`。
13. 订单完成。
14. 后端计算平台抽成和陪玩收益。
15. 扣减客户 `frozen_balance`。
16. 第一阶段直接增加陪玩 `available_income`，`pending_income` 保留给后续争议期。
17. 写入钱包流水和订单日志。

## 指定陪玩与平台代选

下单必须支持两种方式：

- `DIRECT_COMPANION`: 客户在陪玩列表或详情页选择具体陪玩后下单。
- `PLATFORM_MATCH`: 客户没有选好陪玩，提交需求后由管理员人工挑选陪玩。

平台代选规则：

- 客户必须填写模式、时长、语音偏好和备注。
- 订单进入 `PAID` 后显示为待派单。
- 管理员在派单页面根据段位、模式、在线状态、价格、语音偏好人工挑人。
- 派单后 Discord/KOOK 同步通知被选中的陪玩。
- 平台代选不允许 Bot 公开抢单，第一阶段必须管理员派单。

## 语音展示与试音

陪玩列表和详情页必须展示：

- 语音偏好。
- 是否支持试音。
- 语音风格标签，例如指挥型、教学型、安静型。

试音规则：

- 试音只用于确认沟通体验，不代表订单开始。
- 试音需要创建临时 Discord/KOOK 语音房。
- 国内优先使用 KOOK 语音房。
- 海外/加拿大优先使用 Discord。
- 正式服务开始仍必须由订单状态从 `ACCEPTED` 进入 `IN_PROGRESS`。
- 试音异常可以联系客服或重新派单。

## 防重复接单

接单必须使用条件更新：

- 当前状态必须是 `ASSIGNED`。
- `companionId` 必须匹配派单陪玩，或由后台规则允许公开抢单。
- 更新成功数量必须为 1。
- 失败返回订单已被接单或状态已变化。

## 防重复结算

完成订单必须满足：

- 当前状态为 `IN_PROGRESS`。
- 使用 `updateMany + status = IN_PROGRESS` 防重复结算。
- 客户 `frozen_balance` 必须足够覆盖订单金额。
- 订单结算在同一事务内完成。

## 日志要求

每一次状态变化写入：

- `orderId`
- `fromStatus`
- `toStatus`
- `actorId`
- `reason`
- `createdAt`
