# KOOK / Discord 账号绑定与订单追踪流程

## 结论

KOOK OAuth 如果因为域名备案或审核原因暂时接不进来，系统仍然可以运营：

- 用户可以先用邮箱注册网站账号。
- 用户在网站个人设置生成 KOOK 或 Discord 绑定码。
- 用户在 KOOK / Discord 客服机器人私聊或客服接待频道发送 `绑定 绑定码`。
- Bot 消费绑定码后，把平台账号 ID 写入 `user_external_accounts`。
- 后台用户管理会显示 KOOK / Discord 是否已绑定。
- KOOK / Discord 中产生的客服记录、派单草稿、报名和订单可以关联到网站用户。

## 用户操作流程

1. 用户登录网站：`https://maycatplay.com/customer/`
2. 进入个人设置：`https://maycatplay.com/customer/settings`
3. 点击生成 `KOOK 绑定码` 或 `Discord 绑定码`
4. 在对应平台发送：

```text
绑定 ABCD1234
```

5. Bot 回复绑定成功后，后台即可识别该平台用户。

绑定码有效期 10 分钟。过期后重新生成即可。

## 后台追踪逻辑

已绑定用户：

- `users` 是网站统一账号。
- `user_external_accounts` 保存 KOOK / Discord 平台账号 ID。
- 平台消息、派单草稿和报名可以回写到具体 `userId`。

未绑定用户：

- KOOK / Discord 仍然可以进入客服与派单流程。
- `order_drafts` 会记录 `sourcePlatform`、`customerPlatformUserId`、`customerDisplayName`。
- 后台可以看到平台来源和昵称，但不能直接归属到网站余额钱包。
- 转正式订单、扣余额、充值、提现前，必须要求用户完成网站注册和平台绑定。

## 为什么不完全依赖 KOOK OAuth

KOOK OAuth 可能要求国内合法域名和备案审核。当前项目域名面向海外和国内混合市场，使用绑定码更稳：

- 不受 KOOK OAuth 审核阻塞。
- 不需要让用户把密码或验证码发给客服。
- 可以同时支持 KOOK 和 Discord。
- 后续 KOOK OAuth 审核通过后，可以保留绑定码作为备用方案。

## 频道内网站入口

KOOK / Discord 频道规则卡建议固定展示：

```text
Website: https://maycatplay.com/customer/
Account binding: https://maycatplay.com/customer/settings
```

所有下单、派单、充值、提现、投诉，最终都以网站后台记录为准。
