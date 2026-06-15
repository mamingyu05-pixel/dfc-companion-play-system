# 变更记录

## 2026-06-15

- 陪玩邀请码新增持续推广分成：客户通过陪玩邀请码绑定后，每次订单完成都会按 `COMPANION_REFERRAL_COMMISSION_RATE` 给邀请陪玩结算收益，默认 1%。
- 新增 Discord 客户会员等级角色同步，充值审核通过和订单完成后会同时尝试同步 KOOK / Discord 的客户等级、未下单客户和高等级专属身份。
- Discord 初始化脚本新增客户等级角色输出，`.env.example` 和 `.env.production.example` 补齐 `DISCORD_CUSTOMER_*` 变量。
- KOOK 派单报名按钮改为提示陪玩填写报名信息，避免空报名；真实报名以 `报名 TRY编号 段位/报价/时间/性格/试音` 文本写入后台候选列表。
- 管理端客服派单台新增“标记流单”操作，长时间无人报名或客户未继续确认时可人工关闭草稿并记录管理日志。
- 新增 Discord / KOOK AI 派单频道配置，优先把 AI 整理后的客户需求发送到独立派单频道。
- 新增游戏组和声线组角色配置，AI 派单会自动 @ 对应游戏标签陪玩。
- 新增 `月影声线`、`曜刃声线` 两个非直白声线分类，用于替代简单男女标签。
- 管理端添加陪玩页面新增声线标签字段。
- 新增 `docs/AI_DISPATCH_TAGS.md`，记录频道、角色、环境变量和运营步骤。
- 陪玩报名支持自由填写段位、报价、性格、服务优势和试音状态；Discord 支持按钮弹窗，KOOK / Discord 派单频道支持文字报名格式。

## 2026-06-11

- 建立 DFC Monorepo 工程基线。
- 新增 Prisma Schema，覆盖用户、陪玩、订单、钱包、充值、提现、投诉、日志和 Bot 事件。
- 新增三个门户入口：`/customer`、`/companion`、`/admin`。
- 品牌改为 May猫饼电竞，扩展为多热门游戏陪玩平台，并新增 `GameCode` 扩展迁移。
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
- 根据 Claude 审核报告新增 `docs/CLAUDE_REVIEW_RESPONSE.md`。
- 新增 API JWT 登录、客户注册、当前用户注入、RBAC 角色守卫。
- 管理员接口 `/api/admin/*` 接入 `ADMIN` / `SUPER_ADMIN` 权限保护。
- 客户下单接口接入真实余额扣减事务，支持指定陪玩和平台人工匹配单价配置。
- 新增充值申请、充值审核入账、提现申请冻结、提现审核/打款确认事务。
- 新增订单开始和订单完成结算事务，完成后增加陪玩可提现收益。
- 派单和 Bot 接单增加陪玩资料 `LISTED` 状态校验。
- Prisma Schema 新增 `Wallet.frozenIncome`，用于提现冻结。
- 新增初始 Prisma migration SQL。
- 环境样例新增 `PLATFORM_MATCH_UNIT_PRICE` 和 `KOOK_ENCRYPT_KEY`。
- 根据 Claude 第二次复审，订单下单改为客户余额冻结：`availableBalance -> frozenBalance`。
- 订单完成结算时扣减客户 `frozenBalance`，再增加陪玩 `availableIncome`。
- `RolesGuard` 增加 `SUPER_ADMIN` 继承 `ADMIN` 权限。
- 陪玩登录时拒绝 `CompanionProfile.status = BANNED`。
- 新增 `ORDER_MAX_HOURS` 配置并限制单次下单时长。
- 客户注册新增真实邮箱验证码步骤，新增 `email_verification_codes` 表和 SMTP 配置项。
- 客户注册、后台创建管理员/陪玩账号统一邮箱规范化和重复邮箱拦截。
- 新增 `users.displayNameKey` 和同角色昵称唯一约束，防止客户用户名重复。
