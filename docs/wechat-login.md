# 微信客户登录代码与验收边界

本文件记录最初基于 `34eedd357bfc676ec4adf7147ee3714b130704ff` 保存的微信登录原型。2026-10-27核对：包含该源码的网页/API版本已在Windows本机发布，37项数据库迁移已应用并包含微信身份表；真实微信配置仍未启用，尚无真实账户或真机验收。默认模拟及原生订单/支付未接通的边界保持。

| 模式 | 配置 | 可用行为 |
| --- | --- | --- |
| `simulation` | 默认；`baseUrl` 为空 | 内存模拟订单和余额；不调用登录、网络或支付 |
| `isolated-api` | `environment: isolated-test`；已授权的本机回环地址 | 保留原 TEST 配对、报价、订单流程；临时身份不是微信身份 |
| `wechat-api` | `environment: wechat`；经批准的 HTTPS 域名 `/api` 地址；与 project.config.json 一致的 `appId` | 用户点击后登录并核验 `/auth/me`；订单、充值与微信支付显示未接通 |

模式在 `apps/miniapp-native/api-config.js` 明确选择，不会因请求失败自动切换或回退成模拟成功。真实模式不显示 TEST 地址和下单控件；可编辑的 TEST 地址不能成为微信登录目的地。所有会话仅驻内存，页面退出会清除；微信会话有效期为一小时，过期需重新登录。没有刷新令牌或持久 token。

服务端配置项为 `WECHAT_LOGIN_ENABLED=1`、`WECHAT_MINIAPP_APP_ID`、`WECHAT_MINIAPP_APP_SECRET` 和现有 `JWT_SECRET`（至少 32 字符，无空白）。此文档仅定义配置契约，未写入任何配置或凭据。缺少配置时返回未就绪；TEST、隔离数据库、合成测试身份或禁止出站模式均拒绝真实登录。不修改隔离运行器的出站限制。生产接入仍需平台合法请求域名、正确的 AppID、服务端凭据及允许真实登录的明确操作范围。

接口链路：

1. `GET /api/auth/wechat/config` 只返回是否已配置、公开 AppID 和未接通能力标记，不代表上游连通性。
2. 原生端核对运行中小程序 AppID，再调用 `wx.login` 取得一次性 code。
3. `POST /api/auth/wechat/login` 受现有 IP 限速保护，仅接受 `{code}`；服务端固定调用微信 HTTPS `jscode2session`，五秒超时、禁止重定向，不重试 code。
4. 后端只采用微信验证后的 AppID+OpenID。首次登录在同一事务创建独立 CUSTOMER、零余额钱包及身份映射；并发唯一冲突后回查胜出身份。不会按邮箱、昵称、UnionID 或客户端用户 ID 自动合并已有账户。
5. 拒绝禁用账户及非 CUSTOMER；签发一小时 HS256 JWT。原生端再用该 JWT 调用现有 `/auth/me`，身份匹配才采纳会话。

新增 `20261017090000_wechat_customer_identity` 迁移和 `WechatIdentity` schema。服务采用参数化 SQL 访问新身份表，与现有限流表做法一致；源码编译不依赖立即生成新 Prisma delegate。部署时仍须先应用迁移并按项目流程生成客户端。当前本机37项迁移已完成并含本迁移；这一状态不等于真实微信事务或并发行为已验收。新微信账户没有可用密码凭据；已有网页账户绑定/合并不在本次实现中。

AppSecret、code、session_key 不写日志、不回传页面、不持久保存；session_key 和 UnionID 在换码后丢弃。公开错误不转发上游原文或带凭据 URL。客户端 token 不进入 setData 或本地存储。退出仅清除本机自有会话，服务端已签发 JWT 在到期前仍按现有 JWT 规则有效。

支付 provider 保持 `UnconfiguredPaymentProvider`。本入口明确返回 `payment: NOT_CONNECTED` 和 `nativeOrdering: NOT_CONNECTED`，没有 `wx.requestPayment`、真实下单或对外通知。

离线回归：`node --max-old-space-size=192 scripts/wechat-auth-offline.test.cjs`；现有原生回归为 `node apps/miniapp-native/ui-logic.test.cjs` 和 `node apps/miniapp-native/verify.cjs`。测试仅用合成输入和内存替身，不启动数据库、服务器、子进程或真实网络；服务代码在内存中转译并执行，不能替代全量类型检查、Nest/PG 集成或微信 IDE/真机验收。

2026-10-17隔离运行器的临时资源窗口、32项库存和 `spawn EPERM` 是旧时段记录。本机通用API/网页后来已有独立构建、37项迁移与回归回执，见[当前索引](CURRENT_CHECKOUT_AND_ACCEPTANCE.md)；这些结果不覆盖该原生运行器的限制，也不授权重试或绕过其旧阻断。当前视频、真机与真实微信行为仍须绑定对应源码分别验收。

官方接口依据（2026-10-17 获取，返回内容缓存时间为 2026-10-15/16）：[登录流程](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)、[wx.login](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html)、[code2Session](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session)。
