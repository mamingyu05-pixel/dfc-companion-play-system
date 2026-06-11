# 已知问题

1. 当前仅完成工程基线和接口骨架，业务服务尚未接入真实 Prisma 事务。
2. 前端页面是入口骨架，未完成表单、列表、权限拦截和接口调用。
3. Discord Bot 已接入 API 回写，KOOK 已增加 Webhook 回写入口；仍需用真实平台 Token 做端到端验证。
4. 还未生成 Prisma migration 文件，需要安装依赖并连接 PostgreSQL 后执行。
5. CI 需要 `pnpm-lock.yaml`，安装依赖后应提交 lockfile。
6. 生产 HTTPS、备份、监控和滚动发布配置仍待 DevOps Agent 实现。
7. 双平台同时接单已加入后端事务和条件更新防重复，但仍需用真实 Discord/KOOK 并发点击做端到端验证。
8. KOOK Webhook 当前建议使用 `compress=0`，尚未实现压缩包体和加密包体处理。
