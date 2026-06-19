# May猫饼 Discord / KOOK 社群装饰脚本

用途：把 Discord 和 KOOK 频道整理成更像成熟陪玩社群的结构，包括服务价目、店内导航、客服接待、AI 派单、人工派单、考核专区、专属会员区和 XP 接单语音房。

脚本不会删除频道。重复执行时会优先复用 `.env` 里的频道 ID 或同名频道，避免重复创建。

## 服务器部署

```bash
cd /opt/companion-play-system
sudo git pull origin main
sudo docker compose build api-server admin-web
sudo docker compose run --rm api-server pnpm --filter @dfc/database prisma:deploy
sudo docker compose up -d api-server admin-web nginx
```

## 预览频道规划

```bash
sudo docker compose run --rm api-server node /app/scripts/decorate-community-server.js --platform=both --dry-run
```

## 预览清理旧频道

旧的 KOOK / Discord 默认频道不会自动删除。需要先预览，确认只会删除无用旧频道后再正式清理：

```bash
sudo docker compose run --rm api-server node /app/scripts/decorate-community-server.js --platform=both --dry-run --cleanup-old
```

## 正式装饰 Discord 和 KOOK

```bash
sudo docker compose run --rm api-server node /app/scripts/decorate-community-server.js --platform=both --cleanup-old
sudo docker compose restart api-server discord-bot kook-bot nginx
```

脚本会尝试给不同频道写入权限：

- 服务价目 / 店内导航 / 公告 / 活动 / 福利：公开只读
- 客服接待 / 投诉 / 售后：公开可沟通
- AI 派单 / 人工派单 / XP 接单语音：管理员和陪玩可见
- 充值审核 / 提现审核 / 管理提醒：管理员可见
- 考核频道 / 考核语音：管理员和考核相关身份可见
- VIP 专属频道：管理员和 VIP / 高等级客户可见

如果某些角色 ID 没有写进 `.env`，对应权限会跳过，需要先在 KOOK / Discord 创建身份组并填写环境变量。

## 只装饰 Discord

```bash
sudo docker compose run --rm api-server node /app/scripts/decorate-community-server.js --platform=discord
sudo docker compose restart discord-bot
```

## 只装饰 KOOK

```bash
sudo docker compose run --rm api-server node /app/scripts/decorate-community-server.js --platform=kook
sudo docker compose restart kook-bot
```

## 发布频道说明卡

说明卡会在频道里发消息。建议只第一次执行时加：

```bash
sudo docker compose run --rm api-server node /app/scripts/decorate-community-server.js --platform=both --post-guides
```

如果已经发过说明卡，不要重复加 `--post-guides`，避免刷屏。

## 注意事项

- Discord Bot 需要管理频道、查看频道、发送消息、管理身份组等权限。
- KOOK Bot 需要频道管理、发送消息、角色管理等权限。
- KOOK 的频道分组能力不如 Discord 稳定，脚本主要通过频道命名和说明卡统一结构。
- 真实 Token 只填服务器 `/opt/companion-play-system/.env`，不要写进 GitHub。
