# Windows 本机部署

本入口使用独立 PostgreSQL 16 数据目录、当前源码的 Prisma 客户端、三个 Next 生产构建和一个 Node 同源网关。无需启动 Docker/WSL。只监听本机回环地址，不自动启动 Discord、KOOK、邮件或收费 AI 服务。

## 准备与启动

在仓库根目录执行。运行目录和 PostgreSQL 二进制使用英文路径，避免 Windows PostgreSQL 子进程对中文路径的编码问题。依赖来源指向已有、可解析的安装；生成的客户端不会覆盖它。

```powershell
$env:DFC_LOCAL_RUNTIME='E:/dfc-runtime-20261026'
$env:DFC_DEPENDENCY_SOURCE='C:/Users/mamin/Documents/Codex/2026-10-01/task-11/dfc-companion-play-system'
$env:DFC_PG_BIN='E:/ipcrm-runtime-20261026/deps/node_modules/@embedded-postgres/windows-x64/native/bin'
$env:DFC_WEB_DEPENDENCY_SOURCE='E:/dfc-runtime-20261026/web-deps'

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

依赖只通过 junction 复用。已有依赖跨 C/E 盘时，Next 15 的 webpack 可能把 Windows 绝对路径错误地作为相对入口；可将以下必要的锁定前端依赖独立安装到同盘运行目录，然后设置 `DFC_WEB_DEPENDENCY_SOURCE`。不需要复制原来的数 GB 依赖目录。

```powershell
npm install --prefix "$env:DFC_LOCAL_RUNTIME/web-deps" --no-audit --no-fund --ignore-scripts next@15.5.19 react@19.2.7 react-dom@19.2.7 @types/react@19.2.17 @types/react-dom@19.2.3 tailwindcss@3.4.19 postcss@8.5.15 autoprefixer@10.5.0 typescript@5.7.2 @types/node@22.19.21
```

每次只运行一个 build。本入口设置单个静态生成 worker 与 640 MiB Node 堆上限，Prisma 每个实例连接池上限为 4。不要在共享依赖 junction 上直接运行 `pnpm install` 或默认 `db:generate`；使用本入口的 `prepare` 生成独立客户端。

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
