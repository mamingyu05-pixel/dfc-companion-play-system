# May猫饼 KOOK 角色与会员等级配置

## 目标

- 管理员和客服显示在 KOOK 右侧成员列表最上方。
- 客户按累计审核通过充值金额自动获得 `猫饼会员 Lv.1 - Lv.15`，高额客户进入 2 个特殊等级。
- 未完成首单的客户自动获得 `🌱 未下单客户` 标签，完成首单后自动撤销。
- 等级不按当前余额计算，避免客户下单消费后掉级。

## 推荐角色顺序

在 KOOK `服务器设置 -> 角色权限` 里按这个顺序从上到下拖动：

```text
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
🌱 未下单客户
🌱 新人
```

KOOK 右侧列表优先按角色顺序显示，所以管理员、客服要放在会员等级上方。

## 等级门槛

```text
Lv.1   累计充值 ¥100
Lv.2   累计充值 ¥300
Lv.3   累计充值 ¥500
Lv.4   累计充值 ¥1000
Lv.5   累计充值 ¥2000
Lv.6   累计充值 ¥3000
Lv.7   累计充值 ¥5000
Lv.8   累计充值 ¥8000
Lv.9   累计充值 ¥12000
Lv.10  累计充值 ¥20000
Lv.11  累计充值 ¥30000
Lv.12  累计充值 ¥50000
Lv.13  累计充值 ¥70000
Lv.14  累计充值 ¥90000
Lv.15  累计充值 ¥120000
霓虹贵宾     累计充值 ¥200000
May名人堂    累计充值 ¥500000
```

## 自动同步规则

1. 客户提交充值申请。
2. 管理员审核通过。
3. 系统统计该客户所有 `APPROVED` 充值申请金额。
4. 系统计算会员等级。
5. 如果客户已经绑定 KOOK，系统撤销旧会员等级角色并授予新等级角色。
6. 如果没有绑定 KOOK，网站个人设置仍会显示等级；绑定 KOOK 后下一次充值审核会同步角色。
7. 如果客户没有完成过订单，系统授予 `未下单客户` 角色；完成首单后自动撤销。

管理员人工加减余额不计入会员等级，避免把测试调账、纠错调账误算成充值。

## `.env` 配置

创建角色后，把每个角色 ID 填到服务器 `/opt/companion-play-system/.env`：

```env
KOOK_CUSTOMER_LEVEL_1_ROLE_ID=
KOOK_CUSTOMER_LEVEL_2_ROLE_ID=
KOOK_CUSTOMER_LEVEL_3_ROLE_ID=
KOOK_CUSTOMER_LEVEL_4_ROLE_ID=
KOOK_CUSTOMER_LEVEL_5_ROLE_ID=
KOOK_CUSTOMER_LEVEL_6_ROLE_ID=
KOOK_CUSTOMER_LEVEL_7_ROLE_ID=
KOOK_CUSTOMER_LEVEL_8_ROLE_ID=
KOOK_CUSTOMER_LEVEL_9_ROLE_ID=
KOOK_CUSTOMER_LEVEL_10_ROLE_ID=
KOOK_CUSTOMER_LEVEL_11_ROLE_ID=
KOOK_CUSTOMER_LEVEL_12_ROLE_ID=
KOOK_CUSTOMER_LEVEL_13_ROLE_ID=
KOOK_CUSTOMER_LEVEL_14_ROLE_ID=
KOOK_CUSTOMER_LEVEL_15_ROLE_ID=
KOOK_CUSTOMER_SPECIAL_NEON_ROLE_ID=
KOOK_CUSTOMER_SPECIAL_HALL_ROLE_ID=
```

基础角色仍然使用：

```env
KOOK_CUSTOMER_ROLE_ID=
KOOK_CUSTOMER_NO_ORDER_ROLE_ID=
KOOK_COMPANION_ROLE_ID=
KOOK_ADMIN_ROLE_ID=
KOOK_SUPER_ADMIN_ROLE_ID=
KOOK_SUPPORT_ROLE_ID=
```

## 部署

```bash
cd /opt/companion-play-system
sudo git pull origin main
sudo docker compose up -d --build api-server customer-web nginx
sudo docker compose restart api-server customer-web nginx
```

本次功能不需要新增数据库迁移。

## 验证

1. 客户绑定 KOOK。
2. 客户提交充值申请。
3. 管理员审核通过。
4. 打开客户个人设置，确认显示会员等级和累计充值。
5. 打开 KOOK 右侧成员列表，确认客户获得对应 `猫饼会员 Lv.x` 或特殊等级。
6. 未完成首单的客户应有 `未下单客户` 角色；完成首单后该角色应自动撤销。

如果网站显示等级但 KOOK 没变，优先检查：

- `KOOK_TOKEN` 是否正确。
- Bot 是否有角色管理权限。
- Bot 自己的角色是否排在会员等级角色上方。
- `KOOK_CUSTOMER_LEVEL_X_ROLE_ID` 是否填错。
- `KOOK_CUSTOMER_SPECIAL_NEON_ROLE_ID` / `KOOK_CUSTOMER_SPECIAL_HALL_ROLE_ID` 是否填错。
- `KOOK_CUSTOMER_NO_ORDER_ROLE_ID` 是否填错。
- 客户是否已经绑定 KOOK。
