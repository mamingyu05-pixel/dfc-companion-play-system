# 测试报告

日期：2026-10-27。本轮用户页优化目录为E:/codex专用工作区/optimization-users-20261027/dfc，基线7412eaf。正在使用的本机版本为maintenance-20261027/dfc的7412eaf，GitHub对应0c86eb7；下列新增分页代码尚未推送、未部署。现用版本的发布回执与本轮新证据分开记录。

## 用户页优化的本轮验证

| 检查 | 当前结果 | 本轮原始证据 |
| --- | --- | --- |
| 完整pnpm test | API 42套、376项通过；业务33文件、390项通过，失败/跳过均0，exit0 | pnpm-test-final.log、full-verification.json |
| 完整pnpm lint | TypeScript类型检查，6个工作包、失败0，exit0 | pnpm-lint-final.log |
| 四应用候选构建 | API、admin-web、customer-web、companion-web分别exit0，构建未改写源码；均在隔离候选，不覆盖现用构建 | api-build-results.json、admin-build-results.json、other-web-build-results.json与各build日志 |
| 数据库目录/候选专项 | 修前35失败/1通过；最终37/37通过，含210字符完整邮箱、特殊字符、分页、全局统计和候选资格 | admin-directory-red.log、admin-directory-green.log/json |
| 页面/读取器与原调账专项 | 修前8项失败；最终27/27通过（11项目录/读取器+原16项调账） | users-frontend-red.log、users-frontend-handoff.json |
| 真实Edge+实际构建+PG | 首次完整PASS、exit0；8132既有账号下表格50行、四菜单25条；翻页交集0、清批选、跨页搜索保留目标；40正常+10已提交后500刷新原ID重试仍一流水 | users-performance-browser.json、stdout/exit及3张viewport截图 |
| 冷备恢复演练 | 独立私有副本2662文件校验，在15434启动；钱包/流水/37迁移指纹一致，已停止演练实例 | restore-drill-receipt.json |

上表37/27项专项已包含在完整测试中，不重复相加；浏览器与恢复演练单独统计。修前旧接口真实查询返回7392行（其中143个为该专项夹具），前端6000账号页面模型渲染6000行；修后默认每页50条、四类候选各25条。143个后端夹具和3个浏览器自建账号均已精确清理，剩余0。浏览器同库目录响应22743字节，对比旧接口4026661字节；仅比较目录体积，不推断整页或耗时改善比例。最终工作区与扫描回执见[本轮优化记录](OPTIMIZATION_USERS_20261027.md)。

```text
pnpm test
Test Suites: 42 passed, 42 total
Tests:       376 passed, 376 total
BUSINESS_TEST_FILES count=33
WORKSPACE_TEST_PASS apiExit=0 businessExit=0
tests 390 / pass 390 / fail 0 / skipped 0
pnpm lint
WORKSPACE_LINT_PASS workspaces=6 failed=0
RESTORE_DRILL_PASS files=2662 migrations=37 walletsMatch=true ledgerMatch=true readOnly=true
RESTORE_DRILL_POSTGRES_STOPPED
```

命令只使用本机dfc_synthetic和独立临时端口；8个新增/变更源码与测试文件的验证前后SHA相同。pnpm保留了忽略package.json中pnpm.overrides的工具警告；本轮没有安装或修改依赖。新证据位于E:/codex专用工作区/optimization-users-20261027/evidence。

## 上一已发布版本的验证记录

以下维护版本已完成用户确认后的GitHub分支推送和Windows本机部署；当时使用maintenance-20261027/evidence。发布后16项检查通过，隔离库完整HTTP商业流程82通过、0失败、1真实KOOK跳过。完整发布证据位于E:/codex专用工作区/deploy-20261027/dfc/final-release-receipt.json；这些结果绑定7412eaf，不作为新增分页代码的浏览器或完整HTTP验收。

### 已发布7412eaf的原始验证

| 检查 | 当前结果 | 原始证据 |
| --- | --- | --- |
| 精确pnpm test | 41套API、339项全部通过；业务379项全部通过；apiExit=0 businessExit=0 | pnpm-test-final.log |
| 精确pnpm lint（项目现有定义为TypeScript类型检查） | 6个工作包全部退出0 | pnpm-lint-final.log |
| 四应用构建 | API、customer-web、companion-web、admin-web均退出0；行锁最后修改后API另重建退出0 | candidate-build-results.json、candidate-api-rebuild-results.json、各build日志 |
| 人工调账服务端 | 原14项13失败/1通过；新增死锁反例后最终15/15 | manual-adjustment-red.log、manual-adjustment-lock-red.log、manual-adjustment-lock-final.json |
| 人工调账页面与共享客户端 | 专属16/16，相关回归76/76；这些项目与379项业务集有重叠，不重复相加 | manual-adjustment-handoff.json |
| 真实HTTP商业流程 | 82通过、0失败、1跳过（真实KOOK）；使用dfc_e2e_focus_20261026，结束临时API已关 | candidate-e2e-real-http.log/json、candidate-e2e-service-stopped.json |
| 原生Edge浏览器锁 | 真navigator.locks+localStorage：held=1、pending=1，首次1POST/1合成流水；结果不明后刷新重放同ID | manual-native-browser.log/json；此场景使用合成HTTP回执，不接PG |
| 真Edge网页+真PostgreSQL调账 | 首笔40，一次POST/一流水；显式新笔10已提交但注入500，刷新原ID/原body重放仍一流水；最终50、冻结0 | candidate-manual-real-pg.json；业务断言通过，组合脚本后续客户setup失败退出1，不能报整段脚本PASS |
| 管理端核心页 | 用户页渲染、/api/admin/users=200 | candidate-admin-role.json与viewport截图 |
| 客户核心页 | 正常登录201、home渲染客户名/钱包、业务API200；状态PASS_OBSERVED | candidate-customer-role.json与viewport截图；原组合脚本随后等待networkidle超时，未伪称整体退出0 |
| 陪玩核心页 | 正常登录201、dashboard渲染、available与auth/me=200，专用脚本退出0 | candidate-companion.json、candidate-companion-running.log与截图 |
| 自建浏览器夹具清理 | 专属用户/钱包/profile/调账流水/管理员日志剩余均0；不清空其他测试数据 | 各角色报告cleanup、manual-adjustment-handoff.json |
| 当前迁移状态 | 两本机库各37已完成、0未完成，含微信迁移 | migration-current-readonly.json，只读状态核对 |
| 密钥扫描 | WIP32项0命中；两个可用历史各1条存储键误报已核实，精确处理后退出0；最终已提交源码扫描见最终回执 | secret-scan-summary.json、secret-scan-adjudication.json与最终扫描日志；只覆盖本机已有历史 |

