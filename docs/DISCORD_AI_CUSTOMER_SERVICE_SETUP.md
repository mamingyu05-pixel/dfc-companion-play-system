# May猫饼 Discord AI 客服接入

## 目标

让 Discord 和 KOOK 一样具备：

- 客服频道 AI 自动回复。
- 客户私聊 Bot 咨询。
- 客户在频道里 @Bot 咨询。
- 客户说找陪玩需求时，后端记录对话并可生成派单草稿。
- 陪玩在派单频道点击报名。

AI 不能直接加余额、退款、提现、封号、改订单金额或完成结算。

## 需要准备

最终 `.env` 至少需要：

```env
DISCORD_TOKEN=
DISCORD_GUILD_ID=
DISCORD_SUPPORT_CHANNEL_ID=
DISCORD_DISPATCH_CHANNEL_ID=
DISCORD_ADMIN_CHANNEL_ID=
DISCORD_RECHARGE_CHANNEL_ID=
DISCORD_WITHDRAWAL_CHANNEL_ID=
DISCORD_COMPLAINT_CHANNEL_ID=

AI_SUPPORT_ENABLED=true
AI_SUPPORT_MODEL=deepseek-chat
AI_SUPPORT_BASE_URL=https://api.deepseek.com/v1
AI_SUPPORT_API_STYLE=chat
AI_SUPPORT_API_KEY=
AI_AUTO_DISPATCH_ENABLED=false
```

如果你继续用 OpenAI，会遇到地区限制；目前你已经测试过 DeepSeek 更适合当前服务器。

## 一、创建 Discord Bot

1. 打开：

```text
https://discord.com/developers/applications
```

2. 点 `New Application`。
3. 名字填：

```text
May猫饼客服
```

4. 左侧进入 `Bot`。
5. 点 `Reset Token` 或 `View Token`。
6. 复制 Token，填到服务器 `.env`：

```env
DISCORD_TOKEN=你的DiscordBotToken
```

不要把 Token 发给任何人。

## 二、打开消息权限

在 Discord Developer Portal：

1. 左侧进入 `Bot`。
2. 找到 `Privileged Gateway Intents`。
3. 打开：

```text
MESSAGE CONTENT INTENT
```

不开这个，Bot 看不到客户发的文字，AI 客服不会回复。

建议同时打开：

```text
SERVER MEMBERS INTENT
```

后续做会员等级、角色同步会用到。

## 三、邀请 Bot 进服务器

1. 左侧进入 `OAuth2` 或 `Installation`。
2. Scopes 勾选：

```text
bot
applications.commands
```

3. Bot Permissions 勾选：

```text
View Channels
Send Messages
Read Message History
Use Slash Commands
Manage Channels
Manage Roles
Connect
Speak
Move Members
```

4. 复制生成的邀请链接。
5. 浏览器打开邀请链接。
6. 选择你的 May猫饼 Discord 服务器。
7. 授权。

## 四、获取服务器 ID

1. Discord 左下角齿轮。
2. `高级`。
3. 打开 `开发者模式`。
4. 右键你的 Discord 服务器名字。
5. 点 `复制服务器 ID`。

填到 `.env`：

```env
DISCORD_GUILD_ID=复制的服务器ID
```

## 五、自动创建 Discord 频道

服务器执行：

```bash
cd /opt/companion-play-system
sudo git pull origin main
sudo docker compose build api-server
sudo docker compose run --rm api-server node /app/scripts/setup-discord-server.js 你的Discord服务器ID --decorate-channels --post-welcome
```

脚本会创建或复用：

```text
May猫饼｜客户服务
  💬｜客服接待

May猫饼｜陪玩派单
  📣｜人工派单
  🎧｜试音等候室

May猫饼｜运营后台
  💳｜充值审核
  💸｜提现审核
  🧯｜投诉处理
  🛎️｜管理提醒
```

脚本会输出：

```env
DISCORD_GUILD_ID=
DISCORD_SUPPORT_CHANNEL_ID=
DISCORD_DISPATCH_CHANNEL_ID=
DISCORD_RECHARGE_CHANNEL_ID=
DISCORD_WITHDRAWAL_CHANNEL_ID=
DISCORD_COMPLAINT_CHANNEL_ID=
DISCORD_ADMIN_CHANNEL_ID=
```

把这些复制进服务器 `.env`。

```bash
sudo nano .env
```

保存后重启：

```bash
sudo docker compose restart api-server discord-bot nginx
```

## 六、配置 AI

如果用 DeepSeek：

```env
AI_SUPPORT_ENABLED=true
AI_SUPPORT_MODEL=deepseek-chat
AI_SUPPORT_BASE_URL=https://api.deepseek.com/v1
AI_SUPPORT_API_STYLE=chat
AI_SUPPORT_API_KEY=你的DeepSeekKey
AI_AUTO_DISPATCH_ENABLED=false
```

第一阶段先不要开自动派单：

```env
AI_AUTO_DISPATCH_ENABLED=false
```

等 AI 回复稳定、派单草稿质量稳定，再改成 `true`。

## 七、验证 Discord Bot 是否在线

```bash
cd /opt/companion-play-system
sudo docker compose logs -f discord-bot
```

看到类似：

```text
Maycat Discord Bot ready as May猫饼客服#xxxx
```

说明 Bot 已在线。

## 八、测试 AI 客服

在 `💬｜客服接待` 发：

```text
你好
我想找陪玩
三角洲，晚上玩2小时，想先试音，预算不确定
充值不到账怎么办
我想做陪玩
```

预期：

- Bot 会回复。
- 找陪玩会继续追问游戏、模式、时长、预算、试音。
- 充值、退款、提现会提示人工确认。
- Bot 不会承诺直接加余额。

也可以私聊 Bot：

```text
我想下单
```

## 九、常见问题

### Bot 不回复

检查：

```bash
sudo docker compose ps
sudo docker compose logs -f discord-bot
```

重点看：

- `DISCORD_TOKEN` 是否正确。
- Developer Portal 是否打开 `MESSAGE CONTENT INTENT`。
- Bot 是否在服务器。
- Bot 是否能看到 `💬｜客服接待`。
- `DISCORD_SUPPORT_CHANNEL_ID` 是否填对。
- `BOT_INTERNAL_TOKEN` 是否和 api-server 一致。

### Bot 在线但 AI 很死板

检查：

```env
AI_SUPPORT_ENABLED=true
AI_SUPPORT_API_KEY=是否已填写
AI_SUPPORT_MODEL=deepseek-chat
AI_SUPPORT_BASE_URL=https://api.deepseek.com/v1
AI_SUPPORT_API_STYLE=chat
```

然后重启：

```bash
sudo docker compose restart api-server discord-bot
```

### 自动创建频道失败

多半是 Bot 权限不足。

在 Discord 服务器里：

1. 服务器设置。
2. 角色。
3. 找到 Bot 角色。
4. 给它 `Manage Channels`。
5. 重新运行脚本。

## 十、当前系统已经支持的能力

代码里已经有：

- `discord-bot` 监听客服频道、私聊和 @Bot。
- `POST /api/discord/support/messages` 回写后端 AI 客服。
- `POST /api/discord/order-drafts/apply` 陪玩报名。
- `POST /api/discord/orders/accept` 按钮接单。

所以接入重点是 Discord Developer Portal、服务器权限、`.env`、容器重启。
