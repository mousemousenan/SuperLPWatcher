# Spec Delta

## Purpose

采集 Cetus CLMM 池子的链上状态、协议参数、Cetus 官方成交统计、GeckoTerminal 小时 K 线和代币价格，按时间保存，供收入指标计算和看板展示使用。

## ADDED Requirements

### Requirement: 监测池子范围
系统 SHALL 只监测配置中指定的池子。MVP 的配置只包含 Cetus USDC/SUI 0.25% 池 `0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105`（coin_a = USDC，6 位小数；coin_b = SUI，9 位小数）。代币小数位和代币类型 SHALL 从配置或链上元数据读取，不得写死在计算逻辑里。

#### Scenario: 读取配置的池子
- **WHEN** 系统启动
- **THEN** 系统只对配置列出的池地址采集数据，并识别 coin_a、coin_b 的类型和小数位

### Requirement: 整点池子快照
系统 SHALL 每小时整点保存一次池子快照，取该时刻对应的 checkpoint 上的 Pool 对象。快照 SHALL 至少包含：checkpoint 序号、时间戳、`current_sqrt_price`、`current_tick_index`、`liquidity`、`fee_growth_global_a`、`fee_growth_global_b`、`fee_rate`、`coin_a` / `coin_b` 余额、每个 rewarder 的代币类型、`emissions_per_second` 和 `growth_global`。

#### Scenario: 正常整点采集
- **WHEN** 时间到达整点
- **THEN** 系统保存一条该整点的快照，所有 u128 字段按原始整数完整保存，不丢精度

#### Scenario: 补采缺失的整点
- **WHEN** 系统发现某个整点快照缺失（例如服务停机过）
- **THEN** 系统按该整点对应的历史 checkpoint 补采，补采结果与正常采集的字段相同

### Requirement: 首次历史回补
系统首次运行时 SHALL 回补最近 30 天的整点快照和 GeckoTerminal 小时 K 线，使所有曲线和 24 小时指标在首次运行后即可展示。Cetus 成交统计没有历史可查，SHALL 从首次运行时开始采集，不回补。

#### Scenario: 首次启动
- **WHEN** 存储中没有任何该池数据
- **THEN** 系统回补最近 30 天的整点快照和小时 K 线，回补完成前看板对缺少数据的指标显示"数据不足"；Cetus 成交统计从当前整点开始采集

### Requirement: 采集 GeckoTerminal 小时 K 线
系统 SHALL 从 `https://api.geckoterminal.com/api/v2/networks/sui-network/pools/<池地址>/ohlcv/hour?aggregate=1&currency=usd&token=quote` 采集本池小时 K 线，`token=quote` 使价格为 SUI 的美元价格。每根 K 线 SHALL 保存：开始时间（UTC 整点）、开、高、低、收、美元成交量。单次请求最多 1,000 根，回补更早的数据 SHALL 用 `before_timestamp` 翻页。同一开始时间 SHALL 只保留一行，重复采集时用新值覆盖旧值。

#### Scenario: 每小时更新
- **WHEN** 每个整点的采集任务运行
- **THEN** 系统重新拉取最近 48 根 K 线并覆盖写入，使上一根未走完的 K 线被更新为最终值

#### Scenario: 中断后补采
- **WHEN** 采集进程停机若干小时后恢复
- **THEN** 系统按最后一根已保存的 K 线开始时间往后补齐，不留空缺

#### Scenario: 小时涨跌仍写入
- **WHEN** 某根 K 线收盘价与同一小时链上快照换算的 SUI 价格相差超过 5%
- **THEN** 系统仍然写入该批 K 线，不把这一差异记为采集失败。`token=quote` 固定在采集代码里，不再用价格差判断方向是否写反

### Requirement: 采集 Cetus 成交统计
系统 SHALL 每小时整点请求一次 Cetus 统计接口 `https://api-sui.cetus.zone/v3/sui/clmm/stats_pools?pool=<池地址>`，保存：采样时间、24H / 7D / 30D 的 `vol` 和 `fee`、`tvl`、`feeRate`，以及完整的原始响应。系统 SHALL 校验返回的 `pool` 字段等于监测池地址。

#### Scenario: 正常采样
- **WHEN** 时间到达整点且接口返回成功
- **THEN** 系统保存一条该整点的成交统计记录，数值按接口返回的十进制字符串原样保存

#### Scenario: 返回的池子不对
- **WHEN** 接口返回的列表为空，或第一条记录的 `pool` 不等于监测池地址
- **THEN** 系统不保存该次采样，并记录为采集失败

#### Scenario: 采样失败无法补采
- **WHEN** 某个整点的成交统计采集失败
- **THEN** 系统在同一小时内重试；仍失败则该整点记为缺失，后续不补采（接口不提供历史值）

### Requirement: 协议抽成参数
系统 SHALL 从 Cetus GlobalConfig 对象读取 `protocol_fee_rate`（单位 1e-4），并在每次整点采集时刷新。

#### Scenario: 协议抽成被调整
- **WHEN** GlobalConfig 中的 `protocol_fee_rate` 发生变化
- **THEN** 系统在下一个整点保存新值，并保留变化前的历史值

### Requirement: 代币价格
系统 SHALL 为每个整点保存用于 USDC 计价的价格：USDC 按 1 计价；SUI 价格由同一快照的 `current_sqrt_price` 换算；不是池内代币的激励代币 SHALL 从配置的链上定价池读取，与整点快照使用同一 checkpoint。MVP 中 CETUS 的定价池为 Cetus USDC/CETUS 0.25% 池 `0x3b13ac70030d587624e407bbe791160b459c48f1049e04269eb8ee731f5442b4`（coin_a = USDC，6 位小数；coin_b = CETUS，9 位小数），价格 = 10^(9−6) / (sqrt_price / 2^64)^2。

#### Scenario: 计算 CETUS 价格
- **WHEN** 定价池 `current_sqrt_price` / 2^64 的平方为 47601.637
- **THEN** CETUS 价格 = 1000 / 47601.637 ≈ 0.021008 USDC

#### Scenario: 定价池类型不符
- **WHEN** 定价池对象的类型参数不是 coin_a = USDC、coin_b = 该激励代币
- **THEN** 系统不保存该价格并记录为采集失败，不按相反方向猜测

#### Scenario: 激励代币价格获取失败
- **WHEN** 某个整点读取定价池失败
- **THEN** 系统记录该价格缺失，不用 0 或其他代币价格代替，并在后续运行中按该整点的 checkpoint 补采

### Requirement: 数据源失败处理
采集请求失败时系统 SHALL 重试；重试仍失败时 SHALL 记录失败的时间段。链上快照、小时 K 线和激励代币价格 SHALL 在后续运行中补采；Cetus 成交统计按"采集 Cetus 成交统计"的规则处理。系统不得写入不完整的记录。

#### Scenario: GraphQL 暂时不可用
- **WHEN** Sui GraphQL 在某个整点连续请求失败
- **THEN** 该整点不写入快照，失败时段被记录，服务恢复后自动补采
