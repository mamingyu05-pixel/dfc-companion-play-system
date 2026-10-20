# 独立 QA 缺陷修复与复核交接

基线：`f64075efdc2f45d4cfc4cbf1e06ac61a7fce0bf0`，分支 `fix/financial-integrity-and-operations`。针对 task-14 的 `qa/INDEPENDENT-QA-REPORT.md` 和 `qa/evidence/manifest.json`，仅修改 task-11 隔离副本；不修改独立 QA 脚本或断言，不推送、不部署、不访问真实 Bot / 钱包 / 生产数据库。

## 已处理的问题

| 独立 QA 项 | 本次行为 |
|---|---|
| P1-01 默认代接并开始 | 删除后台自动开始选项和强制代接服务；旧请求携带 `autoStart:true` 也只派单并返回 `autoStarted:false`。本人接单后为 ACCEPTED，另行开始才写 startedAt |
| P1-02 KOOK 身份字段 | `message_btn_click` 唯一采用 `extra.body.user_id`，消息与频道也取按钮事件的 body；缺少点击人不回退顶层作者。绑定使用平台 ID，不按昵称 |
| P1-03 原始需求隐私 | 招募卡片、选人/流单通知和陪玩招募列表使用结构化服务类别，去除原始需求、私人备注、客户联系方式。公开可接订单列表只返回明确列出的必要字段；客服原始记录保留 |
| P1-04 佣金漂移 | 付款建单时锁定 commissionRateSnapshot；派单、改派、Web / KOOK / Discord 接单均不覆盖。不新增本单改价动作 |
| P1-05 资格与占用 | 接单事务锁订单及陪玩账号/资料，复查 ACTIVE、LISTED、游戏资格、BUSY 和其他 ACCEPTED / IN_PROGRESS 订单。履约中争议亦保留占用；不同订单竞争同一陪玩只允许一个接受 |
| P1-06 双模式缺口 | 原订单 PAID / ASSIGNED 可显式指定或开放，指定本人可填写原因拒接；显式接单期限到期退回 PAID 客服待办。所有转换保留原单 ID、已冻结金额、佣金快照及操作者/原因 |
| P2-01 空指定人 | 缺失、null、空字符串拒绝为 400；OPEN 是明确的分配模式，不用 null 偷换业务含义 |

OFFLINE 在现有模型中是在线状态，未引入“离线自动取消服务资格”的新政策；明确 BUSY 会被拒绝。当前容量按一人一笔已接受或履约中的订单保护。未建立未来预约重叠计算、固定排班、按局服务或多人容量规则。

## 操作入口与状态

- 后台 `/dispatch`：选择原订单、DIRECT / OPEN、必填原因，可选接单截止时间（按浏览器本地时区转换到 UTC）。接受前可改派或切换方式。旧 `/assign` 保留仅 PAID → 指定待接的兼容行为。
- `PATCH /api/admin/orders/:id/dispatch`：`{mode:"DIRECT"|"OPEN", companionId?, reason, acceptanceDeadline?}`。OPEN 不带 companionId。相同待接分配和期限重投复用版本，不重发新一轮通知、不再记派单日志。
- `PATCH /api/orders/:id/decline`：仅当前被指定人、仅 ASSIGNED、必填 reason。陪玩端“我的进行中订单”提供原因输入和退回按钮。
- `POST /api/admin/orders/expire-assignments`：管理员将已到期单退回客服；页面有对应刷新按钮。持久 `ORDER_ACCEPTANCE_TIMEOUT` 任务也按指定期限处理。期限留空就不设期限，没有默认分钟数。
- 过期接受在同一事务提交退回后返回 400。旧期限任务带分配版本，不能退回后续新分配；已接受单不能通过此派单接口改派。
- 新通知按钮带分配版本；旧轮按钮不能接受新轮分配。Web、KOOK、Discord 共用接受逻辑。每轮通知有独立业务键，旧已知回执卡片去除动作。
- 每次分配都记录前一方式/陪玩、新方式/陪玩、原因、版本、期限和操作者。拒接、超时记录状态日志，回待办不重新冻结、不复制订单、不增加支付流水。

