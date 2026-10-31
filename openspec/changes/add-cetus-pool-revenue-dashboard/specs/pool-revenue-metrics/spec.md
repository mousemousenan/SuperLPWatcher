# Spec Delta

## Purpose

定义池级收入指标的口径和计算规则，使看板上每个数字都能由已采集的数据复算，并与《Cetus_USDC-SUI池_LP计算教程》的口径一致。

## ADDED Requirements

### Requirement: 定点数与单位换算
系统 SHALL 把 `current_sqrt_price`、`fee_growth_global_*`、`emissions_per_second`、`growth_global` 当作 Q64.64 定点数处理（除以 2^64）。原始单位换算到人类单位时 SHALL 使用代币小数位。中间计算 SHALL 使用不丢精度的整数或足够精度的十进制运算，只在展示时取近似值。

#### Scenario: 价格换算
- **WHEN** 快照 `current_sqrt_price` = 609642842451606482089，coin_a 为 6 位小数、coin_b 为 9 位小数
- **THEN** SUI 的 USDC 价格 = 10^(9−6) / (sqrt_price / 2^64)^2 ≈ 0.9156

### Requirement: tick 有符号解码
链上 `current_tick_index.bits` 是无符号 32 位整数。系统 SHALL 在任何计算之前把它转成有符号整数：bits ≥ 2^31 时，tick = bits − 2^32；否则 tick = bits。

#### Scenario: 正 tick
- **WHEN** `current_tick_index.bits` = 69963
- **THEN** tick = 69963

#### Scenario: 负 tick
- **WHEN** `current_tick_index.bits` = 4294967235
- **THEN** tick = −61，对应的 tick 段为 [−120, −60)

### Requirement: LP 实际手续费率
LP 实际手续费率 SHALL 等于 池子交易手续费率 × (1 − 协议抽成比例)。交易费率取 Pool 的 `fee_rate`（单位 1e-6），协议抽成取 GlobalConfig 的 `protocol_fee_rate`（单位 1e-4）。

#### Scenario: 当前参数
- **WHEN** `fee_rate` = 2500 且 `protocol_fee_rate` = 2000
- **THEN** 交易手续费率显示 0.25%，协议抽成显示 20%，LP 实际手续费率显示 0.20%

### Requirement: 当前价格与当前活跃流动性
当前价格 SHALL 由最新读取的 Pool 对象 `current_sqrt_price` 换算为每 1 SUI 的 USDC 价格。当前活跃流动性 L SHALL 直接取同一对象的 `liquidity` 字段（所有覆盖当前 tick 的仓位 L 之和，原始单位）。两者 SHALL 附带数据时点。

#### Scenario: 展示当前值
- **WHEN** 看板请求当前值
- **THEN** 返回同一 checkpoint 上的价格和 `liquidity`，以及该 checkpoint 的时间

### Requirement: 当前 tick 段深度
系统 SHALL 用当前活跃 L 换算当前价格所在 tick 段的币量。tick 段为 [tl, tl + tick_spacing)，tl = floor(当前 tick / tick_spacing) × tick_spacing（负 tick 向下取整）。段内 L 不变，结果为精确值。输出 SHALL 包括：段两端 tick 和对应 SUI 价格、段宽（%）、整段深度（整段折成 USDC 的数量、折成 SUI 的数量及其 USDC 价值），以及从当前价到上下两端各自的 SUI、USDC 数量。

#### Scenario: 计算整段深度
- **WHEN** 当前 tick = 69963、tick_spacing = 60、liquidity = 2.86e14
- **THEN** tick 段为 [69960, 70020)，SUI 价格 0.9104–0.9159，段宽约 0.60%；整段约 25,926 USDC 或 28,392 SUI（约 25,996 USDC）

#### Scenario: 计算到两端的分拆
- **WHEN** 同上参数，当前 SUI 价格 0.9156
- **THEN** 价格跌到 0.9104 前池子可付出约 24,627 USDC，涨到 0.9159 前可付出约 1,418 SUI

#### Scenario: 负 tick
- **WHEN** 当前 tick = −61、tick_spacing = 60
- **THEN** tick 段为 [−120, −60)

### Requirement: 24 小时全池手续费收入
24 小时全池手续费收入 SHALL 取最新一次 Cetus 成交统计采样中 24H 的 `fee`（美元计价，按 USDC 展示），它等于 24H 成交量 × 交易费率，是协议抽成前的总额。系统 SHALL 同时给出 24H 成交量和 LP 净额 = 总额 × (1 − 协议抽成)，并显示采样时间。系统 MUST NOT 用"ΔfeeGrowth × 快照 L"计算该值。

#### Scenario: 读取 24 小时手续费
- **WHEN** 最新采样的 24H `vol` = 5310334.24、`fee` = 13275.84，协议抽成 20%
- **THEN** 显示全池手续费 13,275.84 USDC、LP 净额 10,620.67 USDC、成交量 5,310,334 USDC，以及采样时间

