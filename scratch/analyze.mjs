// Cetus USDC/SUI 0.25% 池：LP 成本、收入、预期收益 逐步计算
// 数据：snaps.json(30 天每日快照) hourly.json(7 天逐小时快照) ohlcv_hour.json gas.json funding.json cetus.json
import fs from 'fs';
const J = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const Q64 = 2 ** 64;
const big = s => BigInt(s);
const q64 = d => Number(d) / Q64; // Q64.64 定点 -> 浮点

// ---------- 第 1 步：池子基本参数 ----------
const DEC_A = 6, DEC_B = 9;               // coin_a=USDC, coin_b=SUI
const FEE_RATE = 2500 / 1e6;              // 0.25%
const PROTOCOL_SHARE = 2000 / 1e4;        // GlobalConfig.protocol_fee_rate = 20%
const LP_FEE = FEE_RATE * (1 - PROTOCOL_SHARE);
const TICK_SPACING = 60;

// Cetus 价格 = coin_b/coin_a 原始单位；换成 “1 SUI 值多少 USDC”
const sqrtToUsd = sqrtX64 => { const s = Number(big(sqrtX64)) / Q64; return 10 ** (DEC_B - DEC_A) / (s * s); };
const tickToUsd = t => 10 ** (DEC_B - DEC_A) / 1.0001 ** t;
const usdToTick = p => Math.log(10 ** (DEC_B - DEC_A) / p) / Math.log(1.0001);
// 人类单位 L'（x=SUI, y=USDC, P=USDC/SUI）与链上原始 L 的换算：L_raw = L' * sqrt(10^(DEC_A+DEC_B))
const RAW_PER_L = Math.sqrt(10 ** (DEC_A + DEC_B));

const hourly = J('hourly.json');
const snaps = J('snaps.json');
const now = hourly.at(-1), start = hourly[0];
const P_now = sqrtToUsd(now.sqrt);
const SUI_USD = P_now, CETUS_USD = Number(J('cetus.json').data.attributes.price_usd);
console.log('== 1 池子参数 ==');
console.log({ fee: FEE_RATE, protocolShare: PROTOCOL_SHARE, lpFee: LP_FEE, P_now: +P_now.toFixed(4), tick_now: now.tick,
  checkPrice: +tickToUsd(now.tick).toFixed(4), from: start.ts, to: now.ts });

// ---------- 第 2 步：TVL ----------
const last = snaps.at(-1);
const tvlA = last.coin_a / 10 ** DEC_A, tvlB = last.coin_b / 10 ** DEC_B;
const P_last = sqrtToUsd(last.sqrt);
console.log('\n== 2 TVL ==');
console.log({ usdc: +tvlA.toFixed(0), sui: +tvlB.toFixed(0), P: +P_last.toFixed(4), tvlUsd: +(tvlA + tvlB * P_last).toFixed(0) });

// ---------- 第 3 步：池子总收入（逐小时 ΔfeeGrowth × 活跃 L）----------
// fee_growth_global = 累计“每单位活跃流动性”分到的 LP 手续费（已扣协议费），Q64.64
let poolFeeUsd7d = 0, poolFeeUsd24h = 0;
const hours = [];
for (let i = 1; i < hourly.length; i++) {
  const a = hourly[i - 1], b = hourly[i];
  const dA = q64(big(b.fga) - big(a.fga)), dB = q64(big(b.fgb) - big(a.fgb)); // 每单位原始 L 的原始代币
  const dR = b.rw.map((g, k) => q64(big(g) - big(a.rw[k])));                  // 奖励增长：[CETUS, SUI]
  const Lm = (Number(a.L) + Number(b.L)) / 2;                                   // 该小时活跃 L（首尾均值，近似）
  const p0 = sqrtToUsd(a.sqrt), p1 = sqrtToUsd(b.sqrt);
  const pm = (p0 + p1) / 2;
  const feeUsd = (dA * Lm) / 10 ** DEC_A + (dB * Lm) / 10 ** DEC_B * pm;
  poolFeeUsd7d += feeUsd; if (i > hourly.length - 1 - 24) poolFeeUsd24h += feeUsd;
  hours.push({ dA, dB, dR, Lm, p0, p1, pm });
}
console.log('\n== 3 池子 LP 手续费收入（链上 feeGrowth 推算）==');
console.log({ lpFee24h: +poolFeeUsd24h.toFixed(0), impliedVolume24h: +(poolFeeUsd24h / LP_FEE).toFixed(0),
  lpFee7dAvgPerDay: +(poolFeeUsd7d / 7).toFixed(0), impliedVolume7dPerDay: +(poolFeeUsd7d / 7 / LP_FEE).toFixed(0) });
