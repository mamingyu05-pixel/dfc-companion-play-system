# 变更记录

## 2026-06-11

- 建立 DFC Monorepo 工程基线。
- 新增 Prisma Schema，覆盖用户、陪玩、订单、钱包、充值、提现、投诉、日志和 Bot 事件。
- 新增三个门户入口：`/customer`、`/companion`、`/admin`。
- 新增 API Server 模块骨架。
- 新增 Discord Bot 接单按钮骨架。
- 新增 KOOK Bot HTTP 适配骨架，支持频道通知、私信、语音频道创建和角色授权接口。
- 将第一阶段 Bot 范围调整为 Discord 与 KOOK 同步支持。
- 新增 Discord/KOOK 外部账号绑定表。
- 新增 Bot 内部接口 Token 鉴权。
- 新增订单派单事务、双平台通知和通知失败记录。
- 新增 Discord/KOOK 接单事务防重复。
- 新增 KOOK Webhook challenge 和按钮接单回写入口。
- 新增上线运营准备纯文本说明。
- 新增 UI/UX Design Agent 分工和设计规范文档。
- 新增 UI 风格指南、页面结构图、组件清单、响应式规范、关键页面原型和流程优化文档。
- 新增共享 Tailwind 主题 preset，并接入 customer-web、companion-web、admin-web。
- 升级 Customer Portal 第一版界面，新增首页、陪玩列表、陪玩详情、充值页、下单页。
- 新增客户门户本地 UI 组件和示例数据，用于后续接入真实 API。
- 升级 Companion Portal 第一版界面，新增登录、工作台、可接订单、我的订单、收益明细、提现申请、我的资料。
- 升级 Admin Portal 第一版界面，新增登录、数据看板、用户管理、陪玩管理、添加陪玩、订单管理、派单、充值审核、提现审核、投诉处理、财务流水、操作日志。
- 新增陪玩语音展示、试音入口、平台代选下单规则和相关验收点。
- 新增 `agent_pipeline/` 多 Agent 审计工作流，包含 Agent 定义、运行脚本和报告输出。
- 新增 Docker Compose、Nginx 配置、环境样例和 CI 骨架。
- 新增项目计划、数据库、API、订单、钱包、Bot、部署、测试和已知问题文档。
