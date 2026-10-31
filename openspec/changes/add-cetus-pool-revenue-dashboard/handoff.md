# 实施交接：Cetus USDC/SUI 池子收入看板

你要在本仓库里从零实现一个本地运行的收入看板：一个采集进程把链上和接口数据写进 SQLite，一个 Node HTTP 服务按需计算指标，一个静态页面按原型展示。仓库里目前没有应用代码。

## 1. 先读这些文件（按顺序）

都在 `openspec/changes/add-cetus-pool-revenue-dashboard/` 下：

1. `proposal.md`：做什么、不做什么。
2. `specs/clmm-pool-data/spec.md`：采集什么、怎么存、失败怎么处理。
3. `specs/pool-revenue-metrics/spec.md`：每个指标的口径和计算公式。**每个 Scenario 的数值就是单元测试的标准答案。**
4. `specs/pool-revenue-dashboard/spec.md`：页面上显示什么。
5. `design.md`：技术选择和已实测的接口事实。
6. `tasks.md`：按顺序执行的任务清单，每项都写了验证方法。
7. `prototype.html`：界面布局、文案、交互的标准。双击用浏览器打开。**里面的数字全是示例，不能当核对依据。**

## 2. 工作规则

- 按 `tasks.md` 的顺序做。每完成一项，先跑它写明的验证，通过后再把 `- [ ]` 改成 `- [x]`。
- **不得修改 specs 里的指标口径。** 如果真实数据和 spec 对不上，或者 spec 写的做不到，停下来，在 `design.md` 的 `## Open Questions` 一节记录现象和证据，然后告诉用户，等确认后再继续。
- 探查类任务（1.1）的结论写回 `design.md` 对应的风险项。
- 不要改 `scratch/` 下的文件，它们是口径核对的参照。
- 做完第 4 组（采集）和第 5 组（指标）后各停一次，请用户检查。这两组错了页面照样能显示数字，后面很难发现。
- 1.1（连续采样 3 小时）和 7.1（连续运行 48 小时）不要在会话里阻塞等待：写好脚本，告诉用户怎么启动，等用户把结果给你再分析。

## 3. 运行环境

- Windows + Git Bash，Node v24.14.0。
- **直连外网会超时，所有外部请求必须走代理。** 运行命令前加环境变量：
  `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 node ...`
  代理偶尔会重置 TLS 连接，所有请求都要带指数退避重试（参考 `scratch/fetch.mjs` 开头的 `fetch` 包装）。
- **不要装 npm 依赖。** npm 没有配置代理，安装可能失败。只用 Node 内置模块：`fetch`、`node:sqlite`（会打印 ExperimentalWarning，正常）、`node:http`、`node:test`。
- 前端不引入图表库，直接复用 `prototype.html` 里的 SVG 绘图函数（`bars`、`liqChart`），把示例数据换成 API 返回的数据。
- Sui JSON-RPC 已下线，只能用 GraphQL。

## 4. 常量

| 名称 | 值 |
|---|---|
| 监测池 USDC/SUI 0.25% | `0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105` |
| Cetus GlobalConfig | `0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f` |
| CETUS 定价池 USDC/CETUS 0.25% | `0x3b13ac70030d587624e407bbe791160b459c48f1049e04269eb8ee731f5442b4` |
| 小数位 | USDC 6，SUI 9，CETUS 9 |
| tick_spacing | 60（从链上读，不要写死在计算里） |
| 每日边界 | UTC+8，做成配置项 |

## 5. 数据源（都已实测可用）

**Sui GraphQL**：`POST https://graphql.mainnet.sui.io/graphql`，body 为 `{"query": "..."}`。

一个整点快照用一个请求取全：checkpoint 时间、监测池、GlobalConfig、CETUS 定价池，四者在同一个 checkpoint 上。下面的查询已在 30 天前的 checkpoint 上实测成功：

```graphql
{
  c: checkpoint(sequenceNumber: CP) { sequenceNumber timestamp }
  pool: object(address: "0xb8d7…0105", atCheckpoint: CP) { asMoveObject { contents { type { repr } json } } }
  cfg: object(address: "0xdaa4…3d8f", atCheckpoint: CP) { asMoveObject { contents { json } } }
  cetus: object(address: "0x3b13…42b4", atCheckpoint: CP) { asMoveObject { contents { type { repr } json } } }
}
```

- 当前最新 checkpoint：`{ checkpoint { sequenceNumber timestamp } }`。
- 每小时约 15,275 个 checkpoint，用它粗估后再按 `timestamp` 二分，找"时间戳 ≤ 整点的最后一个 checkpoint"（tasks 4.1）。
- `pool.json` 的字段格式（实测）：
  - `current_sqrt_price`、`liquidity`、`fee_rate`、`fee_growth_global_a/b`、`coin_a/b` 都是**字符串**，大数一律用 `BigInt`。
  - `tick_spacing` 是数字。
  - `current_tick_index` 是对象 `{ "bits": 69963 }`，`bits` 是无符号 32 位数，要先转成有符号数。
  - `rewarder_manager.rewarders[]` 每项有 `reward_coin`（字符串，**不带 `0x` 前缀**，如 `06864a6f…::cetus::CETUS`）、`emissions_per_second`（字符串，Q64.64）、`growth_global`。
