# 钱包流

## 钱包字段

客户余额：

- `available_balance`
- `frozen_balance`

陪玩收益：

- `available_income`
- `pending_income`

## 充值流程

1. 客户提交充值申请：金额、截图、备注。
2. 创建 `recharge_requests`，状态 `PENDING`。
3. Discord 发送充值通知。
4. 管理员审核。
5. 通过时在事务内：
   - 更新申请为 `APPROVED`。
   - 增加客户 `available_balance`。
   - 写入 `wallet_transactions`，类型 `RECHARGE_APPROVED`。
   - 写入 `admin_logs`。
6. 拒绝时只更新申请状态和审核备注，写入 `admin_logs`。

## 下单扣款

1. 后端计算订单总价。
2. 检查 `available_balance >= totalAmount`。
3. 扣减客户 `available_balance`。
4. 写入 `wallet_transactions`，类型 `ORDER_PAYMENT`。
5. 创建订单和状态日志。

## 订单结算

1. 订单完成。
2. 后端计算：
   - `platformFee = totalAmount * PLATFORM_COMMISSION_RATE`
   - `companionIncome = totalAmount - platformFee`
3. 增加陪玩收益。
4. 写入 `ORDER_SETTLEMENT` 流水。

## 提现流程

1. 陪玩提交提现申请。
2. 检查 `available_income >= amount`。
3. 创建 `withdrawal_requests`，状态 `PENDING`。
4. 管理员审核。
5. 审核通过时冻结收益：
   - `available_income -= amount`
   - `frozen_balance += amount`
   - 写入 `WITHDRAWAL_FREEZE`
6. 人工打款后后台确认完成：
   - `frozen_balance -= amount`
   - 写入 `WITHDRAWAL_COMPLETED`
   - 提现状态改为 `PAID`
7. 审核拒绝或打款失败时释放冻结金额并写流水。

## 风控要求

- 禁止负余额。
- 禁止前端传入最终金额。
- 禁止无流水变更余额。
- 禁止跨用户操作钱包。
- 所有钱包变化必须事务化。
