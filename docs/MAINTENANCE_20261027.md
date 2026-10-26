# 2026-10-27 本地维护与工作区清理

## 范围与状态

本轮边界：不付款、不部署、不永久删除；推送远程前先展示提交与 diff，等待用户确认。

- 当前运行版本：E:/codex专用工作区/release-20261026/dfc，6381e406。
- 本轮施工：E:/codex专用工作区/maintenance-20261027/dfc，codex/workspace-cleanup-20261027。
- 已通过 GitHub 只读接口确认 main=b1a1e971，树与 6381e406 完全相同。为便于后续审阅，本地分支用 soft reset 对齐该基线；没有重写工作文件。注意本仓库 origin 是本机整合副本，不是 GitHub，不能把推送到 origin 误报为已上传 GitHub。
- 本轮机器证据：E:/codex专用工作区/maintenance-20261027/evidence。
- 上一版验证：E:/codex专用工作区/release-optimize-20261027/dfc/final-receipt.json；其结果只证明相应源码版本。

本轮在维护候选生成了被 Git 忽略的 .env，仅含模板测试值，外部渠道保持关闭。它不包含真实 Token，也不接替已有私有运行配置。测试命令明确选用隔离库环境，不依赖这份模板的数据库地址。

## 原工程与资产保存

原 C 盘工程从 34eedd357bfc 保留到本地分支 codex/preserve-c-wip-20261027，WIP 提交 6ccd6b5bd528。32 个文件在提交前后逐项 SHA-256 一致，git status --porcelain 为空；不把 WIP 当作已验收功能，也不将旧树整体覆盖新树。

- c-original-wip-32.zip：32 项原始字节，逐项解压读取计算 SHA-256 通过。
- c-original-local-history.bundle：本机可用 Git 对象和分支；git bundle verify 输出 is okay。原仓库仍为浅克隆，不据此宣称包含远程完整历史。
- workbench/20261013-72b1981e 与原 fix 分支均停在 34eedd3，是旧提交的别名；在保存分支中已为祖先，可标记为可删除别名，本轮不删除。
- 竞品分析文档从 C 盘已提交版本按字节带入 docs/workbench/competitor-miniapp-analysis-2026-10-13.md，SHA-256 f2a4097a50ce105ac3cdc9d1779efccf6c2591473de1ea0f5fe27cd11772e8f1。已复核与用户验收是两回事，仍待业务负责人验收；文档保存不构成小程序开发授权。

## 移动归档与保留项

已将 C:/Users/mamin/Documents/Codex/2026-10-21/task-5/dfc-candidate 用 git worktree move 移动到 C:/Users/mamin/Documents/Codex/_归档/2026-10-27/dfc-candidate-merged-b21f22c。HEAD b21f22c 已是发布版本祖先，移动后 Git 工作区为空，863 个普通文件的字节和 4 个链接目标与移动前完全一致。没有永久删除，不宣称移动释放磁盘空间。

保留：

- release-20261026/dfc：当前运行的发布文件。
- C:/Users/mamin/Documents/Codex/2026-10-21/task-2/dfc-integrated：当前发布和维护 worktree 共用的 Git 对象库。
- 同目录 dfc-validation：当前发布仍引用它的 node_modules；目录名字不等于闲置副本。
- C:/Users/mamin/Documents/Codex/2026-10-01/task-11/dfc-companion-play-system：已清洁保存，且是旧演示 worktree 的 Git 主库。
- E:/codex专用工作区/陪玩演示运行：含 uploads 和尚未证明全部归并的旧版本，不能当作无用文件移动。
- 其余带 dfc 名称的工具、证据和既有归档：盘点共覆盖 42 项，不等于 42 个可删工程。逐项清单见上一轮 grok-review/checkout-inventory.json；超出深度的子目录未穷举。

## 密钥与依赖检查

使用官方 Gitleaks v8.30.1 Windows x64，下载 SHA-256 d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e，与 GitHub release digest 一致；日志与报告使用全量遮盖，不包含凭据值。

32 项旧 WIP 扫描退出 0、命中 0。两份本地历史原始扫描各命中 1 个 generic-api-key；逐一对历史代码确认是 dfc_direct_order_pending_v1 的浏览器存储键，用于 store.getItem/setItem，不是认证凭据。维护分支只为准确的提交/文件/规则/行添加误报指纹，不增加全目录忽略。扫描范围为可用本地历史。

.pnpm-store 在原工程和发布树的跟踪文件数均为 0，且被 .gitignore 排除。未清空依赖缓存，也未移动服务仍在使用的依赖。

## 复核命令与证据

- 原工程：git status --porcelain=v1，git bundle verify <bundle>；c-preservation-receipt.json、c-original-wip-manifest.json、c-original-wip-zip-verification.json。
- 归档：git merge-base --is-ancestor HEAD 6381e406；archive-candidate-before.json、archive-candidate-receipt.json。
- 候选检查：最终精确 pnpm lint / pnpm test、构建和幂等回归记录已写入 TEST_REPORT.md；不以旧日志替代新结果。
- R01 认证并发专项此前自动安全审核拒绝，本轮保持未验证，不绕过。


## 原优化清单逐项状态

