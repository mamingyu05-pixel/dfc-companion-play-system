# AI 派单频道与陪玩标签

本功能用于让 KOOK / Discord 的 AI 客服在收集客户需求后，把派单信息发送到独立 AI 派单频道，并自动提醒对应的游戏陪玩标签和声线标签。

## 频道

- Discord AI 派单频道环境变量：`DISCORD_AI_DISPATCH_CHANNEL_ID`
- KOOK AI 派单频道环境变量：`KOOK_AI_DISPATCH_CHANNEL_ID`

如果这两个变量没有配置，系统会自动退回到原来的人工派单频道：

- Discord：`DISCORD_DISPATCH_CHANNEL_ID`
- KOOK：`KOOK_DISPATCH_CHANNEL_ID`

## 声线标签

为了避免直接使用“男 / 女”这种过于直白的分类，后台和社群统一使用体验型标签：

- `🌙 月影声线`：柔和、甜、女声类偏好
- `☀️ 曜刃声线`：沉稳、低音、男声类偏好

后台添加陪玩时可选择声线标签。社群里需要给陪玩手动挂对应角色，或后续接入自动同步。

## 游戏标签

当前派单提醒支持以下游戏角色：

- `三角洲行动组`
- `英雄联盟组`
- `无畏契约组`
- `CS2组`
- `PUBG组`
- `Apex组`
- `王者荣耀组`
- `和平精英组`

派单时系统会按订单草稿里的 `game` 字段自动 @ 对应游戏组。

## 服务器执行步骤

### Discord

```bash
cd /opt/companion-play-system
sudo git pull origin main
sudo docker compose build api-server discord-bot
sudo docker compose run --rm api-server node /app/scripts/setup-discord-server.js DISCORD服务器ID --decorate-channels --post-welcome
```

脚本会输出：

```bash
DISCORD_AI_DISPATCH_CHANNEL_ID=...
DISCORD_COMPANION_ROLE_ID=...
DISCORD_VOICE_MOON_ROLE_ID=...
DISCORD_VOICE_SOLAR_ROLE_ID=...
DISCORD_GAME_DELTA_FORCE_ROLE_ID=...
...
```

把输出复制到 `/opt/companion-play-system/.env`，然后执行：

```bash
sudo docker compose restart api-server discord-bot nginx
```

### KOOK

```bash
cd /opt/companion-play-system
sudo git pull origin main
sudo docker compose build api-server kook-bot
sudo docker compose run --rm api-server node /app/scripts/setup-kook-channels.js KOOK服务器真实ID
sudo docker compose run --rm api-server node /app/scripts/decorate-kook-server.js KOOK服务器真实ID --decorate-channels --post-welcome
```

把脚本输出的 `KOOK_AI_DISPATCH_CHANNEL_ID`、游戏角色和声线角色复制到 `.env`，然后执行：

```bash
sudo docker compose restart api-server kook-bot nginx
```

## 日常运营规则

1. 新陪玩通过考核后，先在后台创建陪玩资料。
2. 在 KOOK / Discord 给该陪玩挂：
   - `认证陪玩`
   - 对应游戏组角色
   - 对应声线标签角色
3. 客户在客服频道说需求后，AI 会整理成订单草稿。
4. 系统把草稿发到 AI 派单频道，并 @ 对应标签。
5. 陪玩报名后，后台订单/试音派单页面继续跟进，最终由管理员确认。

## 陪玩报名格式

陪玩报名不是只点一下按钮，必须给老板可选择的信息。

推荐格式：

```text
报名 TRY编号 段位/水平，报价，可服务时间，性格优势，是否可试音，其他备注
```

示例：

```text
报名 TRY202606150001ABC 三角洲烽火钻石，100/h，今晚2小时，稳健报点不压力，可试音，擅长带新人摸金
```

Discord 支持点击派单卡片的“填写报名信息”按钮，会弹窗让陪玩填写自由介绍。

KOOK 暂按频道文字报名处理，陪玩在 AI 派单或人工派单频道发送以上格式即可。

### KOOK 报名说明

KOOK 的卡片按钮不等同于 Discord 的弹窗表单。点击“我要报名”后，Bot 会在频道里提示陪玩继续发送完整报名信息。后台只记录带 TRY 编号和介绍文本的报名，避免出现空报名。

如果后台候选人数仍为 0，优先检查：

1. 点击/发送报名的人是否已绑定 KOOK 外部账号。
2. 该网站账号是否是 `COMPANION`。
3. 陪玩资料是否已上架 `LISTED`。
4. 陪玩资料的游戏是否和派单草稿 `game` 一致。
5. 报名文本是否包含正确的 `TRY` 草稿编号。

### 流单处理

客服派单台支持把长时间无人报名、客户失联或需求取消的草稿标记为“流单”。当前实现使用 `CANCELLED` 状态关闭草稿，并在备注和 `admin_logs` 里记录 `FAIL_ORDER_DRAFT`，避免继续转正式订单。

## 当前边界

- 当前版本是“按角色标签提醒”，不是自动判断每个陪玩的实时空闲状态。
- 如果陪玩没有挂游戏角色，AI 派单不会提醒到他。
- 如果客户没说声线偏好，只会提醒游戏组，不会提醒声线组。
- 资金、余额、提现仍必须走网站后台，频道消息只做提醒和协作。
