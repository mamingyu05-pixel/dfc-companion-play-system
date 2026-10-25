# 陪玩目录接口与分页兼容

`GET /api/orders/public/companions` 和原 CUSTOMER 权限的 `GET /api/orders/companions` 共用数据库聚合与筛选。

- 显式传入 `page`、`limit`、`sort` 中任一个即启用分页，返回 `{ companions, total, page, limit }`；页码默认 1，每页默认 24，最多 60。超过末页仍返回筛选后的 `total` 和空数组。
- 三个参数全部省略时，保留完整数组响应一个兼容版本，不隐式截断旧客户端和选择框。
- `sort=recommended|rating|orders|price`。推荐依次按在线、实名、评分、非测试完成单量排序；评分按评分、完成单量排序；单量按完成单量、评分排序；价格从低到高。每种排序最后都按唯一用户 `id` 升序，暂无评分排在有评分之后。
- `filter=all|online|voice|recommended|newbie|high-rank` 在数据库内筛选后计数分页。高段位按真实枚举 `DIAMOND/ASCENDANT/IMMORTAL/TOP`（钻石及以上）筛选，修正原页面对英文枚举使用中文正则而无法匹配的问题；其余条件沿用原页面语义。`q` 是昵称或展示名的字面子串，不解析通配符，最长 80 字符；`game` 保留原游戏资质过滤。
- `averageRating` / `rating` 与 `reviewCount` 仅计算未隐藏评价，沿用旧版本包含可见测试单评价的口径；`completedOrders` 仅计 `COMPLETED AND isTest=false`。评价预览最多每人 20 条，按创建时间和唯一评价 ID 倒序。
- 列表以单条参数化 SQL 完成聚合、筛选、排序、分页、总数与安全公开字段投影；空结果也是一条 SQL。既有外部联系字段只公开平台和展示名，不返回账号 ID、邮箱或收款信息。

`GET /api/orders/public/companions/leaderboard?game=DELTA_FORCE` 独立返回按真实完成单量、评分、唯一 ID 排序的前 5 名轻量数组，无评价明细及外部联系信息。

`GET /api/orders/companions/options?game=DELTA_FORCE` 保留 CUSTOMER 认证和角色权限，返回完整在线可接单列表，不分页；只包含 `id`、`nickname`、`displayName`、`onlineStatus`、`pricePerHour`。上架及用户启用状态、游戏资质和活动服务订单冲突均在数据库过滤；来源于活动服务的争议单同样阻止接单。该接口供下单、保底与套餐选择框使用。

排序唯一键保证数据不变时连续分页不重不漏；在线状态、评分或价格等在翻页期间变化时，页码分页仍可能发生位置变化，刷新列表即可取得最新顺序。