#### Scenario: 最新采样过旧
- **WHEN** 最近一次成功的成交统计采样距今超过 2 小时
- **THEN** 系统仍返回该值，但标记为"数据过期"并附采样时间

### Requirement: 24 小时激励收入
24 小时激励收入 SHALL 对每个 rewarder 分别计算：逐小时累加 `emissions_per_second` × 该小时秒数 ÷ 10^小数位 × 该小时激励代币价格，再把各 rewarder 相加。该小时的发放速率和代币价格都取该小时开始时的整点数据（价格来源见 `clmm-pool-data` 的"代币价格"）。结果按 USDC 计价，同时 SHALL 按代币列出发放数量。

#### Scenario: 两个激励代币
- **WHEN** 池子有 CETUS 和 SUI 两个 rewarder
- **THEN** 结果分别显示两种代币 24 小时发放数量与 USDC 价值，以及合计 USDC 价值

#### Scenario: 激励代币价格缺失
- **WHEN** 某个激励代币在窗口内有整点价格缺失
- **THEN** 该代币的发放数量照常显示，USDC 价值和合计标记为"价格缺失"

### Requirement: 24 小时单位流动性手续费收入
24 小时单位 L 手续费收入 SHALL 由窗口首尾快照的 `fee_growth_global_a`、`fee_growth_global_b` 之差得到（按 u128 wrapping 减法），表示 1 单位原始 L 在窗口内一直处于活跃状态能分到的 LP 手续费（已扣协议抽成）。a 侧按 USDC 计价；b 侧逐小时用该小时的增量和价格折算成 USDC 后求和。

#### Scenario: 计算单位 L 收入
- **WHEN** 窗口首尾快照都存在
- **THEN** 结果 = Δfga / 2^64 / 10^6 + Σ_小时 (Δfgb_小时 / 2^64 / 10^9 × SUI 价格_小时)，单位为 USDC / 原始 L

#### Scenario: 计数器回绕
- **WHEN** 窗口末尾的 `fee_growth_global` 数值小于窗口开头
- **THEN** 系统按 2^128 回绕计算差值，不得输出负数

### Requirement: 示例仓位 24 小时手续费
系统 SHALL 为两个示例仓位计算最近 24 小时手续费：本金 $10,000，区间为开仓价 ±1% 和 ±10%。开仓价取 24 小时窗口起点的整点快照价格，区间边界向外对齐到 tick_spacing 的整数倍，求出原始 L 和所需 SUI、USDC 数量。手续费 = Σ 窗口内 24 个小时 (L_raw × 该小时单位 L 手续费 × 该小时在区间内的比例)，口径与"示例仓位每日手续费序列"相同。不计自身稀释、激励和无常损失。

#### Scenario: 开仓参数
- **WHEN** 窗口起点 SUI 价格 0.9156，tick_spacing = 60
- **THEN** ±1% 仓位：区间 0.9049–0.9269，L_raw ≈ 2.76e13，约 5,588 SUI + 4,883 USDC；±10% 仓位：区间 0.8221–1.0081，L_raw ≈ 3.32e12，约 5,162 SUI + 5,273 USDC

#### Scenario: 按在区间内时间折算
- **WHEN** 同上参数，每小时单位 L 手续费都是 10.5 ÷ 24 USDC / 1e12 原始 L，±1% 仓位有 8 个小时完全在区间内、其余小时完全在区间外，±10% 仓位 24 个小时都完全在区间内
- **THEN** ±1% 仓位 24 小时手续费 ≈ 2.76e13 ÷ 1e12 × 10.5 ÷ 24 × 8 ≈ 96.6 USDC，在区间内 8 小时；±10% 仓位 ≈ 3.32e12 ÷ 1e12 × 10.5 ≈ 34.9 USDC，在区间内 24 小时

#### Scenario: 单位 L 手续费或 K 线不可用
- **WHEN** 窗口内有小时的单位 L 手续费或 K 线缺失
- **THEN** 缺失的小时不计入，结果标记为"不完整"并注明有效小时数；全部缺失时显示"数据不足"，区间和币量照常显示

### Requirement: 统计窗口
激励收入和单位 L 手续费的"最近 24 小时"SHALL 指以最新一个整点快照为终点、往前 24 小时的滚动窗口，两者使用同一窗口并显示起止时间。24 小时全池手续费的窗口由 Cetus 统计接口决定，SHALL 显示采样时间并注明窗口由 Cetus 定义。

#### Scenario: 窗口说明
- **WHEN** 看板同时展示手续费、激励和单位 L 收入
- **THEN** 激励和单位 L 收入显示相同的窗口起止时间，手续费显示 Cetus 采样时间和窗口来源说明

### Requirement: 每日 K 线归属
UTC+8 自然日 D 的 K 线 SHALL 是开始时间落在 D 日 00:00–23:00（UTC+8）的 24 根小时 K 线，即 UTC 时间 D−1 日 16:00 至 D 日 15:00。24 根齐全为"正常"；少于 24 根为"不完整"并注明根数；一根都没有为"缺失"。序列只包含已经结束的自然日。

