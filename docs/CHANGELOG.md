# 变更记录

## 2026-10-23

- RAG 知识库 AI 客服：
  - 新表 `support_knowledge`（迁移 `20261023090000_support_knowledge`，预置 11 条按系统真实规则写的说明：资金托管、保底护航、封号风险、下单、价格、充值、退款投诉、试音、陪玩入驻、自动验收、KOOK/Discord）。
  - 检索用中文二字词与关键词加权，不依赖向量库或额外 API；保底护航当前档位价格从价格表实时生成，不会报旧价。
  - 配置了模型时，模型只依据检索到的资料改写回答，资料不足时回答需要人工确认；未配置模型或模型失败时直接返回最匹配的条目原文。退款、充值、提现、投诉仍先转人工，不经过知识库。
  - 「X 怎么用」不再被通用的「客服能力」回复截走。
  - 后台「配置 → AI 客服知识库」可新增、编辑、停用条目（`GET/POST/PATCH /api/admin/support-knowledge`），保存后立即生效并写操作日志。
- 新增 `scripts/set-secret.sh`：在服务器上以不回显的方式把 Token / API Key 写入 `.env`。

- 深度检查修复：
  - 修复订单凭证上传在生产会被 100KB 默认请求体限制拒绝（413）的问题：`POST /api/orders/:id/evidence` 与充值申请共用 2MiB 图片的有界解析器，超限返回中文 413；补真实 HTTP 测试。
  - 充值审核列表和订单凭证列表不再返回整张 data URL 图片，改为标记「有图」，图片按需单独读取（`GET /api/admin/recharges/:id/screenshot`、`GET /api/orders/:id/evidence/:evidenceId/image`）并在页面内直接显示（浏览器会拦截新标签打开 data URL）。
  - 充值审核列表改为全部待审核（最多 500）+ 最近 200 条已处理；客户、陪玩「我的订单」返回最近 200 单。
  - 去掉 `orders.sourceDraftId` 重复的普通索引声明（已有唯一索引），迁移与 schema 比对归零。
  - `docs/KNOWN_ISSUES.md` 按当前实际状态重写。

- 后台操作简化：
  - 导航从 17 个平铺入口改为 5 组（今日处理 / 订单 / 人员 / 价格与优惠 / 数据与记录），当前页高亮；草稿台、派单、充值审核、提现审核、投诉与争议显示待办数量角标（新接口 `GET /api/admin/pending-counts`，只做计数；读取失败时不显示角标，不显示成 0）。
  - 新增「价格设置」页 `/admin/pricing/`：小时陪玩段位价（从「优惠」页移出）和保底护航档位集中在一页，并指向陪玩页的个人价和优惠页的充值赠送；原 `/admin/guarantee-packages/` 页并入。
  - 看板的今日订单、待充值、待提现、未结投诉卡片可直接点进对应处理页。
- 陪玩端保底单在接单和服务中显示「先传开局 / 结束仓库截图、净增达标才能完成」的提示。

- 新增三角洲「保底护航」：按仓库净增结果收费，复用冻结 → 待验收 → 结算流程。
  - 迁移 `20261022090000_guarantee_escort`：`orders` 增加 `serviceKind / guaranteePlatform / guaranteeTargetWan`（下单时快照，后续改价不影响）；新表 `guarantee_packages`（端游 400/688/1288W ¥79/128/198，手游 ¥49/88/148，参照 2026-10-22 公开报价，后台可改）和 `order_evidence`。部署前需 `prisma migrate deploy`。
  - 接口：`GET /api/orders/guarantee-packages`、`POST /api/orders/guarantee/preview`、`POST /api/orders/guarantee`（requestId 幂等、`expectedTotalAmount` 防变价）、`GET|POST /api/orders/:id/evidence`（仅本单客户、陪玩或管理员）、`GET|PATCH /api/admin/guarantee-packages`（改价写操作日志）。
  - 结算门槛：保底单报完成前必须有开局、结束仓库截图，且「最早开局值 → 最新结束值」净增达到档位，否则拒绝报完成；不受小时时长限制。未达标走现有争议裁决，可全额或部分退回站内余额。
  - 凭证：仓库截图只能在接单后、报完成前上传；录屏链接和其他截图可在验收和争议期间补充；每单最多 30 条，图片沿用充值凭证的格式与 2MiB 校验。
  - 前端：客户端新增 `/guarantee` 下单页（护航规则写明不交号、不转移物资、不代充、不承诺零封号），首页和下单页有入口；「我的订单」和陪玩端订单增加凭证与净增进度面板；后台新增「保底档位」改价 / 上下架页，「经营与绩效」原单详情显示凭证。

