# May猫饼 礼物打赏与赠时系统设计

## 目标

让客户可以给陪玩打赏礼物，同时保证资金安全、流水可审计、不能刷余额、不能绕过订单结算。

## 基本原则

- 打赏只能使用客户站内余额。
- 打赏金额由后端计算，前端不能决定真实金额。
- 每一笔打赏都写入 `wallet_transactions`。
- 陪玩收到的打赏进入 `availableIncome`，后续走人工提现。
- 大额打赏可以触发“赠送下单时间”，但赠时必须是权益记录，不直接篡改已支付订单。
- 赠时权益由管理员或客服确认后用于后续下单，避免恶意刷单和纠纷。

## 礼物分层

| 礼物 | 金额 | 陪玩到账 | 赠时 |
| --- | ---: | ---: | --- |
| 小鱼干 | ¥6 | 按打赏抽成后到账 | 无 |
| 能量饮料 | ¥18 | 按打赏抽成后到账 | 无 |
| 霓虹猫爪 | ¥66 | 按打赏抽成后到账 | 无 |
| 电竞键帽 | ¥188 | 按打赏抽成后到账 | 无 |
| 赛博王冠 | ¥520 | 按打赏抽成后到账 | 赠 0.5 小时权益 |
| May猫饼火箭 | ¥1314 | 按打赏抽成后到账 | 赠 1 小时权益 |
| 名人堂赞助 | ¥5200 | 按打赏抽成后到账 | 赠 5 小时权益，人工确认 |

## 抽成建议

默认打赏平台抽成：

```text
20%
```

后台后续应支持：

```text
GIFT_PLATFORM_COMMISSION_RATE=0.2
```

计算方式：

```text
客户扣款 = 礼物金额
平台收入 = 礼物金额 * 抽成比例
陪玩收入 = 礼物金额 - 平台收入
```

## 订单关联规则

客户打赏时可以选择：

```text
1. 关联某个已完成订单
2. 直接打赏某个陪玩
```

推荐优先要求关联订单，因为更适合客服处理纠纷。

## 赠时权益规则

大额礼物触发赠时权益：

```text
gift_time_credits
```

字段建议：

```text
id
customerId
companionId
giftTransactionId
hours
status: AVAILABLE / RESERVED / USED / EXPIRED / CANCELLED
expiresAt
createdAt
usedOrderId
```

使用方式：

```text
客户下单
↓
选择可用赠时权益
↓
后端将赠时时长加入订单备注和客服审核
↓
管理员确认后用于补时或安排额外局
```

第一阶段不建议让赠时自动抵扣订单金额，因为会影响价格、抽成、陪玩收益和退款计算。

## 防刷与风控

必须防止：

- 客户余额不足仍打赏。
- 重复点击导致重复扣款。
- 前端伪造礼物金额。
- 客户给不存在或未上架陪玩打赏。
- 未完成订单纠纷期内大额赠时被滥用。
- 打赏后退款绕过平台审核。

后端要求：

```text
数据库事务
updateMany + availableBalance >= amount
wallet_transactions 双方流水
admin_logs 高额打赏记录
幂等键 idempotencyKey
```

## 推荐接口

客户：

```text
GET  /api/gifts/catalog
POST /api/gifts/tips
GET  /api/gifts/my-tips
GET  /api/gifts/my-time-credits
```

陪玩：

```text
GET /api/gifts/received
```

管理后台：

```text
GET  /api/admin/gifts/tips
GET  /api/admin/gifts/time-credits
PATCH /api/admin/gifts/time-credits/:id
```

## 数据库建议

```text
gift_catalog
gift_tips
gift_time_credits
```

`wallet_transactions.type` 后续需要新增：

```text
GIFT_TIP_PAYMENT
GIFT_TIP_INCOME
GIFT_TIME_CREDIT_GRANTED
```

## UI 入口

客户端：

- 陪玩详情页：礼物打赏按钮。
- 我的订单：已完成订单旁边显示“打赏陪玩”。
- 个人中心：我的赠时权益。

陪玩端：

- 工作台：今日收到礼物。
- 收益明细：礼物收入。

管理端：

- 财务流水：礼物打赏流水。
- 礼物管理：调整礼物金额、赠时规则、是否启用。
- 赠时审核：查看大额赠时权益。

## 上线顺序

1. 先上线礼物目录和只读 UI。
2. 再上线小额打赏扣款和陪玩收入。
3. 最后上线大额赠时权益。

不要直接第一版就做自动抵扣订单金额。