## 通知与运行约束

`DFC_BACKGROUND_JOBS_ENABLED` 原默认值仍为关闭。自动到期处理、持久通知恢复和异步卡片更新依赖工作进程开启；关闭时可由客服显式处理已到期单，接单入口仍会阻止超时接受并退回待办。

新派单通知沿用持久发送凭据，关联 `order-dispatch:<订单>:<版本>` 任务。平台结果 UNKNOWN 停止自动发送，由原通知核对台使用回执和依据确认；相同派单请求重投不能绕过 UNKNOWN。管理员确认已发送后任务转 RECONCILED，不重复派单、扣款或创建通知。

本次没有读取或改写历史生产消息。旧部署保存的待发正文或 UNKNOWN 记录可能含旧格式私人内容，需有权限的运营人员在真实环境核对后再决定后续操作；本地代码修复不代表已清理生产历史数据。

## 合成验证

- 新增 `apps/api-server/test/dispatch-workflow.integration.spec.ts`，16 项。最初 7 项在修改前全部失败，证据为同级 `dfc-test-tools/dispatch-before-fixes.log`；没有改掉这些期望来通过。
- 原有 6 个测试文件的 35 项保持不变，完整执行合计 **51/51 通过**。新用例覆盖真实 loopback HTTP、真实独立 PostgreSQL、身份冲突/缺失、私密标记、最终 80/20 结算、双模式同单转换、拒接、期限与旧期限任务、旧按钮版本、双人同单和单人两单竞争、权限、UNKNOWN 人工核对与派单重投。
- 模拟平台发送，全部外部 fetch 为 stub；实例仅监听随机 loopback 端口，白名单子进程环境和合成数据库凭据，不读取 `.env`。Jest `--runInBand`，仅少量明确的双请求互斥测试；旧测试自身原有并发断言保留。
- 新增迁移 `202610010006_dispatch_lifecycle`，仅两列及到期查询索引，合成库运行全部 26 个迁移。
- 最终提交 SHA、该 SHA 的完整测试/类型检查/构建日志和清理证据写入同级 `dfc-test-tools/final-dispatch-verification.json`，避免在提交内部声称尚未发生的最终验证。

## 独立复测需要注意的测试夹具

独立 QA 文件与 manifest 均保持原样，不能宣称该独立套件已全绿。本次由实现者增加的测试不替代独立验收。

1. `focus.spec.js` 第一项在派单后先调用本人接受，再断言最终状态为 ASSIGNED。修复后本人接受应成功且最终为 ACCEPTED；应由 QA 作者把“派单后 ASSIGNED”和“本人接受后 ACCEPTED、未开始计时”分别核对，不能为旧断言让合法接单失败。
2. `independent.spec.js` 多项共用同一陪玩，beforeEach 仅清通知和队列，不释放前项留下的 ACCEPTED / IN_PROGRESS。新占用保护会有意阻止此类后续接单；独立复测应隔离每项人员/订单或完成前项服务，保留占用拒绝断言。
3. 新分配动作增加 `ORDER_DISPATCH` 任务，按钮新增分配版本。回调测试应消费到目标 KOOK 事件并使用实际新卡片值，不能假定单次 `processOne` 总是消费目标事件。旧 `/assign` 的重复改派探针仍返回 400；双模式需用新增 `/dispatch` 验证。

未测边界：真实浏览器逐屏点击、真实 KOOK 权限及平台回调、生产部署/迁移、真实资金对账。没有开展压力测试、朋友公会联调或新增按局/预约政策。

KOOK 字段依据：[官方用户事件文档的 message_btn_click](https://developer.kookapp.cn/doc/event/user)。这是接口契约核对，不冒充真实公会抓包。
