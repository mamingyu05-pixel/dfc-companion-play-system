# 当前工程与验收索引

更新于2026-10-27，香港时间。源码完成、已提交、已推送、本机部署与真实平台验收分别记录；最新运行状态以私有运行目录的active-release.json和实际进程/HTTP核对为准。

## 当前已发布版本

| 用途 | 当前值 |
| --- | --- |
| 正在运行的源码 | E:/codex专用工作区/maintenance-20261027/dfc |
| 本地提交 | 7412eaf4aafaf59328a67e58200b3e3638e6d42e |
| GitHub发布分支 | codex/workspace-cleanup-20261027，远程0c86eb74061019ed609aef6380acb7ffa770a8ce |
| 完整文件树 | 9048c0288f59227760071e115bfae79b59a18db5；本地/远程一致 |
| 私有运行数据 | E:/dfc-runtime-20261026；PostgreSQL15433、网关18080 |
| 发布回执 | E:/codex专用工作区/deploy-20261027/dfc/final-release-receipt.json |
| 发布过程说明 | E:/codex专用工作区/deploy-20261027/dfc/发布回执-20261027.md |

发布后16项检查通过，隔离库真实HTTP流程82通过/0失败/1真实KOOK跳过；独立复核确认五进程端口与源码一致、三个网页包含相应BUILD_ID、钱包/流水/迁移指纹不变。API339项、业务379项是该版本本地回归结果。上述是本机部署，未合并GitHub main，不代表公网和真实渠道验收。

## 当前施工版本

用户页分页、有限候选搜索与数据量验收在独立副本E:/codex专用工作区/optimization-users-20261027/dfc施工，分支codex/admin-user-pagination-20261027，基线7412eaf。本轮没有覆盖正在使用的构建、依赖别名和数据库目录。新增变更的命令、数量、差异和发布状态见[本轮优化记录](OPTIMIZATION_USERS_20261027.md)与该目录旁evidence。

## 已保存和保留的工程

- C:/Users/mamin/Documents/Codex/2026-10-01/task-11/dfc-companion-play-system：32项旧改动原样保存在本地WIP6ccd6b5，zip逐文件SHA和Git bundle均验证；同时承载旧演示worktree的Git主库。
- E:/codex专用工作区/release-20261026/dfc：上一运行版本6381e406及构建保留，可作代码回滚依据。
- C:/Users/mamin/Documents/Codex/_归档/2026-10-27/dfc-candidate-merged-b21f22c：已合入的闲置worktree已移动，863个文件和4个链接核对一致，没有永久删除。
- dfc-integrated、dfc-validation、本机origin镜像及含uploads的旧演示目录均有Git/依赖/数据用途，保留理由见[维护记录](MAINTENANCE_20261027.md)。origin是C盘本地镜像，不能据此声称已同步GitHub。

## 数据库与备份

当前Windows专用PostgreSQL16.14，共37个已完成迁移，含微信身份迁移。冷备2662文件共139035841字节，逐项哈希一致。本轮已在独立私有副本、15434端口完成启动与只读恢复演练，钱包、流水和37项迁移与封存基准一致，随后停止演练进程。原库15433未被恢复覆盖。证据：E:/codex专用工作区/optimization-users-20261027/evidence/restore-drill-receipt.json。持续自动备份与异盘保管仍需另验，不因一次演练通过便算全部备份方案验收。

## 本机入口

[门户](http://127.0.0.1:18080/) · [客户](http://127.0.0.1:18080/customer/) · [陪玩](http://127.0.0.1:18080/companion/) · [后台](http://127.0.0.1:18080/admin/)。部署和启动方式见[Windows说明](LOCAL_WINDOWS_DEPLOYMENT.md)。

health的processAlive=true表示进程可访问；productionReady=false保留，真实KOOK/Discord/SMTP/微信配置仍未验收。自动支付、自动提现、APP/新增小程序/多游戏不属于第一阶段补开发要求。R01认证并发与快速导航观察仍保留，未绕过此前自动安全审核阻断。

## 历史证据

旧的191/191、266/283、323/356等回执继续保留，但只证明它们绑定的提交；不要用旧视频、旧dist、旧端口/PID或另一提交的测试结果替代本轮验证。已有小程序和隔离TEST API资产不代表真机或完整小程序商业功能已上线。
