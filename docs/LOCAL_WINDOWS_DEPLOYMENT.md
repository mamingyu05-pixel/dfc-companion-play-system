# Windows 本机部署

本入口使用独立 PostgreSQL 16 数据目录、当前源码的 Prisma 客户端、三个 Next 生产构建和一个 Node 同源网关。无需启动 Docker/WSL。只监听本机回环地址，不自动启动 Discord、KOOK、邮件或收费 AI 服务。

## 准备与启动

在仓库根目录执行。运行目录和 PostgreSQL 二进制使用英文路径，避免 Windows PostgreSQL 子进程对中文路径的编码问题。依赖来源指向已有、可解析的安装；生成的客户端不会覆盖它。

```powershell
$env:DFC_LOCAL_RUNTIME='E:/dfc-runtime-20261026'
$env:DFC_DEPENDENCY_SOURCE='E:/dfc-runtime-20261027/dependencies'
$env:DFC_PG_BIN='E:/ipcrm-runtime-20261026/deps/node_modules/@embedded-postgres/windows-x64/native/bin'
$env:DFC_WEB_DEPENDENCY_SOURCE='E:/dfc-runtime-20261027/dependencies/apps/customer-web'

node scripts/local-windows/runtime.cjs prepare
node scripts/local-windows/runtime.cjs postgres
node scripts/local-windows/runtime.cjs migrate
node scripts/local-windows/runtime.cjs seed
node scripts/local-windows/runtime.cjs build api-server
node scripts/local-windows/runtime.cjs build customer-web
node scripts/local-windows/runtime.cjs build companion-web
node scripts/local-windows/runtime.cjs build admin-web
node scripts/local-windows/runtime.cjs start
node scripts/local-windows/runtime.cjs status
```

依赖只通过 junction 复用。本轮补丁安装位于独立的 `E:/dfc-runtime-20261027/dependencies`，包含当前根目录和各工作区的 package.json、pnpm-workspace.yaml 与 pnpm-lock.yaml 镜像；没有覆盖原工程的共享安装。重建镜像时应从当前提交同步这些清单，再在独立目录冻结安装。Next 为 15.5.28、sharp 为 0.35.5，其他补丁版本以锁文件为准；`prepare` 会拒绝与精确版本不符的旧依赖源。

```powershell
pnpm --dir "$env:DFC_DEPENDENCY_SOURCE" install --frozen-lockfile --ignore-scripts
```

每次只运行一个 build。本入口设置单个静态生成 worker 与 640 MiB Node 堆上限，Prisma 每个实例连接池上限为 4。已有依赖跨 C/E 盘时，Next 的 Windows 路径处理可能出错，因此补丁依赖与发布工作区均使用 E 盘。不要在共享依赖 junction 上直接运行 `pnpm install` 或默认 `db:generate`；使用本入口的 `prepare` 生成独立客户端。

## 访问与数据

| 服务 | 地址 |
| --- | --- |
| 门户 | http://127.0.0.1:18080/ |
| 客户 | http://127.0.0.1:18080/customer/ |
| 陪玩 | http://127.0.0.1:18080/companion/ |
| 后台 | http://127.0.0.1:18080/admin/ |
| API 诊断 | http://127.0.0.1:18080/api/health |
| 独立 PostgreSQL | 127.0.0.1:15433 |

后台本机账号为 `admin@dfc.local`，随机密码保存在运行目录的 `runtime-private.json`。该文件和数据库数据不进入 Git。默认只创建本机管理员，不向现有真实用户或资金账户写入数据。

`health` 的 `processAlive=true` 表示 API 存活；其中 `productionReady=false` 与支付、KOOK 等阻塞标记会保留，不能把 HTTP 200 当作公网发布或真实渠道验收。`seed` 输出实际数据库用户数与已完成迁移数；登录、受保护接口和页面需分别核验。

各服务日志、PID/命令参数、数据库、上传和私有配置保存在 `DFC_LOCAL_RUNTIME`。本入口不安装开机启动项；电脑重启后先 `postgres`，再 `start`。使用同源网关地址访问，直开 18300/18301/18302 的页面不能完整使用 `/api`。

停止：`node scripts/local-windows/runtime.cjs stop`。它只按保存的 PID 和实际进程命令核对本入口的 Node 服务，再正常停止私有 PostgreSQL；遇到进程身份不匹配会保留现场。再次启动前执行 `postgres`，再执行 `start`。

网关回归：`node --test scripts/local-windows/gateway.test.cjs`。

当前源码的 PostgreSQL 集成回归使用独立的 `dfc_synthetic` 库：先 `node scripts/local-windows/runtime.cjs migrate dfc_synthetic`，再 `node scripts/local-windows/runtime.cjs test`，不会把测试指向本机演示库。HTTP 冒烟：`node scripts/local-windows/smoke.cjs`，只读页面/接口并验证本机管理员登录，不操作充值、订单资金或通知。
