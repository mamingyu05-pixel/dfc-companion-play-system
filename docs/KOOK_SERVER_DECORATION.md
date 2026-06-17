# May猫饼 KOOK 服务器装饰与角色初始化

## 目标

用脚本完成 KOOK 服务器基础运营配置：

- 创建或复用管理员、客服、陪玩、客户、未下单客户角色。
- 创建或复用 `猫饼会员 Lv.1 - Lv.15`。
- 创建或复用 `霓虹贵宾`、`May名人堂` 两个特殊等级。
- 给站长 KOOK 账号授予 `总管理` 和 `管理员` 角色。
- 可选：把核心频道改成更适合运营的命名和主题说明。
- 可选：向客服、派单、充值、提现、投诉、管理频道发送排版说明。
- 输出 `.env` 需要填写的 KOOK 角色 ID。

## 前置条件

1. Bot 已加入 KOOK 服务器。
2. Bot 有管理角色、查看频道、发送消息权限。
3. Bot 自己的角色在 KOOK 角色列表里要排在业务角色上方，否则不能给别人授予这些角色。
4. `/opt/companion-play-system/.env` 已填写：

```env
KOOK_TOKEN= # gitleaks:allow placeholder only, fill real token on server
KOOK_GUILD_ID=3189962583916682
KOOK_SUPPORT_CHANNEL_ID=3837107038599119
KOOK_DISPATCH_CHANNEL_ID=5136741567563919
KOOK_RECHARGE_CHANNEL_ID=9140297266909870
KOOK_WITHDRAWAL_CHANNEL_ID=9129991787873274
KOOK_COMPLAINT_CHANNEL_ID=4415787423661108
KOOK_ADMIN_CHANNEL_ID=3554887069392377
```

站长 KOOK 用户 ID：

```text
1481361693
```

## 服务器执行步骤

```bash
cd /opt/companion-play-system
sudo git pull origin main
sudo docker compose build api-server
sudo docker compose run --rm api-server node /app/scripts/decorate-kook-server.js 3189962583916682 1481361693 --decorate-channels --post-welcome
```

以后如果只想修角色分组，不想再次刷频道说明，去掉 `--post-welcome`：

```bash
sudo docker compose run --rm api-server node /app/scripts/decorate-kook-server.js 3189962583916682 1481361693 --decorate-channels
```

如果还有其他管理员或真人客服，也可以追加 KOOK 用户 ID：

```bash
sudo docker compose run --rm api-server node /app/scripts/decorate-kook-server.js 3189962583916682 1481361693 --admin-user-id 另一个管理员ID --support-user-id 客服ID
```

脚本输出的 `KOOK_...ROLE_ID=...` 复制到服务器 `.env`。

```bash
sudo nano .env
```

保存后重启：

```bash
sudo docker compose restart api-server kook-bot nginx
```

## 推荐角色顺序

KOOK 客户端进入：

```text
服务器设置 -> 角色权限
```

从上到下拖成：

```text
May猫饼客服 Bot 的角色
👑 总管理
🛡️ 管理员
💬 May客服
🎮 认证陪玩
👑 May名人堂
💎 霓虹贵宾
🐾 猫饼会员 Lv.15
🐾 猫饼会员 Lv.14
🐾 猫饼会员 Lv.13
🐾 猫饼会员 Lv.12
🐾 猫饼会员 Lv.11
🐾 猫饼会员 Lv.10
🐾 猫饼会员 Lv.9
🐾 猫饼会员 Lv.8
🐾 猫饼会员 Lv.7
🐾 猫饼会员 Lv.6
🐾 猫饼会员 Lv.5
🐾 猫饼会员 Lv.4
🐾 猫饼会员 Lv.3
🐾 猫饼会员 Lv.2
🐾 猫饼会员 Lv.1
🐾 猫饼客户
🌱 未下单客户
```

右侧成员列表会优先按角色顺序显示，所以管理员和客服要放在客户等级上方。

## 推荐频道视觉

脚本会尝试把已有频道改成：

```text
💬｜客服接待
📣｜人工派单
💳｜充值审核
💸｜提现审核
🧯｜投诉处理
🛎️｜管理提醒
```

这套结构参考成熟社群常见做法：客户入口简洁、运营频道分工明确、审核频道只给管理看、派单频道独立承接需求。

KOOK 如果不允许某些特殊符号，脚本会保留原频道并输出 warning，不会删除频道。

## 如果脚本报权限错误

常见错误：

```text
KOOK API HTTP 403
```

处理：

1. 打开 KOOK。
2. 服务器设置 -> 角色权限。
3. 找到 Bot 的角色。
4. 开启管理角色、查看频道、发送消息。
5. 把 Bot 角色拖到所有业务角色上方。
6. 重新运行脚本。

## 验证

1. KOOK 右侧列表里，站长 `mmy66#0961` 应显示管理员/总管理身份。
2. `May猫饼客服` Bot 应显示在 `May客服` 分组，不应只落在 `在线`。
3. 服务器设置里能看到会员等级角色。
4. 核心频道名称应变成 `💬｜客服接待`、`📣｜人工派单` 这种样式。
5. 客服、派单、充值、提现、投诉、管理频道里有对应说明消息。
6. 网站充值审核通过后，绑定 KOOK 的客户会自动获得对应会员等级。

## 右侧仍然显示在“在线”的原因

KOOK 右侧成员列表不会按昵称自动分类，只看角色：

1. 该成员有没有对应角色。
2. 该角色是否开启独立显示。
3. 该角色排序是否高于普通角色。
4. Bot 自己的角色是否高于它要授予的业务角色。

如果脚本运行后还是在 `在线`：

1. 到 `服务器设置 -> 角色权限`。
2. 点 `👑 总管理`、`🛡️ 管理员`、`💬 May客服`。
3. 确认开启类似 `与在线成员分开显示 / 独立显示` 的选项。
4. 把角色拖到推荐顺序。
5. 如果是某个真人客服没分类，重新运行脚本并追加：

```bash
sudo docker compose run --rm api-server node /app/scripts/decorate-kook-server.js 3189962583916682 1481361693 --support-user-id 这个客服的KOOK用户ID
```

## 注意

- 脚本不会改余额、订单、提现、退款。
- 脚本可以重复运行，已存在角色会复用。
- `--post-welcome` 会再次发送频道说明，重复运行会刷屏；只建议首次使用。
