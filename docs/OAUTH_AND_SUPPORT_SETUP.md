# May猫饼电竞 OAuth 登录与客服跳转配置

## 目标

客户可以选择三种方式进入客户端：

- 邮箱验证码注册 / 邮箱密码登录
- Discord 注册 / 登录
- KOOK 注册 / 登录

所有方式都会进入统一的 `users` 表。Discord / KOOK 账号会写入 `user_external_accounts`，不会建立第二套账户系统。

## 需要你自己获得的东西

### Discord

1. 打开 Discord Developer Portal。
2. 创建 Application。
3. 在 OAuth2 页面添加回调地址：

```text
https://maycatplay.com/api/auth/oauth/discord/callback
```

4. 复制 `Client ID` 和 `Client Secret`。
5. 准备一个客服入口链接，可以是 Discord 服务器邀请链接、客服频道链接或客服账号资料链接。

### KOOK

1. 打开 KOOK 开发者后台。
2. 创建应用。
3. 添加 OAuth 回调地址：

```text
https://maycatplay.com/api/auth/oauth/kook/callback
```

4. 复制 `Client ID` 和 `Client Secret`。
5. 准备一个客服入口链接，可以是 KOOK 服务器邀请链接、客服频道链接或客服账号链接。

## 服务器 `.env` 需要新增

```env
CUSTOMER_WEB_URL=https://maycatplay.com/customer

DISCORD_CLIENT_ID=你的DiscordClientID
DISCORD_CLIENT_SECRET=你的DiscordClientSecret
DISCORD_REDIRECT_URI=https://maycatplay.com/api/auth/oauth/discord/callback

KOOK_CLIENT_ID=你的KOOKClientID
KOOK_CLIENT_SECRET=你的KOOKClientSecret
KOOK_REDIRECT_URI=https://maycatplay.com/api/auth/oauth/kook/callback

SUPPORT_DISCORD_URL=你的Discord客服链接
SUPPORT_KOOK_URL=你的KOOK客服链接
```

如果 KOOK 后台显示的 OAuth 接口地址和系统默认地址不同，再额外填写：

```env
KOOK_OAUTH_AUTHORIZE_URL=
KOOK_OAUTH_TOKEN_URL=
KOOK_OAUTH_USER_URL=
KOOK_OAUTH_SCOPE=
```

## 部署更新

```bash
cd /opt/companion-play-system
sudo git pull
sudo docker compose up -d --build api-server customer-web nginx
sudo docker compose restart nginx
```

## 验证

1. 打开 `https://maycatplay.com/customer/`。
2. 点击 `Discord 注册/登录`。
3. 授权成功后应进入 `https://maycatplay.com/customer/home/`。
4. 后台用户管理应看到新客户。
5. 后台用户绑定字段应显示 Discord 或 KOOK 已绑定。
6. 打开客户端客服页，点击 KOOK / Discord 客服按钮应跳转到对应平台。

## 注意

- Discord 私聊链接受 Discord 平台限制，不一定能直接向陌生账号发起 DM。运营上更稳的是放服务器邀请链接或客服频道链接。
- KOOK 也建议优先放服务器 / 频道入口，客户进入后再由客服私聊。
- OAuth 登录创建的客户没有邮箱密码，邮箱字段会使用内部占位地址 `@oauth.maycatplay.local`，页面会显示为“第三方账号注册”。
