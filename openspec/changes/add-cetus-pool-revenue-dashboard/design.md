# Design

## Context

- 仓库里还没有应用代码，只有 `scratch/` 下的一次性脚本（Node.js，原生 `fetch`）。`fetch.mjs` 已验证用 GraphQL `object(address, atCheckpoint)` 可以取历史快照，约 15,275 个 checkpoint/小时。
- 本机 Node 版本 v24.14.0；直连外网会超时，必须走代理 `http://127.0.0.1:7897`，代理偶尔会重置 TLS 连接。
- Sui JSON-RPC 已下线。GraphQL 公共节点上 `object/atCheckpoint` 可查全部历史。
- Cetus 官方 SDK `@cetusprotocol/sui-clmm-sdk@1.4.9` 没有手续费汇总方法；它的 `getPoolTransactionList` 只是按 `affectedObject` 翻页拉交易。SDK 配置里有统计接口 `stats_pools`，实测 `https://api-sui.cetus.zone/v3/sui/clmm/stats_pools?pool=<池地址>` 能返回本池 24H / 7D / 30D 的成交量和手续费（2026-10-30 实测：24H vol 5,310,334、fee 13,275.84，正好等于 vol × 0.25%）。注意过滤参数必须是 `pool=`，用 `pools=` 会被忽略，返回全部池子。
- GeckoTerminal 小时 K 线（2026-10-31 实测）：`/pools/<池地址>/ohlcv/hour?aggregate=1&currency=usd&token=quote` 返回 SUI 的美元价格和美元成交量；单次最多 1,000 根（约 41 天），`limit` 超过 1,000 返回 400；K 线开始时间按 UTC 整点对齐，最近 1,000 根没有空缺；`before_timestamp` 可以翻页取更早的数据。最近 24 根 K 线的成交量之和 3,287,709，同时刻 `stats_pools` 24H vol 3,288,612，相差 0.03%。池子信息接口里的 `volume_usd.h24`（3,415,874）对不上，不要用。`currency=token` 返回的成交量只是按 K 线价格换算，不是按币种分开的原始数量。
- 不存在现成的"按币种分开的每日成交量"接口：Cetus `stats_pools` 只有美元 `vol`；Pool 对象上的 `fee_protocol_coin_a/b` 经常被提走清零（24 小时内 14 次），不能用来反推；Dune 的 `sui.events` 可以自己写 SQL 汇总，但要账号和 API key，用户决定不用。
- 教程里已经踩过的坑：快照 `liquidity` 一周内在 1.7e14 到 1.7e16 之间变化，用 ΔfeeGrowth × 快照 L 会把手续费高估约 14 倍。所以手续费改用成交量口径。
- 指标口径见 `specs/pool-revenue-metrics/spec.md`，本文不重复。

## Goals / Non-Goals

**Goals:**
- 一个人在本机就能跑起来：一个采集进程加一个本地网页。
- 采集逻辑以"池子配置"为单位，后续加池子时不改计算代码。
- 所有指标都可以从本地存储的原始数据重算，不依赖缓存好的中间结果。

**Non-Goals:**
- 不做公网部署、登录、多用户。
- 不做逐 tick 的流动性分布（`liquidity_net` 遍历），MVP 只用池子的 `liquidity` 字段。
- 不逐笔采集 SwapEvent。
- 不做实时（秒级）推送，整点更新即可。

## Decisions

### D1. 技术栈：Node.js + SQLite + 静态网页
- 采集和 API 用 Node.js（沿用 scratch 脚本的写法和代理配置 `NODE_USE_ENV_PROXY=1`）。
- 存储用 Node 24 内置的 `node:sqlite`，单文件，不需要额外安装数据库。
- 前端是一个静态 HTML 页面，图表直接复用 `prototype.html` 里的原生 SVG 绘图函数（已支持对数纵轴、断线、悬停明细）。由同一个 Node 进程提供静态文件和 JSON API。
- 不装任何 npm 依赖：本机 npm 没有配置代理，安装和 CDN 加载都可能失败。只用 Node 内置的 `fetch`、`node:sqlite`、`node:http`、`node:test`。
- 备选：Python + pandas（分析方便，但 scratch 已经是 Node）；PostgreSQL/时序库（MVP 数据量用不上）；ECharts 或 React（要联网安装或加载，原型的 SVG 已经够用）。