#### Scenario: 部分 K 线缺失
- **WHEN** D 日只有 22 根 K 线
- **THEN** D 日的手续费和成交量按这 22 根计算，状态为"不完整"，注明 22 根

### Requirement: 每日手续费序列
D 日全池手续费 SHALL 等于 D 日各根 K 线的美元成交量之和 × 当日交易手续费率（Pool 的 `fee_rate`，取 D 日最后一个整点快照的值）。结果按 USDC 展示，为协议抽成前的总额。

#### Scenario: 计算每日手续费
- **WHEN** D 日 24 根 K 线成交量之和为 5,902,860 USD，`fee_rate` = 2500
- **THEN** D 日全池手续费为 14,757.15 USDC，状态为"正常"

#### Scenario: 首次运行即有历史
- **WHEN** 系统首次运行并完成回补，用户选择 N = 30
- **THEN** 返回最近 30 个已结束自然日的数据点，不因刚开始运行而留空

### Requirement: 24 小时手续费数据源核对
系统 SHALL 用最近 24 根已走完的 K 线成交量之和，与最新一次 Cetus 成交统计的 24H `vol` 比较，输出偏差 = (Cetus − K 线) ÷ Cetus。两者窗口对齐方式不同，偏差在 ±5% 以内视为一致；超过 ±5% SHALL 标记为"数据源不一致"。

#### Scenario: 两个来源一致
- **WHEN** Cetus 24H `vol` = 3,288,612，最近 24 根 K 线成交量之和 = 3,287,709
- **THEN** 偏差约 0.03%，状态为"一致"

#### Scenario: 两个来源不一致
- **WHEN** 偏差为 −8%
- **THEN** 状态为"数据源不一致"，并同时给出两个数值

### Requirement: 示例仓位每日手续费序列
系统 SHALL 为 $10,000 的 ±1% 和 ±10% 两个示例仓位分别计算每个 UTC+8 自然日 D 的手续费。每天按 D 日 00:00 快照价格重新开仓：区间按"示例仓位 24 小时手续费"的规则对齐，L_raw 按开仓价算，当天不变。D 日手续费 = Σ 当天 24 个小时 (L_raw × 该小时单位 L 手续费 × 该小时在区间内的比例)。不计自身稀释、激励和无常损失。

#### Scenario: 计算一天的手续费
- **WHEN** D 日某小时单位 L 手续费为 0.5 USDC / 1e12 原始 L、在区间内比例为 75.5%，L_raw = 2.76e13，其余 23 小时比例为 0
- **THEN** D 日手续费 = 2.76e13 ÷ 1e12 × 0.5 × 0.755 ≈ 10.42 USDC

#### Scenario: 输出明细
- **WHEN** 请求示例仓位每日手续费序列
- **THEN** 每个数据点包含日期、手续费、开仓价、对齐后的区间、L_raw、在区间内的小时数（= Σ 比例）和状态

### Requirement: 每小时单位 L 手续费
小时 h 的单位 L 手续费 SHALL 由 h 和 h+1 两个整点快照计算：wrap(Δfga) / 2^64 / 10^6 + wrap(Δfgb) / 2^64 / 10^9 × h 时刻快照的 SUI 价格，单位为 USDC / 原始 L。两个快照缺任一个时，该小时为缺失。

#### Scenario: 相邻快照缺失
- **WHEN** h+1 整点快照缺失
- **THEN** 小时 h 的单位 L 手续费为缺失

### Requirement: 每小时在区间内的比例
小时 h 的在区间内比例 SHALL 由该小时的 GeckoTerminal K 线计算：[最低价, 最高价] 与仓位区间 [Pa, Pb] 重叠部分的长度 ÷ (最高价 − 最低价)，取值 0 到 1。最高价等于最低价时，收盘价在区间内为 1，否则为 0。这一算法假设小时内价格均匀分布、手续费在小时内均匀产生。

#### Scenario: 部分重叠
- **WHEN** K 线最低 0.9000、最高 0.9200，仓位区间 0.9049–0.9269
- **THEN** 比例 = (0.9200 − 0.9049) ÷ (0.9200 − 0.9000) = 75.5%

#### Scenario: 完全在区间外
- **WHEN** K 线最低 0.8800、最高 0.8990，仓位区间 0.9049–0.9269
- **THEN** 比例 = 0

#### Scenario: 小时数据缺失
- **WHEN** D 日有 2 个小时的单位 L 手续费或 K 线缺失
- **THEN** 这 2 个小时不计入，D 日状态为"不完整"并注明有效小时数 22

### Requirement: 活跃流动性序列
活跃流动性 L 序列 SHALL 由整点快照的 `liquidity` 字段组成，每小时一个点，不做平滑或插值。

#### Scenario: 缺失整点
- **WHEN** 某个整点快照缺失
- **THEN** 该点在序列中为空值，不用相邻值填充