| 项 | 本轮处理与证据 | 状态/边界 |
| --- | --- | --- |
| 1 | 32项原字节备份、SHA-256和本地WIP提交6ccd6b5 | 已保存，未推送 |
| 2 | 已核GitHub main真实基线；新修改分资金、命令检查、文档3组本地提交 | 具体差异见最终推送计划，待你确认 |
| 3 | 42项目录盘点；仅一个确认合入且空闲的worktree移动归档 | 共享库、依赖、uploads与既有证据保留 |
| 4 | workbench别名与旧fix分支同为34eedd3，已被保存分支包含 | 可作为旧别名清理候选，未删除；不称已整体并入新主线 |
| 5 | 维护候选已生成被忽略的测试.env | 仅样例，无真实渠道Token |
| 6 | 只读核实两本机库各37项迁移，0未完成、含微信迁移 | 复用已准备私有PG；本轮未走Docker或重装依赖 |
| 7 | 真实HTTP闭环按当前候选重跑，结果见TEST_REPORT | 合成账号/测试库，无实际付款 |
| 8 | 精确pnpm lint和pnpm test原始输出 | 最终结果见TEST_REPORT |
| 9 | 钱包事务/业务状态幂等审查；本轮修人工调账持久编号和下单锁顺序 | 业务幂等不等于所有HTTP接口都机械增加UUID；真实渠道仍未验收 |
| 10 | financial.integration中20次交错Discord/KOOK抢同单，仅1条ACCEPTED日志；另一陪玩被拒 | 复用有意义的现有回归；不是实际双平台点击验收 |
| 11 | 余额不足回滚、重复请求、20次取消退款、提现驳回恢复均在API回归 | 新增调账15项包含余额不足和丢回执重放 |
| 12 | admin-web的echo pending替换为实际作用域测试；新增调账页面/协议16项 | 确认根入口不重复执行 |
| 13 | 三端构建、临时网页与真实API浏览器检查 | 最终通过/观察范围见TEST_REPORT |
| 14 | KNOWN_ISSUES按实况重写 | 包含R01和快速程序化导航未验收观察 |
| 15 | TEST_REPORT重写为真实命令与失败→修复证据 | 不沿用2026-06-11骨架结论 |
| 16 | README区分微信/原生小程序/隔离API与网页状态 | 不新增APP/小程序/多游戏功能 |
| 17 | CHANGELOG补维护摘要；本文件附旧43次提交完整标题 | 不把旧43次误报为本轮待推送43次 |
| 18 | Gitleaks校验工具、WIP与本机历史扫描；默认密码上线前警示 | 仅精确历史误报指纹，未覆盖未下载历史 |
| 19 | 三目录.pnpm-store跟踪数0且被忽略；.env也未跟踪 | 无永久删除缓存 |
| 20 | 竞品文档已按字节保存并在README提醒 | 仍待你验收，不替你勾选通过 |

## 旧分支 43 次提交的范围

以下命令的 43 是 C 盘旧分支相对其缓存 a63c5cf 的提交数，不代表这 43 个提交从未推送，也不等于当前发布树的差异。新发布树沿另一条整合历史演进；本轮没有把旧 43 个提交整体合并。

命令：git log --format=%h\ %s a63c5cfc182e4b04ca416c96df29462d823cb01d..34eedd357bfc676ec4adf7147ee3714b130704ff

主题涵盖资金安全、通知回执隔离、派单版本/隐私、双入口下单、KOOK本地流程、演示资料、竞品分析和优化回归。完整原始提交摘要：

```text
34eedd3 workbench fix after review
b4ee310 workbench card 1: 更新竞品文档测试结果
03a9e9c workbench card 1: DFC数据库测试收尾与限定演示
c8a3886 workbench fix after review
1306293 workbench fix after review
5dcb0ec workbench card 1: 实现第7、8项功能、测试及文档
811ba51 workbench card 1: 实现优化清单第4至6项及测试、文档
d9ca5f1 workbench fix after review
e7f4c74 workbench fix after review
a8cd5e9 workbench card 2: 实现优先优化及自动测试
7ae618d workbench card 1: 竞品、小程序分析与优化清单
e8ec9e9 workbench fix after review
beb6136 workbench card 1: 制作DFC演示视频v4及配套材料
672b306 Mini-program demo page with a test session, and interactive mode for the isolated test API
2afea71 workbench fix after review
7194e3f workbench card 1: 修复取消订单后频道卡片仍可接单
e8efdc5 workbench card 1: 制作KOOK演示视频v3
42bc61c workbench card 1: 按本次接单版本更新卡片并补回归测试
583e404 workbench fix after review
d624f3b workbench card 1: 修复后台派单跳转与KOOK接单卡片文案并补测试
04c545e workbench card 1: 修正两路字幕及说明并合成v2
0ba4d09 workbench fix after review
0caee9c workbench card 1: 交付两路KOOK连续真实录屏和新成片
512b81e workbench fix after review
e808559 workbench card 1: 替换真实KOOK演示片段
97c81da workbench fix after review
4a5191f workbench card 1: 补齐操作视频与KOOK演示
9a3d288 workbench fix after review
90ee476 workbench card 2: 完整中文操作视频（本地保存）
d9a6545 workbench card 1: 全角色操作简化（仅本地、模拟KOOK）
89594bb workbench card 1: 修通KOOK卡片接单链路
03dbfc3 workbench fix after review
80c424d workbench card 1: 修正现有测试数量与既有失败清单
fdec719 workbench fix after review
c287c5e workbench card 1: 仅本地修复bootstrap启动及测试数量回归
563408b workbench card 1: 补齐双入口订单与KOOK本地闭环
eaabfd5 WIP: allow only exact loopback literal lookup in isolated TEST guard
cd51933 WIP: normalize PostgreSQL loopback identity; PG rerun pending
729250d Complete local order flows and prepare isolated miniapp validation
ac042b8 Require dispatch versions and reject stale unversioned cards
244bf62 Fix dispatch privacy and actor identity; complete paid order assignment lifecycle
f64075e fix: quarantine uncertain notifications and reconcile delivery receipts
714f2ae fix: protect financial transactions and add acceptance operations
```
