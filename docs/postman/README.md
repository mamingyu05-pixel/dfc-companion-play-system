# Postman 运营工具包

这个目录用于保存 May猫饼电竞的 Postman 测试工具。文件里不应该保存真实密码、Token、验证码。

## 导入步骤

1. 打开 Postman。
2. 点击左上角 `Import`。
3. 导入 `docs/postman/maycatplay-ops.postman_collection.json`。
4. 再导入 `docs/postman/maycatplay-production.postman_environment.json`。
5. 右上角环境选择 `May猫饼 Production`。

## 第一次使用

1. 打开 `登录 / 管理员登录并保存 Token`。
2. Body 里填写你的管理员邮箱和密码。
3. 点击 `Send`。
4. 返回 `200` 或 `201` 后，脚本会自动把 `accessToken` 存到环境变量 `admin_token`。
5. 打开 `登录 / 检查当前管理员身份`，点击 `Send`，确认返回你的管理员账号。

## 常用操作

- 查询用户：`用户管理 / 查询用户列表`
- 给客户加余额：先把客户 `id` 填到环境变量 `target_user_id`，再执行 `给客户增加余额`
- 扣减客户余额：先填 `target_user_id`，再执行 `扣减客户余额`
- 把误注册客户设为管理员：先填 `target_user_id`，再执行 `把已有用户设为管理员`
- 审核充值：先查询充值申请，把充值申请 `id` 填到环境变量 `recharge_id`，再执行通过或拒绝

## 安全注意

- 不要把 `admin_token` 发给任何人。
- 不要把真实密码保存进 Git。
- 手动加余额、扣余额都只用于人工审核和冲正，正常充值优先走后台充值审核。
- 用完公共电脑后，清空 Postman 环境里的 `admin_token`。