- 客户端新增「再来一单」：「我的订单」中已完成且有陪玩的订单显示入口，跳转 `/order?companionId=&mode=&hours=`；只带合法的模式（烽火地带 / 全面战场）和整数时长 1–4，其余忽略。下单页仍需客户点「核对订单金额」取服务端报价，再确认冻结，不会自动提交。
- 下单页链接参数支持 `mode`、`hours`：非法值忽略并提示；陪玩暂不可下单时保留已带入的模式和时长并提示另选。
- 客户端新增资金托管展示：`@dfc/ui` 的 `orderEscrowView` 只根据订单自身状态与 `refundAmount` 推导资金阶段（托管中 / 争议冻结 / 已结算 / 部分退回 / 已退回站内余额），未知状态显示“待核对”。
- 「我的订单」每张订单卡新增资金进度条和资金去向说明；页面顶部、下单核对区和陪玩详情页新增“平台托管，验收后才付给陪玩”说明。陪玩详情页原“客服后台扣费”说法改为托管说明，与自助下单冻结余额流程一致。
- `GET /api/orders/my` 返回 `refundAmount`，用于显示部分退回金额。

- 新增只读接口 `GET /api/admin/analytics/customers` 与 `GET /api/admin/analytics/companions`（ADMIN / SUPER_ADMIN），参数与 `/api/admin/operations` 一致：`from`、`to`（UTC，结束不含，最长 366 天，默认近 30 天）、`store`、`game`、`tier`。
- 客户看板：新增客户、首充 / 首单转化、下单客户、期内复购、回头客、下单额（扣退款）、客单价、充值本金与赠送、客户余额快照、价档 / 模式对比、消费 TOP 10、每日趋势。
- 陪玩看板：上架 / 在线 / 忙碌、期内接单陪玩、完成时长、陪玩收入与平台佣金、下单到接单中位数 / P90、投诉订单率、评分、提现申请 / 打款 / 待处理、期内入驻状态、陪玩 TOP 10、每日趋势。
- 管理端新增「客户/陪玩数据」页面 `/admin/analytics/`；比率同时返回分子分母，无样本时为空而非 0%。看板不替代「经营与绩效」的财务确认收入和冻结对账。

## 2026-06-15

- 升级多角色陪玩能力模型：`users.role` 继续表示主权限，陪玩身份改为通过 `companionProfile` 叠加；客户、ADMIN、SUPER_ADMIN 都可以由后台开通陪玩资料并进入陪玩端接单、查看收益和申请提现。
- 管理端“客户转为陪玩”入口升级为“给现有账号开通陪玩身份”，不再把管理员或客户硬改成 `COMPANION` 主角色，避免后台权限、历史订单、钱包和平台绑定丢失。
- 订单、AI 派单草稿报名、钱包提现、陪玩平台账号绑定统一改为校验“ACTIVE 用户 + 可用陪玩资料”，兼容管理员前期兼职陪玩。

- 管理端用户管理新增“客户转为陪玩”：已注册 ACTIVE 客户可保留原账号、钱包、平台绑定和历史记录，转为待审核陪玩后再人工上架。
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
# 2026-06-17

- Added GitHub Actions security workflow with Gitleaks secret scanning and Trivy vulnerability reporting.
- Added Dependabot weekly checks for npm/pnpm workspace dependencies and GitHub Actions.
- Added `/api/health` endpoint for uptime monitoring and deployment smoke checks.
- Added `scripts/smoke-production.sh` for post-deploy checks against `/api/health`, `/customer/`, `/admin/`, and `/companion/`.
- Fixed Trivy GitHub Action reference to the current `v0.36.0` tag.