const tvlUsd = tvlA + tvlB * P_last;
console.log({ naivePoolFeeAPR: +((poolFeeUsd7d / 7) * 365 / tvlUsd * 100).toFixed(1) + '%' });
const Ls = hourly.map(h => Number(h.L));
console.log({ activeL_min: Math.min(...Ls).toExponential(2), activeL_max: Math.max(...Ls).toExponential(2) });
console.log('  ↑ 错误示范：快照 L 不代表 Swap 时的活跃 L（L 一周内相差约 100 倍）');

// ---------- 第 3b 步：用成交量核对真实手续费，并反推 Swap 时的有效 L ----------
const ohlcv = J('ohlcv_hour.json').data.attributes.ohlcv_list.map(r => ({ t: r[0] * 1000, o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] })).sort((a, b) => a.t - b.t);
const t0 = Date.parse(start.ts), t1 = Date.parse(now.ts);
const volIn = (a, b) => ohlcv.reduce((s, k) => s + k.v * Math.max(0, Math.min(b, k.t + 3.6e6) - Math.max(a, k.t)) / 3.6e6, 0);
const vol7d = volIn(t0, t1), days7 = (t1 - t0) / 864e5;
const lpFeeReal7d = vol7d * LP_FEE;
const dfgUsd7d = hours.reduce((s, h) => s + h.dA / 10 ** DEC_A + h.dB / 10 ** DEC_B * h.pm, 0); // 每 1 单位原始 L 7 天分到的 USD
const L_eff = lpFeeReal7d / dfgUsd7d;
console.log('\n== 3b 真实手续费（GeckoTerminal 成交量 × 费率）==');
console.log({ vol7dPerDay: +(vol7d / days7).toFixed(0), totalFeePerDay: +(vol7d / days7 * FEE_RATE).toFixed(0),
  lpFeePerDay: +(lpFeeReal7d / days7).toFixed(0), protocolFeePerDay: +(vol7d / days7 * FEE_RATE * PROTOCOL_SHARE).toFixed(0),
  feeGrowthUsdPerRawL_7d: dfgUsd7d.toExponential(3), L_eff_at_swaps: L_eff.toExponential(2),
  L_snapshot_avg: (Ls.reduce((a, b) => a + b) / Ls.length).toExponential(2),
  naiveTvlAPR: +(lpFeeReal7d / days7 * 365 / tvlUsd * 100).toFixed(1) + '%' });

// ---------- 第 3c 步：激励奖励（按时间、按活跃 L 发放）----------
const eps = last.rw.map(r => q64(big(r.eps)) / 1e9 * 86400); // 每天发放量（CETUS 9 位小数，SUI 9 位小数）
const rewardUsdPerDay = eps[0] * CETUS_USD + eps[1] * SUI_USD;
const dRw7d = [0, 1].map(k => hours.reduce((s, h) => s + h.dR[k], 0) / 1e9); // 每 1 原始 L 7 天分到的代币
const L_timeavg = eps[0] * days7 / dRw7d[0];
console.log('\n== 3c 激励 ==');
console.log({ cetusPerDay: +eps[0].toFixed(0), suiPerDay: +eps[1].toFixed(0), CETUS_USD, rewardUsdPerDay: +rewardUsdPerDay.toFixed(0),
  L_timeavg_from_rewarder: L_timeavg.toExponential(2) });

// ---------- 第 4 步：示例仓位 ----------
const v3 = (P, Pa, Pb, L) => { const p = Math.min(Math.max(P, Pa), Pb); return { sui: L * (1 / Math.sqrt(p) - 1 / Math.sqrt(Pb)), usdc: L * (Math.sqrt(p) - Math.sqrt(Pa)) }; };
const val = (b, P) => b.sui * P + b.usdc;
const openL = (C, P, Pa, Pb) => C / val(v3(P, Pa, Pb, 1), P);
// 对齐到 tick_spacing
const alignP = p => tickToUsd(Math.round(usdToTick(p) / TICK_SPACING) * TICK_SPACING);
// 已实现波动率（30 天小时收益）
const closes = ohlcv.filter(k => k.t >= Date.parse(snaps[0].ts)).map(k => k.c);
const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
const mu = rets.reduce((a, b) => a + b) / rets.length;
const sigma = Math.sqrt(rets.reduce((s, r) => s + (r - mu) ** 2, 0) / (rets.length - 1) * 8760);
const rets7 = ohlcv.filter(k => k.t >= t0).map(k => k.c).map((c, i, a) => i ? Math.log(c / a[i - 1]) : null).slice(1);
const sigma7 = Math.sqrt(rets7.reduce((s, r) => s + r * r, 0) / rets7.length * 8760);
console.log('\n== 4 波动率 ==', { sigma30d: +(sigma * 100).toFixed(1) + '%', sigma7d: +(sigma7 * 100).toFixed(1) + '%' });
// ---------- 第 5 步：回测 7 天前开的 $10,000、±10% 仓位（实际账户口径）----------
const gasNodes = J('gas.json').data.transactions.nodes.map(n => n.effects.gasEffects.gasSummary);
const gasSui = gasNodes.reduce((s, g) => s + (g.computationCost + g.storageCost - g.storageRebate), 0) / gasNodes.length / 1e9;
const fr = J('funding.json').map(x => Number(x.fundingRate));
const fr8hAvg = fr.reduce((a, b) => a + b) / fr.length;