### D2. 数据流：采集 → 原始表 → 查询时计算
- 采集进程只写原始数据：`snapshots`（每整点一行，u128 存成十进制字符串）、`cetus_stats`（每整点一行，含原始 JSON）、`ohlcv`（每根小时 K 线一行，以 UTC 开始时间为主键）、`params`（协议抽成历史）、`prices`（激励代币整点价格）、`gaps`（失败时段）。
- 指标在 API 请求时从原始表计算。30 天的数据每张表只有约 720 行，按需计算足够快，也避免口径改了要重算缓存。
- 大整数计算用 `BigInt`，只在最后换算成展示用的浮点数。

### D3. 整点快照：按时间二分找 checkpoint
- 整点时间 → checkpoint 序号：先用 15,275 个/小时粗估，再用 `checkpoint(sequenceNumber)` 的时间戳二分修正到"时间戳 ≤ 整点的最后一个 checkpoint"。
- 同一个请求里取 Pool 对象和 GlobalConfig，保证参数和快照在同一 checkpoint。
- 备选：直接用粗估值（scratch 的做法）。误差可能有几分钟，会让 24 小时窗口对不齐，所以不用。

### D4. 成交量和手续费：两个来源分工
- **GeckoTerminal 小时 K 线**负责每日曲线。首次运行用 `limit=1000` 一次拉回约 41 天；之后每个整点拉最近 48 根并覆盖写入，因为最新那根 K 线还没走完，下一小时会变。按 UTC+8 自然日汇总：每日手续费 = Σ 小时成交量 × fee_rate。
- **Cetus `stats_pools`** 负责 24 小时卡片，同时作为核对来源。每个整点采样一次，保存 24H / 7D / 30D 的 vol、fee、tvl 和原始响应。
- 每日成交量（SUI 计）本次不做。原想用它排除 SUI 价格涨跌的影响，但现有来源都只有全池总成交量：GeckoTerminal `token=base&currency=token`（最短 1 分钟 K 线）给的 SUI 成交量就是美元成交量 ÷ 收盘价。无论按分钟还是按小时折算，都只是换一种币衡量总量，SUI 跌时 USDC 那一侧会折出更多 SUI，价格影响仍在。真正去掉价格影响需要"USDC 成交量 + SUI 成交数量 × N 日均价"这类分币种口径，只能从逐笔 SwapEvent 拿方向和数量，留待以后。
- 备选：逐笔采集 SwapEvent，能拿到精确的分币种数量，但翻页量未知，用户已决定 MVP 不做；Dune `sui.events` 汇总，需要账号和 API key，用户决定不用。

### D5. 激励收入：逐小时积分
- 每小时用该小时开始时快照的 `emissions_per_second` × 3600 秒，乘该小时的代币价格。发放速率很少调整，小时级精度够用。
- SUI 激励用本池快照价格；CETUS 用 Cetus USDC/CETUS 池（`0x3b13ac70…42b4`）的链上价格。该池结构和本池相同（coin_a = USDC 6 位，coin_b = CETUS 9 位），整点快照时在同一个 GraphQL 请求里多读一个对象，历史也能用 `atCheckpoint` 回补。2026-10-31 实测链上价格 0.021008，币安 CETUSUSDT 0.02094，相差约 0.3%。
- 备选：币安 CETUSUSDT 现货 K 线（流动性更好，但多一个外部依赖，时间要另外对齐）；GeckoTerminal 当前价代替整个窗口（最简单，但没有逐小时价格）。
- `stats_pools` 也返回 `emissionsPerSecond`，但以链上 rewarder 字段为准，接口值只用于核对。

### D6. 每日边界用 UTC+8
- 用户在中文环境下看"每天"，按北京时间切日。时区作为配置项，以后可改。

## Risks / Trade-offs