- `cfg.json.protocol_fee_rate` 是字符串，当前 `"2000"`。
- `type.repr` 用来校验币种顺序，例如 `…::pool::Pool<…::usdc::USDC, …::cetus::CETUS>`。

**Cetus 统计**：`GET https://api-sui.cetus.zone/v3/sui/clmm/stats_pools?pool=<池地址>`
- 参数必须是 `pool=`。写成 `pools=` 会被忽略，返回全部 4.5 万个池子。
- 取 `data.list[0]`，先校验它的 `pool` 等于监测池；再从 `stats` 里取 `dateType === "24H"` 的 `vol`、`fee`（十进制字符串）。

**GeckoTerminal 小时 K 线**：
`GET https://api.geckoterminal.com/api/v2/networks/sui-network/pools/<池地址>/ohlcv/hour?aggregate=1&currency=usd&token=quote&limit=1000`
- `data.attributes.ohlcv_list` 每项是 `[开始时间(秒), 开, 高, 低, 收, 美元成交量]`，**最新的在前**。价格是 SUI 的美元价格。
- `limit` 最大 1,000（约 41 天），超过返回 400。更早的数据加 `&before_timestamp=<秒>` 翻页。
- 开始时间按 UTC 整点对齐。最新一根还没走完，下一小时会变。
- 免费接口约每分钟 30 次，两次请求之间间隔 2 秒以上。
- 不要用池子信息接口里的 `volume_usd.h24`，它和 Cetus 对不上。

## 6. 容易写错的地方

- **价格方向**：Cetus 的原始价格是 coin_b / coin_a，即每个 USDC 值多少 SUI。SUI 的美元价格 = 1000 ÷ (sqrt_price ÷ 2^64)²。**tick 越大，SUI 越便宜。** 所以"价格上沿"对应较小的 tick。
- **向外对齐区间**（示例仓位）：tick(P) = ln(1000/P) ÷ ln(1.0001)。上沿 Pb 用 `floor(tick(P×(1+w)) / 60) × 60`，下沿 Pa 用 `ceil(tick(P×(1−w)) / 60) × 60`。
- **tick 符号**：`bits >= 2**31 ? bits - 2**32 : bits`。tick 段下界用 `Math.floor(tick / 60) * 60`，负数也必须向下取整，不能用 `Math.trunc` 或 `|0`。
- **Q64.64**：先用 BigInt 做减法，结果再转成 Number 除以 2^64。`fee_growth_global` 相减要 wrapping：`(b - a + 2n**128n) % 2n**128n`。
- **小数位**：fga 那一侧（USDC）除以 10^6，fgb 那一侧（SUI）除以 10^9，`emissions_per_second` 除以 2^64 再除以 10^9。
- **UTC+8 自然日**：用毫秒时间戳加减 8 小时来算，不要依赖机器本地时区的 `Date` 方法。D 日对应的 K 线开始时间是 UTC D−1 日 16:00 到 D 日 15:00。
- **禁止用"ΔfeeGrowth × 快照 liquidity"算手续费。** 快照 L 一周内能差约 100 倍，这样算会高估约 14 倍。全池手续费只来自 Cetus 统计或 K 线成交量。
- **每小时数据的对应关系**：小时 h 用整点快照 h 和 h+1 的差值，以及开始时间为 h 的那根 K 线。
- K 线地址里的 `token=quote` 固定不变，不再用收盘价和快照价的差异拒绝写入。CETUS 定价池写入前要校验 `type.repr` 里的币种顺序。

## 7. 建议的目录结构

```
app/
  config.js          常量和地址
  lib/http.js        带代理重试的 fetch、gql()
  lib/db.js          node:sqlite 建表和读写
  lib/math.js        Q64、wrapping、tick 解码、价格、区间对齐、L ↔ 币量
  collect/*.js       快照、Cetus 统计、K 线、补采、定时运行
  metrics/*.js       各个指标，纯函数，输入是数据库里的行
  server.js          node:http：/api/* 返回 JSON，/ 返回 public/index.html
  public/index.html  由 prototype.html 改成读取 API
  test/*.test.js     node --test
```

`app/README.md`（tasks 6.4）里写清三条命令：首次回补、启动采集和服务、跑测试。

## 8. 测试的标准答案

全部来自 `specs/pool-revenue-metrics/spec.md` 的 Scenario，单元测试直接用：价格 ≈ 0.9156；费率 0.25% / 20% / 0.20%；bits 4294967235 → −61；tick 段 [69960, 70020)，整段约 25,926 USDC 或 28,392 SUI；LP 净额 10,620.67；核对偏差约 0.03%；每日手续费 14,757.15；重叠比例 75.5%；单日示例仓位约 10.42 USDC；24h 示例仓位 ±1% 约 96.6、±10% 约 34.9；CETUS 价格 ≈ 0.021008。

需要用真实数据核对的项目，tasks 里已经写了用哪个 scratch 文件或外部来源对照。

## 9. 完成标准

- `tasks.md` 全部勾选。
- `node --test` 全部通过。
- `openspec validate add-cetus-pool-revenue-dashboard --strict` 通过。
- 页面和 `prototype.html` 的布局、文案、交互一致，所有数字来自真实数据。用户可以拿当前价格、费率、激励发放量和 Cetus 官网的池子页面对照。
