# 微信客户登录代码与验收边界

本次代码基于 `34eedd357bfc676ec4adf7147ee3714b130704ff` 工作树，新增微信客户登录。默认仍为模拟模式，未配置真实凭据、登录真实账户、应用数据库迁移或发布。源码实现不代表平台联调完成。

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

新增 `20261017090000_wechat_customer_identity` 迁移和 `WechatIdentity` schema。服务采用参数化 SQL 访问新身份表，与现有限流表做法一致；源码编译不依赖立即生成新 Prisma delegate。部署时仍须先应用迁移并按项目流程生成客户端。迁移尚未执行，真实数据库事务和并发行为尚未验收。新微信账户没有可用密码凭据；已有网页账户绑定/合并不在本次实现中。

AppSecret、code、session_key 不写日志、不回传页面、不持久保存；session_key 和 UnionID 在换码后丢弃。公开错误不转发上游原文或带凭据 URL。客户端 token 不进入 setData 或本地存储。退出仅清除本机自有会话，服务端已签发 JWT 在到期前仍按现有 JWT 规则有效。

支付 provider 保持 `UnconfiguredPaymentProvider`。本入口明确返回 `payment: NOT_CONNECTED` 和 `nativeOrdering: NOT_CONNECTED`，没有 `wx.requestPayment`、真实下单或对外通知。

离线回归：`node --max-old-space-size=192 scripts/wechat-auth-offline.test.cjs`；现有原生回归为 `node apps/miniapp-native/ui-logic.test.cjs` 和 `node apps/miniapp-native/verify.cjs`。测试仅用合成输入和内存替身，不启动数据库、服务器、子进程或真实网络；服务代码在内存中转译并执行，不能替代全量类型检查、Nest/PG 集成或微信 IDE/真机验收。

重型构建、迁移、全量集成与当前版本视频需等待外贸任务释放资源，并获得新的具体运行窗口。迁移库存已增加到 32；任何后续运行需为当前源码重新封存清单，旧窗口已消耗，原 `spawn EPERM` 不重试、不绕过。已有视频及旧 dist 不能证明本版本运行成功。

官方接口依据（2026-10-17 获取，返回内容缓存时间为 2026-10-15/16）：[登录流程](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)、[wx.login](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html)、[code2Session](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session)。
