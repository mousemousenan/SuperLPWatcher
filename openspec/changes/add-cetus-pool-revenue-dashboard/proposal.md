# Proposal：Cetus USDC-SUI 池子收入看板（MVP）

## Why

SuperLP 的目标是做 LP 收益监测平台。《Cetus_USDC-SUI池_LP计算教程》已经用一次性脚本（`scratch/*.mjs`）验证了数据来源和计算口径，但每次都要手动拉数据、手动算。第一步先把"池子赚了多少钱"做成一个可重复刷新的看板，后续的个人收益估算（用户给定资金量和区间）和成本（无常损失、LVR）都建立在这些池级指标之上。

## What Changes

- 新增一个只针对 Cetus USDC/SUI 0.25% 池（`0xb8d7d9e6…0105`）的收入看板，分三块：
  - **池子基本信息**：池地址、交易手续费率、协议抽成、LP 实际手续费率、激励代币列表（每个代币的结算方式、每秒/每天发放量）。
  - **池子收入信息**：当前价格、当前活跃流动性 L、最近 24 小时全池手续费收入（USDC 计价）、最近 24 小时激励收入（USDC 计价）、最近 24 小时单位 L 手续费收入。
  - **图表**：近 N 天（默认 7 天）每日全池手续费收入曲线、整点快照活跃流动性 L 曲线。
- 新增数据采集：从 Sui GraphQL 读取池子当前状态和历史 checkpoint 快照，从 Cetus GlobalConfig 读取协议抽成，每小时采样 Cetus 官方统计接口 `stats_pools`，从 GeckoTerminal 采集小时 K 线，从 Cetus USDC/CETUS 池读取 CETUS 价格。
- 指标口径按讨论确认的定义固定下来（见 specs），特别是：
  - 24 小时全池手续费取 `stats_pools` 的 24H fee（等于成交量 × 交易费率，协议抽成前），不用"ΔfeeGrowth × 快照 L"；同时与 GeckoTerminal 最近 24 根小时 K 线的成交量核对。
  - 每日手续费由 GeckoTerminal 小时 K 线按 UTC+8 自然日汇总，首次运行即回补 30 天历史。
  - 单位 L 手续费来自两个时点 `fee_growth_global` 的差值。
- 本次**不做**：用户输入资金量和区间的个人收益估算、无常损失/LVR 等成本、多池或多协议、地址分布、告警、每日成交量（SUI 计）（原因见 design.md D4）。

## Capabilities

### New Capabilities

- `clmm-pool-data`：从链上、Cetus 统计接口和 GeckoTerminal 采集 CLMM 池子的状态快照、协议参数、成交统计、小时 K 线和代币价格，并按时间存储，供指标计算使用。
- `pool-revenue-metrics`：池级收入指标的定义和计算规则，包括 LP 实际费率、活跃 L、tick 段深度、24h 手续费及其核对、24h 激励收入、单位 L 手续费、示例仓位手续费、每日手续费序列。
- `pool-revenue-dashboard`：看板页面的展示内容、刷新方式和图表交互（时间范围 N 天）。

### Modified Capabilities

无（`openspec/specs/` 目前为空）。

## Impact

- 新增应用代码（目前仓库只有 `scratch/` 下的实验脚本，没有应用代码）。
- 外部依赖：Sui GraphQL（`graphql.mainnet.sui.io`）、Cetus 统计接口（`api-sui.cetus.zone`，链下服务，无文档）、GeckoTerminal API；本机访问需走代理 `127.0.0.1:7897`。
- Sui JSON-RPC 已在 Foundation 节点下线，不能作为数据源。
- 每日曲线依赖 GeckoTerminal 这个第三方服务；`stats_pools` 只用于 24 小时卡片和核对。
- 与 `docs/wiki/requirements/REQ-001` 的关系：本变更是 REQ-001 的第一个落地子集。
