> 2026-10-27更新：当前新增本地施工分支 codex/workspace-cleanup-20261027，目录 E:/codex专用工作区/maintenance-20261027/dfc；本轮未推送、未部署。旧 C 盘 WIP 已保存在 6ccd6b5，具体入口/归档原因见 [本轮维护说明](MAINTENANCE_20261027.md)。下文为此前版本的验收范围，不能据此认定新修改已经发布。

# 当前工程与验收索引

核对日期：2026-10-27，Asia/Hong_Kong。最新修复见 [审查问题修复](BUSINESS_OPTIMIZATION_20261027.md)，对应最终测试、提交与部署状态记录在 `E:/codex专用工作区/release-optimize-20261027/dfc/final-receipt.json`。此前发布回执继续保留作历史。公网服务器、真实渠道和资金流程仍分别列为未验证。

最新业务优化见 [业务闭环修复与验证](BUSINESS_FOCUS_20261026.md)：修复保底/套餐防重恢复、报名确认状态、分段推荐结算、旧活动单可见性、充值汇总、陪玩动作核对、财务未知态、历史回执及双身份提现入口。纯回归 332/332，独立真实 HTTP 闭环 82/82（真实 KOOK 另跳过 1 项）；三角色浏览器流程及 51 项数据库对账通过。最终 API 计数、源码树与 GitHub 主线 SHA 以 `E:\codex专用工作区\release-focus-20261026\dfc\final-receipt.json` 为准。以下部署回执和 266/283 数字属于本机部署上一轮，保留作历史，不覆盖本轮验证。

## 当前发布工程

| 用途 | 路径及范围 |
| --- | --- |
| 本次唯一发布工作区 | `E:\codex专用工作区\release-20261026\dfc`，分支 `codex/local-release-20261026`；从 `b21f22c6138d23bf4698f0ea66cc8539e2d66bfe` 接续 |
| 独立本机运行目录 | `E:\dfc-runtime-20261026`，包含独立 PostgreSQL 数据、生成客户端、构建/测试日志、进程记录与本机私有配置 |
| 本次最终发布回执 | `E:\codex专用工作区\release-20261026\dfc-release-receipt.json`，记录最终本机提交、GitHub 主线及 tree 对照、URL、响应和未验证项 |
| 原维护候选 | `C:\Users\mamin\Documents\Codex\2026-10-21\task-5\dfc-candidate`，本次不在这里施工 |
| 原 App 登记目录 | `C:\Users\mamin\Documents\Codex\2026-10-01\task-11\dfc-companion-play-system`，原有 22 项 tracked 未提交改动保留 |

发布前 GitHub `main` 为 `bb094e470087571da1d89a965f8d61be204baba2`。本次发布回执区分本机 release 提交与通过现有 GitHub 连接器创建的主线提交，并核对两者完整 tree；不将本地 `origin` 当作 GitHub 同步证据。最终 SHA 以该回执及实际 `git log -1` 为准。

## 上一轮本机部署已验证

| 层级 | 证据与结论 |
| --- | --- |
| 数据库 | Windows PostgreSQL 16.14，独立 `127.0.0.1:15433`；当前全部 37 个迁移成功，实际查询本机管理员存在 |
| API 与三端构建 | API webpack 成功；客户、陪玩、后台均完成 Next 15.5.19 生产构建，单 worker 串行执行 |
| 当前 API 集成回归 | 专用 `dfc_synthetic` PostgreSQL，`33 passed, 33 total` 测试组，`266 passed, 266 total` 测试；详见运行目录 `jest-results.json`、`jest.log` |
| 纯回归及网关 | `283 tests / 283 pass / 0 fail`；包括真实临时 HTTP 网关测试、环境隔离与三端业务合成检查，详见 `pure-regression.log` |
| HTTP 与数据库登录 | `SMOKE_PASS checks=16`；三端页面及资源 200，管理员登录 201，带令牌 `/api/auth/me` 200，无令牌 401；详见 `smoke-results.json` |
| 浏览器呈现 | 实际打开客户、陪玩、后台登录页；截图 `browser-customer.png`、`browser-companion.png`、`browser-admin.png` 保存于运行目录 |

扩展纯回归最初出现 22 个失败，原始输出保存在 `pure-regression-before-fixture-alignment.log`。原因分别是测试对 React 辅助模块、标签页/刷新按钮、会员定价方法及微信会话版本的旧夹具不完整；本次更新了测试夹具，保留原确认、防重扣、事务内读取和身份保护断言，另增 3 项会员价格/会话撤销回归。没有据此修改生产财务或身份业务。

## 本机入口

访问同源网关，部署及重启步骤见 [Windows 本机部署](LOCAL_WINDOWS_DEPLOYMENT.md)。

| 入口 | 地址 |
| --- | --- |
| 门户 | `http://127.0.0.1:18080/` |
| 客户 | `http://127.0.0.1:18080/customer/` |
| 陪玩 | `http://127.0.0.1:18080/companion/` |
| 后台 | `http://127.0.0.1:18080/admin/` |
| API 存活/配置诊断 | `http://127.0.0.1:18080/api/health` |

API、三个 Next 服务、网关与数据库均只监听回环地址。没有修改开机启动、用户软件或 Docker/WSL 状态；重启电脑后需按上述部署文档恢复本机进程。

`health` 继续返回 `processAlive=true`、`productionReady=false`。本机可访问、集成测试和浏览器登录页并不证明真实支付、KOOK/Discord 通知、微信、人工付款/提现、真实客户全流程或公网服务器发布成功。这些均未在本次连接或操作。

## 历史验收保留

2026-10-21 独立回执：

`C:\Users\mamin\Documents\Codex\2026-10-21\task-5\dfc-jest-tools\INDEPENDENT-RUN-6c1c0095-FINAL-ACCEPTANCE.json`

该回执为 `191/191`，绑定 `4b23948fcd19dd5aa37f2b611cb708e6c0545c90`，明确 `realKook=false`、`realPayment=false`、`productionAccess=false`。它继续作为旧提交的有效证据，不用于覆盖本次最新源码验证。

原生小程序和隔离入口仍按 [既有隔离验证文档](../scripts/isolated-test-api/README.md) 保留；本次未运行微信 IDE、真机、小程序交互时段或修改其边界。
