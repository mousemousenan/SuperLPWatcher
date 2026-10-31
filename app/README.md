# Cetus USDC/SUI 收入看板

本地采集 Cetus USDC/SUI 0.25% 池的链上快照、Cetus 成交统计和 GeckoTerminal 小时 K 线，打开页面即可看到池子收入。计算只调用 `app/metrics/`，服务端不重写公式。

## 环境

- Windows，Node.js v24.14.0。
- 不要执行 npm install。只使用 Node 内置的 fetch、node:http、node:sqlite、node:test。
- 直连外网会超时。采集前在同一个终端里设置代理：

```powershell
$env:NODE_USE_ENV_PROXY = "1"
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY = "http://127.0.0.1:7897"
```

Git Bash 可以写成 NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897。

## 启动

在仓库根目录执行。

1. 首次回补，或补齐缺失的整点快照和 K 线。这条命令只跑一轮：

```powershell
node app/collect/run.js
```

需要之后每小时自动采集时，再加 --loop。不要改核对阈值或过期阈值。

2. 启动页面和 JSON API：

```powershell
node app/server.js
```

浏览器打开 http://127.0.0.1:8787 。换端口时设置环境变量 PORT。

3. 跑测试。node --test 不能直接传目录：

```powershell
node --test app/test/http.test.js app/test/db.test.js app/test/checkpoint.test.js app/test/collect.test.js app/test/metrics.test.js app/test/server.test.js
```

## 配置

常量在 app/config.js。

- pool.address、name，以及 coinA / coinB 的 symbol、decimals、typeMarker。小数位从这里读，不写死在公式里。
- globalConfig：Cetus GlobalConfig 地址。
- incentivePools：激励代币定价池。CETUS 用 USDC/CETUS 池。
- graphqlUrl、cetusStatsUrl。GeckoTerminal 地址由 geckoOhlcvUrl 生成。
- timezoneOffsetHours：默认 8。UTC+8 日界只用毫秒加减这个小时，不使用机器本地时区。
- backfillDays：首次回补天数，默认 30。
- ohlcvRefreshHours：每次覆盖写入最近多少根 K 线，默认 48。
- reconcileThreshold：Cetus 24H 成交额对最近 24 根已走完 K 线的阈值，默认 0.05。超过只在 24 小时手续费卡片上标「数据源不一致」，不改数字、不丢数据。
- staleMs：过期阈值，默认 2 小时。任一来源超过这个时间没有成功采集，页面顶部显示「数据已过期」并写明来源。
- dbPath：data/pool.sqlite。

三个来源的最后成功采集时间：

- 链上快照：最近一个成功写入的整点 hour_ts。表里没有另外的采集时钟。
- Cetus 成交统计：cetus_stats.sampled_at。
- GeckoTerminal K 线：ohlcv.collected_at 的最大值。把这一列改成 3 小时前，用来触发上面的 2 小时过期规则。

## API

- GET /api/pool：池地址、费率、激励代币，以及三个来源的最后成功采集时间。
- GET /api/revenue：当前价格、活跃 L、tick 段深度、24 小时手续费（含窗口、采样时间、Cetus 来源和核对结果）、激励、单位 L 手续费和两个示例仓位。
- GET /api/series?n=7 或 14 或 30：每日手续费、两个示例仓位每日手续费、整点 L。不返回每日 SUI 成交量。其它 N 返回 400。

## 口径

不要改 specs 里的指标口径。页面上的数字都按这三份文件计算：

- 采集：openspec/changes/add-cetus-pool-revenue-dashboard/specs/clmm-pool-data/spec.md
- 指标：openspec/changes/add-cetus-pool-revenue-dashboard/specs/pool-revenue-metrics/spec.md
- 看板：openspec/changes/add-cetus-pool-revenue-dashboard/specs/pool-revenue-dashboard/spec.md

存储：snapshots.hour_ts、cetus_stats.hour_ts、prices.hour_ts 是 UTC 整点毫秒；ohlcv.start_ts 是 K 线开始时间的秒。u128 以十进制字符串保存。tick_spacing 从快照读取。

