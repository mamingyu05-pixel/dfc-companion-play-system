# 部署文档

## 服务器准备

推荐最低配置：

- Ubuntu 22.04/24.04
- 2 核 CPU
- 4GB 内存
- 40GB 磁盘
- 1 个公网 IPv4

需要你自行完成：

- 购买服务器。
- 购买或准备域名。
- 将域名 A 记录解析到服务器公网 IP。
- 准备 Discord Bot Token 和频道 ID。
- 保存 `.env` 中的密码和密钥。

## 服务器初始化

登录服务器后执行：

```bash
sudo bash scripts/server-bootstrap.sh
```

该脚本会安装：

- Git
- Docker
- Docker Compose Plugin
- UFW 防火墙

并开放：

- 22 SSH
- 80 HTTP
- 443 HTTPS

## 首次部署

```bash
cp .env.production.example .env
nano .env
```

必须修改：

```text
DOMAIN
LETSENCRYPT_EMAIL
POSTGRES_PASSWORD
DATABASE_URL
JWT_SECRET
BOT_INTERNAL_TOKEN
ADMIN_EMAIL
ADMIN_PASSWORD
DISCORD_TOKEN
DISCORD_GUILD_ID
DISCORD_*_CHANNEL_ID
KOOK_TOKEN
KOOK_VERIFY_TOKEN
KOOK_GUILD_ID
KOOK_*_CHANNEL_ID
KOOK_*_ROLE_ID
```

启动：

```bash
bash scripts/deploy.sh
```

访问：

```text
http://你的域名/customer
http://你的域名/companion
http://你的域名/admin
```

## 启用 HTTPS

前提：

- 域名已解析到服务器 IP。
- 80 端口可访问。
- `.env` 中 `DOMAIN` 和 `LETSENCRYPT_EMAIL` 已正确填写。

执行：

```bash
bash scripts/enable-https.sh
```

## KOOK Webhook

HTTPS 可访问后，在 KOOK 开发者后台把机器人连接模式设置为 Webhook，并填写：

```text
https://你的域名/api/kook/webhook?compress=0
```

然后把开发者后台的 Verify Token 填入服务器 `.env`：

```text
KOOK_VERIFY_TOKEN=你的verify_token
```

访问：

```text
https://你的域名/customer
https://你的域名/companion
https://你的域名/admin
```

## 日志

```bash
bash scripts/logs.sh
```

## 更新部署

```bash
git pull
bash scripts/restart.sh
```

如果包含数据库迁移：

```bash
docker compose run --rm api-server pnpm --filter @dfc/database prisma:deploy
```

## 数据库备份

```bash
bash scripts/backup-postgres.sh
```

备份文件写入：

```text
backups/
```

## 生产部署要求

- PostgreSQL 使用持久化磁盘和每日备份。
- API、Web、Discord Bot、KOOK Bot 分进程部署。
- Nginx 终止 HTTPS。
- Bot 使用进程守护。
- 日志输出到集中日志系统。
- 数据库迁移必须先备份。

## 零停机更新原则

- Web 和 API 使用滚动更新。
- Bot 更新前先启动新实例，通过健康检查后切流。
- 数据库迁移必须向后兼容：
  - 先加字段，不立即删字段。
  - 先兼容新旧代码，再清理旧字段。
- 订单和钱包写操作必须幂等。

## 回滚原则

- 代码回滚不得回滚已提交的资金流水。
- 数据库回滚只允许执行明确的修复迁移。
- 回滚后必须跑业务闭环测试。

## 当前限制

当前代码仍是工程骨架，不是完整业务系统。部署后可验证网站入口、Nginx、容器和基础 API，但充值审核、下单扣款、接单结算、提现审核仍需继续实现真实后端逻辑。