- [Cetus 和 GeckoTerminal 的窗口对不齐] Cetus 24H 的窗口定义没有文档，GeckoTerminal 按 UTC 整点切 K 线，两者的 24 小时不一定是同一段时间。→ 核对允许 ±5% 偏差；24 小时卡片只用 Cetus 的数，每日曲线只用 K 线的数，不混用。2026-10-31 04:36–07:40 UTC 每 5 分钟采了 37 次（data/probe-alignment.jsonl），没有失败请求，每次都有 24 根已走完 K 线。偏差 = (Cetus − K 线) ÷ Cetus，全部为负：−2.39% 到 −5.004%，平均 −3.89%，中位数 −4.00%。K 线合计在每个 UTC 整点内不变，只在整点跳一次；Cetus 24H vol 不是整点桶，成交额变动 ≥ 1 美元的间隔中位数 5.3 分钟，最长 25.6 分钟，另有 4 次只是字符串末位抖动。37 次里 36 次在 ±5% 以内。唯一出界是 05:01:44Z 的 −5.004%，5 分钟后回到 −4.86%；06:00 和 07:00 的整点样本分别是 −4.00% 和 −4.29%。Cetus fee 每次都等于 vol × 0.25%。±5% 维持不变：结构性偏差靠近上沿，但出界只有一条且立即回来，放宽阈值要改 spec。
- [依赖两个第三方服务] Cetus 接口改版或停服，24 小时卡片会断；GeckoTerminal 停服或改口径，每日曲线会断。两者互为核对，单个来源出问题能从偏差上发现。→ 保存 Cetus 原始响应。K 线的 `token=quote` 固定在采集代码里；收盘价和快照价相差超过 5% 不再拒绝写入。这个差是小时内涨跌，SUI 接近 1 美元时也区分不了 base 和 quote。
- [GeckoTerminal 免费接口限流] 约每分钟 30 次。→ 正常运行每小时只请求 1 次 K 线；回补 30 天只要 1 次请求。
- [GeckoTerminal 会修订最新 K 线] 最新那根还没走完，数值会变。→ 每次覆盖写入最近 48 根；每日序列只汇总已经结束的自然日。
- [GraphQL 限流或代理断线] → 每个请求带指数退避重试（scratch 已有），失败时段写入 `gaps`，下次运行补采链上快照。
- [CETUS 定价池较薄] USDC/CETUS 池 TVL 约 $47.5 万、日成交约 $3.7 万，整点瞬间价格可能偏离市场价。→ CETUS 激励每天约 $42，价格偏 1% 影响不到 $0.5，可以接受；定价池类型参数不符时不写入，避免价格方向弄反。
- [快照 L 曲线容易被误读] 一周内相差约 100 倍，线性纵轴下看不清。→ 默认对数纵轴，并在曲线旁加口径提示。
- [协议抽成存在 GlobalConfig，所有池共享] 以后接入 Turbos、Bluefin 等协议时位置不同（在 Pool 对象上）。→ 读取协议参数的逻辑按协议分开写，MVP 只实现 Cetus。

## Open Questions

实施中发现 spec 与真实数据不符、或 spec 无法实现时，在这里记录现象和证据，等用户确认后再改 spec。

2026-10-31 回补一轮 `node app/collect/run.js`（没有 `--loop`）已经结束。

- `snapshots`：721 行，2026-10-01T08:00:00.000Z 至 2026-10-31T08:00:00.000Z，首尾相减正好 720 小时，中间无缺口。
- `cetus_stats`：1 行，整点 2026-10-31T08:00:00.000Z，sampled_at 2026-10-31T08:39:34.806Z，vol_24h `2593257.5059110103`，fee_24h `6483.143764775899`。
- `ohlcv`：0 行。

`gaps` 一条：source `ohlcv`，hour 2026-10-29T20:00:00.000Z，detail `close 0.882002533803161 vs snapshot 0.9302523403975527 diff 5.19%`。该小时快照价就是 0.9302523403975527；下一整点 2026-10-29T21:00:00.000Z 的快照价是 0.8743154567303847。收盘价夹在两档快照之间，数量级相同，不是 `token` 方向反了。

只读复核（没有写入数据库）：同一接口 `limit=1000&aggregate=1&currency=usd&token=quote` 取回 1000 根，能对上快照的 721 根里，收盘价相对同一小时快照价超过 5% 的有 2 根。

- 2026-10-08T15:00:00.000Z：收盘 1.027，快照 1.0990396172432209，相差 6.55%。下一整点快照 1.0257107001538444。
- 2026-10-29T20:00:00.000Z：收盘 0.882002533803161，快照 0.9302523403975527，相差 5.19%。与上面的 `gaps` 相同。

当时 `priceCheck` 遇到第一根超阈值就整批返回失败，所以这一轮 30 天 K 线一条都没写。


2026-10-31 决定：去掉 K 线写入前的 5% 方向检查。`token=quote` 已核对没有写反，并且写死在 `geckoFetchPage`。成交额核对的 ±5%（`reconcileThreshold`）不变，仍只在 24 小时手续费卡片上标记，不改数字、不丢数据。

## Migration Plan

新增功能，没有旧数据或旧接口需要迁移。回滚就是停掉采集进程、删除 SQLite 文件。`scratch/` 脚本保持不动，作为口径核对的参照。
