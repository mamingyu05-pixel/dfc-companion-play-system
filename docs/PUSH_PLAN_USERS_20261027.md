# 用户页优化推送前清单（2026-10-27）

本轮代码已写好并本地提交，未推送、未部署。此清单用于落实用户要求“推送远程前先给我看要推什么，我确认后再推”。上一轮确认的资金/维护版本7412eaf已发布；本轮新变更不混作那次发布。

## 要推的内容

基线：本地7412eaf4aafaf59328a67e58200b3e3638e6d42e，对应GitHub发布分支codex/workspace-cleanup-20261027的0c86eb74061019ed609aef6380acb7ffa770a8ce，原文件树9048c0288f59227760071e115bfae79b59a18db5一致。

1. `perf(admin): paginate user directory and bound account searches`，本地1f3b5e27d35d4f614d01e25f22b51946fa050f69：8个源码/测试文件。用户表50条、四候选25条，全库搜索、全局统计、翻页清批选、旧响应拦截，并保留原调账请求。该提交文件树231362dd4a58c9fe68d01c003717ea1cddc953f8。
2. `docs: record user pagination verification and backup restore drill`：README及9个文档，补齐此次证据、恢复演练、当前运行源、历史版本区分和本清单。最终两个提交号、文件列表、完整patch与文件树记录在工程旁evidence/push-review-receipt.json和users-optimization-review.patch。

源码8项：

```text
apps/admin-web/app/users/page.tsx
apps/admin-web/app/users/user-directory-client.ts
apps/admin-web/test/helpers/users-page.cjs
apps/admin-web/test/manual-adjustment.test.cjs
apps/admin-web/test/user-directory.test.cjs
apps/api-server/src/modules/admin/admin.controller.ts
apps/api-server/src/modules/admin/admin-user-directory.ts
apps/api-server/test/admin-user-directory.integration.spec.ts
```

数据库Schema/迁移、资金写服务、认证实现、依赖及lockfile均无本轮变更。不会推送.env、运行数据、测试账号、node_modules、构建目录或私有evidence。

## 已有验证

- 完整pnpm test：API42套376项、业务33文件390项通过，失败/跳过0；pnpm lint：6工作包失败0。
- 新目录后端37项、页面/读取器及原调账27项通过；这两组已包含在完整测试中，不重复相加。
- 真实Edge+候选构建+测试PG完整脚本首次PASS、exit0：8132既有账号下表格50行、四菜单25条；跨页无交集、清批选、搜索不改调账目标，已提交后注入500再刷新重试仍一笔流水。3自建夹具及关联数据剩余0。
- API、admin-web、customer-web、companion-web四应用候选构建全部exit0；构建未改写源码和现用构建。客户构建耗时约8分17秒，诊断及完整日志保留，没有中断或重跑。
- 冷备独立恢复2662文件、钱包/流水/37迁移指纹一致，演练PG已停止。临时网页/API端口已关闭，现用源码和四构建指纹未变、三个网页/API仍200。
- 最终静态交叉审查未发现本轮新增阻断。密钥扫描范围与原始日志见最终扫描回执，浅克隆只覆盖本机已有历史。

## 确认后的执行顺序

用户确认这份差异后，先只读核对GitHub目标分支仍是上述基线，再将这两次提交的文件树追加到现有发布分支codex/workspace-cleanup-20261027，不改main、不强推。使用GitHub连接器并逐树核对；本机origin是C盘镜像，不能把推到origin称为GitHub发布。连接器生成的提交号可能不同，文件树必须与本地完全一致。

随后部署到现有Windows本机入口18080：先核对新构建和私有数据库备份/回滚路径，再切换到本候选源码，检查实际进程路径、三端页面版本及业务冒烟；出错按封存版本回滚，保留旧源码、构建和备份。部署前不会把新候选写进现用构建，也不会安装系统开机项或改变防火墙。

这份计划是现有Windows本机更新。公网HTTPS、目标Linux/Docker运行、真实Discord/KOOK/SMTP/微信与真机仍未验收；health中的productionReady=false保留。R01此前被自动安全审核拒绝，未在本轮重试/绕过。付款、永久删除文件、新APP/小程序/多游戏或自动支付提现均不在本次变更中。

## 工作区收尾

原C盘32项旧改动的WIP和逐文件备份继续保留；已运行maintenance目录保持干净。新候选以两个本地提交收口，工作区无未提交文件；部署前保留新候选、四应用构建和隔离依赖，以便审查或切换。演练副本已停止，作为私有可恢复备份保留，没有永久删除任何工程文件。
