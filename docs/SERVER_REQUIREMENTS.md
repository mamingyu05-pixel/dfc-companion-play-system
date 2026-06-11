# 服务器需要什么

## 必需资源

- 一台 Ubuntu VPS。
- 一个域名。
- 一个公网 IP。
- SSH 登录权限。
- Discord Bot Token。
- Discord 频道 ID。
- KOOK Bot Token。
- KOOK 频道 ID。

## 推荐服务器规格

第一阶段 MVP：

```text
CPU: 2 核
内存: 4GB
磁盘: 40GB
系统: Ubuntu 22.04 或 24.04
```

如果后续有真实订单和图片上传，建议：

```text
CPU: 4 核
内存: 8GB
磁盘: 80GB+
```

## 域名 DNS

添加 A 记录：

```text
类型: A
主机记录: @
记录值: 服务器公网 IP
```

可选：

```text
类型: A
主机记录: www
记录值: 服务器公网 IP
```

## 端口

公网开放：

```text
22/tcp  SSH
80/tcp  HTTP / Let's Encrypt 验证
443/tcp HTTPS
```

不要公网开放：

```text
5432 PostgreSQL
4000 API
3000 customer-web
3001 companion-web
3002 admin-web
```

这些服务只通过 Docker 网络和 Nginx 访问。

## 你必须提供的信息

```text
服务器 IP
服务器 SSH 用户名
域名
管理员邮箱
Discord Bot Token
Discord Guild ID
Discord 订单频道 ID
Discord 管理员频道 ID
Discord 充值频道 ID
Discord 提现频道 ID
Discord 投诉频道 ID
KOOK Guild ID
KOOK 订单频道 ID
KOOK 管理员频道 ID
KOOK 充值频道 ID
KOOK 提现频道 ID
KOOK 投诉频道 ID
KOOK 陪玩角色 ID
```

不要把密码或 Token 发到公开聊天、文档或代码仓库。
