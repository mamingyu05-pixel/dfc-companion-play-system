# May猫饼电竞项目计划

## 阶段目标

May猫饼电竞定位为多游戏电竞陪玩俱乐部 SaaS 平台。当前阶段优先跑通最小商业闭环：

1. 管理员创建陪玩账号并选择支持游戏。
2. 管理员审核并上架陪玩。
3. 客户注册登录。
4. 客户提交人工充值申请。
5. 管理员审核充值，客户余额增加。
6. 客户选择游戏并下单，可指定陪玩，也可选择平台人工挑人。
7. 管理员派单，Discord 和 KOOK 同步通知。
8. 陪玩接单，订单开始。
9. 订单完成，后端计算平台抽成和陪玩收益。
10. 陪玩申请提现，管理员审核并人工打款。

闭环未稳定前，不开发 APP、小程序、自动支付、自动提现。

## 支持游戏

平台支持多款热门游戏，首批包括：

- 三角洲行动
- 英雄联盟
- 无畏契约
- CS2
- PUBG 绝地求生
- PUBG Mobile
- Apex 英雄
- 永劫无间
- 王者荣耀
- 和平精英
- Dota 2
- 守望先锋 2
- 彩虹六号：围攻
- 火箭联盟
- EA Sports FC
- 街头霸王 6
- 使命召唤
- 英雄联盟手游
- Mobile Legends
- 我的世界
- 原神

## 市场与 Bot 策略

- 国内运营优先保证 KOOK 可用。
- 加拿大和海外市场同步保证 Discord 可用。
- Discord 和 KOOK 负责通知、按钮接单、私信、语音房和角色同步。
- 订单、钱包、结算、权限逻辑只在 API Server 实现，Bot 不复制业务逻辑。

## Agent 分工

- Project Manager Agent：任务拆分、架构审核、业务审核、集成测试。
- Database Agent：Prisma、Migration、Seed、Schema。
- Customer Agent：客户门户。
- Companion Agent：陪玩端。
- Admin Agent：管理后台。
- Order Agent：订单系统。
- Wallet Agent：钱包系统。
- Discord Agent：Discord Bot。
- KOOK Agent：KOOK Bot 与适配层。
- UI/UX Design Agent：视觉风格、三端 UI、响应式体验、组件规范。
- DevOps Agent：Docker、HTTPS、备份、监控、日志、回滚、零停机。
- QA Agent：自动化测试、安全测试、权限测试、业务闭环测试。

## 验收原则

- 金额只由后端计算。
- 钱包变动必须写入 `wallet_transactions`。
- 订单状态变更必须写入 `order_status_logs`。
- 管理员动作必须写入 `admin_logs`。
- Bot 事件必须写入 `bot_events` 并记录平台。
- 关键业务写操作必须使用数据库事务。
- 双平台同时接单时，后端只能允许一次成功。
- 失败必须回滚，不允许半完成资金状态。