function simulate({ C, pct, lo = null, hi = null, label }) {
  const P0 = sqrtToUsd(start.sqrt);
  const Pa = lo ?? alignP(P0 * (1 - pct)), Pb = hi ?? alignP(P0 * (1 + pct));
  const L = openL(C, P0, Pa, Pb), Lraw = L * RAW_PER_L;
  const b0 = v3(P0, Pa, Pb, L);
  const swapCost = b0.sui * P0 * FEE_RATE;          // 全 USDC 起步，需先换出 SUI 部分（走本池 0.25%）
  const gasUsd = 3 * gasSui * SUI_USD;              // 换币 + 开仓 + 领取，粗估
  const dilFee = L_eff / (L_eff + Lraw), dilRw = L_timeavg / (L_timeavg + Lraw);
  let feeUsd = 0, rwUsd = 0, inHours = 0, feeA = 0, feeB = 0;
  hours.forEach((h, i) => {
    const tm = Date.parse(hourly[i].ts) + 1.8e6;
    const k = ohlcv.find(c => tm >= c.t && tm < c.t + 3.6e6) ?? { h: Math.max(h.p0, h.p1), l: Math.min(h.p0, h.p1) };
    const lo_ = Math.min(k.l, h.p0, h.p1), hi_ = Math.max(k.h, h.p0, h.p1);
    const ov = Math.max(0, Math.min(hi_, Pb) - Math.max(lo_, Pa));
    const frac = hi_ > lo_ ? ov / (hi_ - lo_) : (h.p0 >= Pa && h.p0 <= Pb ? 1 : 0);
    inHours += frac;
    const a = Lraw * h.dA * frac * dilFee / 10 ** DEC_A, bb = Lraw * h.dB * frac * dilFee / 10 ** DEC_B;
    feeA += a; feeB += bb; feeUsd += a + bb * h.pm;
    rwUsd += Lraw * frac * dilRw * (h.dR[0] / 1e9 * CETUS_USD + h.dR[1] / 1e9 * h.pm);
  });
  const b1 = v3(P_now, Pa, Pb, L);
  const lpChange = val(b1, P_now) - C;
  const hodl = val(b0, P_now) - C;
  const il = val(b1, P_now) - val(b0, P_now);
  const net = lpChange + feeUsd + rwUsd - swapCost - gasUsd;
  // 对冲腿：每 24 小时把永续空单调到 LP 当前 SUI 数量；资金费用 Binance 实际 8h 费率
  const frs = J('funding.json').map(x => ({ t: x.fundingTime, r: Number(x.fundingRate) }));
  let short = b0.sui, hedgePnl = 0, funding = 0, hedgeCost = short * P0 * 0.0005;
  hours.forEach((h, i) => {
    hedgePnl += -short * (h.p1 - h.p0);
    const ta = Date.parse(hourly[i].ts), tb = Date.parse(hourly[i + 1].ts);
    for (const f of frs) if (f.t > ta && f.t <= tb) funding += short * h.p1 * f.r;
    if (i % 24 === 23) { const d = v3(h.p1, Pa, Pb, L).sui; hedgeCost += Math.abs(d - short) * h.p1 * 0.0005; short = d; }
  });
  hedgeCost += short * P_now * 0.0005;
  const netHedged = net + hedgePnl + funding - hedgeCost;
  return { label, Pa: +Pa.toFixed(4), Pb: +Pb.toFixed(4), P0: +P0.toFixed(4), P1: +P_now.toFixed(4),
    open: { sui: +b0.sui.toFixed(1), usdc: +b0.usdc.toFixed(1) }, close: { sui: +b1.sui.toFixed(1), usdc: +b1.usdc.toFixed(1) },
    Lraw: Lraw.toExponential(2), shareOfActiveL: +(Lraw / (L_eff + Lraw) * 100).toFixed(3) + '%',
    inRangePct: +(inHours / hours.length * 100).toFixed(1),
    lpValueChange: +lpChange.toFixed(2), hodlChange: +hodl.toFixed(2), IL_vs_hodl: +il.toFixed(2),
    fees: +feeUsd.toFixed(2), feeTokens: { usdc: +feeA.toFixed(2), sui: +feeB.toFixed(2) }, rewards: +rwUsd.toFixed(2),
    swapCost: +swapCost.toFixed(2), gas: +gasUsd.toFixed(3), actualNet: +net.toFixed(2), netPct: +(net / C * 100).toFixed(2),
    hedged: { hedgePnl: +hedgePnl.toFixed(2), funding: +funding.toFixed(2), hedgeCost: +hedgeCost.toFixed(2), net: +netHedged.toFixed(2) } };
}
console.log('\n== 5 七天回测（实际账户：LP 本金变化 + 手续费 + 奖励 − 成本；不再扣 LVR）==');
console.log({ gasPerTxSui: +gasSui.toFixed(5), funding8hAvg: fr8hAvg });
const bt = [simulate({ C: 10000, pct: 0.10, label: '±10%' }), simulate({ C: 10000, pct: 0.20, label: '±20%' })];
for (const r of bt) console.log(r);
// ---------- 第 6 步：未来 30 天预期收益（理论口径：手续费 + 奖励 − LVR + 资金费 − 成本）----------
// 价格路径：零漂移 GBM、逐小时；只在价格位于区间内时计手续费 / 奖励 / LVR
const fgPerHour = dfgUsd7d / hours.length;                                       // 每 1 原始 L 每小时 LP 手续费（USD）
const rwPerHour = hours.reduce((s, h) => s + h.dR[0] / 1e9 * CETUS_USD + h.dR[1] / 1e9 * h.pm, 0) / hours.length;
const PERP_TAKER = 0.0005;                                                       // 假设：永续吃单费 0.05%
let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
function forecast({ C, pct, sig, days = 30, paths = 2000 }) {
  const P0 = P_now, Pa = alignP(P0 * (1 - pct)), Pb = alignP(P0 * (1 + pct));
  const L = openL(C, P0, Pa, Pb), Lraw = L * RAW_PER_L;
  const dilF = L_eff / (L_eff + Lraw), dilR = L_timeavg / (L_timeavg + Lraw);
  const H = days * 24, dt = 1 / 8760;
  let sFee = 0, sRw = 0, sLvr = 0, sIn = 0, sFund = 0, sHedge = 0, sLpChg = 0;
  for (let k = 0; k < paths; k++) {
    let P = P0, d = v3(P, Pa, Pb, L).sui, lastHedgeDay = d;
    for (let t = 0; t < H; t++) {
      P *= Math.exp(-0.5 * sig * sig * dt + sig * Math.sqrt(dt) * gauss());
      if (P > Pa && P < Pb) {
        sIn++; sFee += Lraw * fgPerHour * dilF; sRw += Lraw * rwPerHour * dilR;
        sLvr += L * sig * sig * Math.sqrt(P) / 4 * dt;                           // dLVR/dt = −½ΓP²σ² = Lσ²√P/4
      }
      d = v3(P, Pa, Pb, L).sui;
      if (t % 8 === 7) sFund += d * P * fr8hAvg;                                  // 空单名义 × 8h 资金费
      if (t % 24 === 23) { sHedge += Math.abs(d - lastHedgeDay) * P * PERP_TAKER; lastHedgeDay = d; } // 每日调空单
    }
    sLpChg += val(v3(P, Pa, Pb, L), P) - C;
  }
  const n = paths;
  const swapCost = v3(P0, Pa, Pb, L).sui * P0 * FEE_RATE;                         // 开仓换币
  const openHedge = v3(P0, Pa, Pb, L).sui * P0 * PERP_TAKER * 2;                  // 开、平空单
  const fee = sFee / n, rw = sRw / n, lvr = sLvr / n, fund = sFund / n, hedge = sHedge / n + openHedge;
  const unhedged = fee + rw - lvr - swapCost;
  const hedged = fee + rw - lvr + fund - swapCost - hedge;
  return { range: `±${pct * 100}%`, sigma: +(sig * 100).toFixed(0) + '%', Pa: +Pa.toFixed(4), Pb: +Pb.toFixed(4),
    share: +(Lraw / (L_eff + Lraw) * 100).toFixed(3) + '%', inRange: +(sIn / n / H * 100).toFixed(1) + '%',
    fee: +fee.toFixed(1), reward: +rw.toFixed(1), LVR: +lvr.toFixed(1), funding: +fund.toFixed(1), swapCost: +swapCost.toFixed(1),
    hedgeCost: +hedge.toFixed(1), E_net_unhedged: +unhedged.toFixed(1), E_net_hedged: +hedged.toFixed(1),
    breakevenFee: +(lvr + swapCost + hedge - fund - rw).toFixed(1), feeOverLVR: +(fee / lvr).toFixed(2),
    mc_E_lpValueChange: +(sLpChg / n).toFixed(1) };
}
console.log('\n== 6 未来 30 天预期（$10,000，以当前价为中心）==');
for (const sig of [sigma7, sigma]) for (const pct of [0.1, 0.2]) console.log(forecast({ C: 10000, pct, sig }));
