# 本机 TEST API 持久化验证

本封装复用现有 PostgreSQL 16.14、Windows Job 资源守卫及原业务代码。它使用原生小程序 Page/api-client 和合成 wx HTTP 适配器，经过真实本机 Nest 控制器、JWT/角色守卫和订单事务，再从独立连接读取持久化订单、TEST 标记、钱包冻结和请求回执。它不能证明微信 IDE、真机、KOOK 或支付链路可用。

运行前必须由原负责人释放重型占用，并取得父线程明确的单次串行时段。可用内存启动门槛为 7.5 GiB，运行停止线为 6.5 GiB；Job 上限 768 MiB、CPU 5%，工作最多 120 秒、清理最多 30 秒。不会修改系统防火墙、恢复旧服务器或读取运行环境文件。既有权限拒绝不能用更换执行器、账号、ACL 或复制可执行文件绕过。

命令格式：

```powershell
python scripts/isolated-test-api/guard.py --approved-test-api-pg --manifest <本机封存清单.json> --manifest-sha256 <清单SHA256> --window-evidence <父线程窗口回执.json>
```

清单在仓库外保存本机路径和源码、迁移、PG 可执行文件、既有 Job 守卫的 SHA256。窗口回执包含 `parentThread`、`scope=DFC_LOCAL_TEST_API_PG`、`manifestSha256`、`backpackOwnerReleased=true`、`serialWindowGranted=true`、`notBeforeUtc`、`notAfterUtc`；时间跨度不得超过 150 秒，且只能使用一次。这是协调证据，不替代平台执行权限审批。仓库不保存授权回执、密钥、数据目录或测试输出。

入口先验证清单、时段和内存，再在同一个受限 Job 内执行 9 组无联网合成检查和 API noEmit 类型检查；任何失败都不会尝试启动 PG。之后只在新建的本机 `dfc_test_*` 数据库应用现有迁移，生成内存中的合成身份并执行四组 HTTP/持久化测试。测试凭据不落盘，日志过滤临时密码和 JWT。退出时只关闭本次拥有的 API、PG 和子进程，保留去敏测试证据。

729250d 的获批隔离运行已通过 7 组合成检查和 API/test noEmit，成功启动 PG16.14 并在全新隔离库应用 30 个迁移；在 HTTP 监听前被数据库身份守卫拒绝，4 组 HTTP/订单持久化测试尚未开始，PG 已正常停止。本次正常审批执行没有复现旧 spawn EPERM，但不据此推断其历史原因。

现已修复具体格式缺陷：PostgreSQL inet::text 包含 /32 或 /128，不能与裸回环地址直接比较。查询改用 host(inet_server_addr())，仍只接受精确的 127.0.0.1/::1、相同 dfc_test_* 库名及有效 TEST 店铺；没有把任意带掩码字符串加入白名单。新增脱敏诊断仅包含库名规则/匹配布尔值、行数和 host 分类，不包含实际库名、地址、连接 URL 或凭据。

主机格式修复后，cd51933 的第二次获批运行通过 8 组合成检查和 API/test noEmit，PG16.14 与 30 个迁移成功，实际身份诊断为 accepted=true、LOOPBACK_IPV4、原始 LOOPBACK_IPV4_WITH_MASK，证实 SQL 规范化修复有效。随后 Node Server.listen 对字面回环地址调用 dns.lookup，被原先“一律禁用 DNS”的应用守卫误拦；尚未开始 4 组 HTTP/持久化测试，PG 与所有本次子进程均已停止。

本次仅允许 dns.lookup 和 dns.promises.lookup 的精确字符串 127.0.0.1/::1。这两个字面地址使用 Node isIP 快路径，不进入系统 DNS；API_HOST 和 TCP/HTTP 目的地规则保持原样。域名、其他 IP、映射 IPv6、别名、resolve/reverse/lookupService 继续拒绝。第 9 组回归通过真正的 net.Server.listen 解析流程，但在 OS 监听分配之前用假入口截住，因此合成检查不占端口。旧代码先复现误拦，修复后 9/9 通过，API/test noEmit 为 0 diagnostics。新的 HTTP/PG 验证仍须绑定当前提交及封存清单；不得将合成测试或历史 96 项结果当作实际平台验证。

源码开关复用 `DFC_ISOLATED_API`、`DFC_ISOLATED_DATABASE`、`DFC_STORE_KEY`、`DATABASE_URL`、`JWT_SECRET`、`DFC_TEST_MODE` 和 `DFC_BACKGROUND_JOBS_ENABLED`，新增显式 `API_HOST=127.0.0.1`、`API_PORT`、`DFC_TEST_SUBJECT`、`DFC_OUTBOUND_POLICY=deny`。隔离配置缺项、非本机数据库、错配身份或继承的外部集成配置会拒绝启动/请求。默认小程序仍为 `simulation`，本封装只在内存注入测试配置，不修改默认配置文件。

## 短时手动 TEST 窗口（新增，真实驻留验证待排期）

eaabfd55 的 2026-10-08 第三窗口已实际通过原有 4 组本机 HTTP→PG 测试：39 次 HTTP、2 笔 TEST 订单/冻结、通知调用 0，并已关闭服务。本节新增交互驻留不复用旧端口、旧 JWT 或旧数据库，也不以该历史结果证明新模式可用。

