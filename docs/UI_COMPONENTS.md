# DFC UI 组件清单

## 基础组件

1. `AppShell`
   - 三端页面基础壳层。
   - 支持 PC 侧栏、移动端底部导航。

2. `TopBar`
   - 品牌、用户状态、余额、通知。

3. `SideNav`
   - 管理后台 PC 侧边导航。

4. `MobileTabBar`
   - 客户端和陪玩端手机底部导航。

5. `Button`
   - `primary`
   - `secondary`
   - `danger`
   - `ghost`
   - `loading`

6. `Input`
   - 文本。
   - 金额。
   - 密码。
   - 错误状态。

7. `Select`
   - 普通下拉。
   - 多选筛选。

8. `Textarea`
   - 订单备注。
   - 投诉说明。
   - 审核备注。

9. `Modal`
   - 确认操作。
   - 审核操作。
   - 危险操作。

10. `Drawer`
    - 移动端筛选。
    - 订单详情。

## 业务组件

1. `CompanionCard`
   - 头像、昵称、段位、模式、价格、在线状态、语音偏好、试音入口、推荐标识。

2. `CompanionProfilePanel`
   - 陪玩详情页资料区。

3. `OrderCard`
   - 客户端和陪玩端订单摘要。

4. `OrderTimeline`
   - 订单状态日志。

5. `OrderPriceSummary`
   - 时长、单价、总价、余额提示。

6. `WalletBalanceCard`
   - 可用余额、冻结余额、可提现收益、待结算收益。

7. `TransactionList`
   - 钱包流水。

8. `RechargeUploadPanel`
   - 充值金额、截图、备注、审核说明。

9. `WithdrawalPanel`
   - 提现金额、收款信息、审核状态。

10. `ReviewActionBar`
    - 通过、拒绝、备注。

11. `BotNotificationStatus`
    - Discord/KOOK 通知成功或失败。

12. `ExternalAccountBinding`
    - Discord/KOOK 用户 ID 绑定。

13. `VoiceTrialPanel`
    - 展示语音偏好、试音说明、Discord/KOOK 语音房入口。

14. `PlatformMatchCard`
    - 客户未选陪玩时使用的平台代选入口。

## 管理后台组件

1. `DataTable`
   - 搜索、筛选、分页、行操作。

2. `StatusBadge`
   - 订单、充值、提现、陪玩状态。

3. `MetricCard`
   - 今日订单、收入、待审核数量。

4. `AuditImagePreview`
   - 充值截图查看。

5. `DangerConfirmModal`
   - 封禁、拒绝、重置密码。

6. `AdminLogDetail`
   - 操作日志详情。

## 状态组件

1. `EmptyState`
2. `LoadingState`
3. `ErrorState`
4. `Toast`
5. `InlineAlert`

## 组件设计规则

- 卡片圆角不超过 8px。
- 按钮高度移动端不低于 40px。
- 表格行高 44px 到 52px。
- 金额显示必须右对齐。
- 审核和财务操作必须二次确认。
- 组件不能包含业务金额计算逻辑。