精确命令与原文摘要：

```powershell
$env:DFC_LOCAL_RUNTIME='E:\dfc-runtime-20261026'
pnpm test
# Test Suites: 41 passed, 41 total
# Tests:       339 passed, 339 total
# tests 379 / pass 379 / fail 0
# WORKSPACE_TEST_PASS apiExit=0 businessExit=0
pnpm lint
# WORKSPACE_LINT_PASS workspaces=6 failed=0
```

HTTP脚本从当前候选API构建运行，报告绑定资金实现提交f537c75。用户角色采用独立合成数据库夹具创建，真实邮箱验证码发送、真实注册邮件交付没有据此验收；注册/权限的API回归与它分开。82项包含充值申请审核、冻结、派单、接单、开始/完成/验收、抽成、提现申请与人工审核等站内状态流转，PAID不代表实际转账。



### 当时的修前失败与根因

- 原pnpm lint退出1，依赖存在但手工链接布局缺少.bin命令快捷入口，报tsc无法识别。新入口用Node解析各工作包实际TypeScript/Jest命令，不靠全局命令。
- 人工调账修前14项为13失败/1通过：同编号重试会重复加减款，8次并发也会产生多条流水。修后使用持久businessKey、事务锁和有效载荷绑定，返回原流水回执。
- 追加真实下单与调账交叉事务反例：旧FOR UPDATE用户锁会与下单持有的钱包锁及订单外键锁形成死锁。改FOR NO KEY UPDATE后两事务均成功，余额100−80+10=30，冻结80，各只有1笔相应流水。
- 首次完整pnpm test为API40套通过/1套失败，336项通过/1项失败；业务也有1失败。原始pnpm-test-after-entry.log保留。陪玩榜计数多的一条已通过闲置连接实测确认为独立SELECT 1探活，业务SQL指纹不变；只过滤完整探活语句，仍要求业务SQL为1，并测试额外业务SELECT会被计入。另一失败是旧检查不允许任何gitleaks忽略项，与本轮已人工审阅的单条历史存储键误报冲突；新检查只允许该精确提交/路径/规则/行指纹，产品硬编码链接断言未改变。
- 浏览器脚本的初始锁观测/结果不明模拟和强制快速导航曾失败，原始日志保留。最终采用确定的“合成记录已写但响应500”验证unknown恢复；登录未稳定时强制导航清除会话的观察列入未验收项，不把放慢脚本说成认证问题已修好。

### 该次运行方式与范围

已准备私有本机PostgreSQL；本轮未启动Docker/WSL、未重复安装依赖、未修改数据库schema，也未重新声称从空库应用所有迁移。只读核实dfc_local与dfc_synthetic各37项已完成迁移、0未完成，均含微信身份迁移。迁移文件未变；证据migration-current-readonly.json。

候选.env来自模板且只含测试值、被Git忽略；实际测试入口明确读取已有私有运行配置，并将API测试指向127.0.0.1的dfc_synthetic。外部通知关闭，认证凭据不写入报告。完整HTTP闭环使用现有脚本自身强制校验的独立dfc_e2e_*库。

三个网页和API的构建输出均位于维护目录；浏览器测试用临时端口18095/18420/18500–18502，完整HTTP闭环API用18430。结束后关闭自有临时进程；不停止PostgreSQL，不替换正在使用的18080/18400服务。原运行目录HEAD、Git状态及关键构建文件哈希另有前后核对。

### 仍适用的验收缺口

- R01认证并发专项此前被自动安全审核以可能涉及网络安全风险拒绝。本轮没有改写、重试或绕过，快速导航观察也不作为已经修复。
- 真实微信AppID/真机、真实KOOK/Discord账户与双平台按钮、真实SMTP、银行/支付平台付款和提现未在本轮验收。合成数据里的PAID仅代表业务状态，不发生转账。
- 原生小程序默认内存模拟，已有源码、登录原型和隔离测试不代表完整商业功能；本轮未新增小程序/APP/多游戏/自动付款功能。
- 公网HTTPS、Docker镜像运行、云端CI、目标服务器备份恢复与人为操作验收未在本轮执行。
- Git历史为浅克隆，只扫描本机可用历史；依赖中低危的上一版记录仍是遗留项，本轮没有重新查询漏洞数据库。

### 该次证据位置

本轮原始命令输出、JSON和截图统一位于E:/codex专用工作区/maintenance-20261027/evidence。此前版本323项API/356项业务/82项HTTP的回执在release-optimize-20261027，仅证明各自绑定的旧版本；本报告不把旧结果充作新修改的验收。

原工程32项改动保存、Git bundle校验、逐文件SHA-256、归档去向和推送边界见[维护与清理](MAINTENANCE_20261027.md)。