仍调用本目录原 guard.py/runner.cjs/cases.cjs，仅增加 `--interactive-seconds 60`（允许 15..90）。父回执必须单独使用 `scope=DFC_LOCAL_TEST_API_PG_INTERACTIVE`，并包含相同 `interactiveSeconds`，绑定当前源码清单。需要实际操作者控制台；没有新时段回执或标准输入不是终端时拒绝启动。总窗口不超过 150 秒、工作不超过 120 秒、清理不超过 30 秒；沿用 768/704 MiB Job、单进程 640 MiB、CPU 5%、7.5 GiB 启动及 6.5 GiB 立即停止线。准备阶段耗时也算入总窗口。

1. 先让真实微信开发者工具打开既有 `apps/miniapp-native`，完成必要的用户扫码/明确授权及编译检查，再由父线程安排 API 时段。官方 `wechatide status` 在连接失败时可能自动进入 auth，不能当纯只读或无交互探测；不要循环调用。不得自行开启服务端口、关闭域名校验或替用户登录。
2. 获批后在可交互控制台运行同一守卫，添加 `--interactive-seconds 60`。封装先跑离线检查和 API/test noEmit，再建全新回环 PG/TEST 店铺；不加载 `.env` 或真实集成凭据。就绪输出仅有 `baseUrl`、截止时间、状态及计数，不含 JWT、配对申请 ID 或配对码。
3. 在原生页面的“本机 TEST 连接”粘贴本次 `http://127.0.0.1:<端口>/api`，点“申请临时 TEST 会话”。地址只保存在页面内存；不修改 `api-config.js`、AppID 或安全域名。手机真机不能用这个回环地址连接电脑。
4. 操作者核对原生页面显示的六位配对码，在本次控制台输入 `APPROVE 六位码`，30 秒内点页面“核对本机授权”。这只批准本次隔离库内的合成 CUSTOMER，JWT 绑定主体/库/TEST 店铺/issuer/audience并随窗口过期，最多领取一次；不是微信登录，不创建外部账号、权限或商户。未批准、错误码、超时、重复领取、非回环请求均拒绝。
5. 页面先完成既有 TEST 环境握手，用户再选服务、核对报价、确认测试单、查看回执和测试钱包。可见“隔离 API 测试”“无真实资金”“未接微信支付”标识；不能把本机数据称作微信/KOOK/支付验收。
6. 控制台输入 `STOP`、标准输入 EOF、守卫取消或到期后，所有 TEST 路由先拒绝新请求，再按既有流程关闭自有 API/Prisma/PG并核所属子进程。停止信号直接参与请求准入，不依赖等待循环的下一次轮询；已进入业务处理的请求仍由原事务及受限清理处理。页面“断开 TEST 会话”或退出清除其内存会话，保留未决请求编号用于核对；从不清除用户其他应用/会话。默认模拟配置文件全程不变，无需覆写恢复。

新增 `interactive.cjs` 的会话端点只由该临时封装挂载，不加入主业务服务路由。端点要求精确回环 peer、Host 和专用请求头，普通跨站表单无法触发申请；单窗口有申请/错误批准预算，不开放通用登录或任意用户身份。操作批准仅经本机标准输入，令牌只通过本机响应交给原生页面内存，回执/日志/本地存储不保存。

此前交互候选的 9 组纯内存会话/原生页面检查及既有 8 组 UI 回归通过；首次第 9 组夹具时钟失败与修复后证据保留。这些结果不覆盖当前停止准入补丁。当前额外补入 6 组定向检查（合计 15 组）：正常业务准入、STOP 后重复请求、EOF/守卫取消谓词、精确截止时间、签名等待期间取消/到期，以及重复配对申请；尚未执行。取消检查使用合成谓词，不是实际标准输入/守卫运行。尚未运行新模式的实际 PG/HTTP、控制台转发/EOF、微信 wx.request 或人工下单；守卫安全退出成功也不等同手动业务流程验收。

## 完整迁移清单校验

隔离入口不再硬编码迁移数量。`migration-contract.cjs` 在任何 PG 可执行文件启动前读取当前仓库迁移目录，要求获批清单完整覆盖所有迁移，并逐项匹配确定的字典顺序、名称、仓库内绝对路径与 SQL 原始字节 SHA256。漏项、多项、重复、错序、目录链接、额外 SQL 或内容漂移均拒绝；离线检查后和执行迁移 SQL 前再次核对，实际 SQL 读取仍逐文件验证哈希。回执记录实际校验数量；本文历史运行的 30 条记录仍是历史事实。

新增迁移必须重建并复核完整清单及源码封存，再取得绑定新清单 SHA 的单次串行窗口，不能只把数字改大或复用旧窗口。清单的 `validationFiles` 必须包含当前 `guard.py`、`runner.cjs`、`migration-contract.cjs` 和 `migration-contract.test.cjs` 的 SHA256；原有其它源码、工具、窗口和资源限制继续生效。

无数据库回归命令：`node scripts/isolated-test-api/migration-contract.test.cjs`。可选末尾提供仓库绝对路径和独立复核的迁移清单 JSON（包含 `count`、`migrations`），额外只读核对实际迁移与清单是否一致；测试不启动进程、服务或 PG，不写文件。这里只修改小程序隔离入口；Jest 的专用 `dfc_synthetic` 与此入口全新 `dfc_test_*` 库名契约保持分开，不允许将任一测试指向现有演示库。
