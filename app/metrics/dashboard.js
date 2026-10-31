import { DAY_MS, HOUR_MS, formatDateTime, startOfDay } from "../lib/time.js";
import { dailyFeeSeries, liquiditySeries } from "./daily.js";
import { humanEmissionPerDay, humanEmissionPerSecond, incentiveIncome24h } from "./incentives.js";
import { currentPool, feeRates, poolFee24h, reconcileVolumes, sumCompletedCandles, tickDepth } from "./pool.js";
import { exampleDailySeries, exampleWindowFee } from "./position.js";
import { asSnapshot, symbolFromCoin } from "./rows.js";
import { STATUS } from "./status.js";
import { unitFeeWindow } from "./unit-fee.js";

export const SETTLEMENT = "按秒连续发放，按活跃流动性份额实时累计，LP 需主动领取（claim）才能到账，没有固定结算周期。";
export const SERIES_DAYS = [7, 14, 30];
export const EXAMPLE_WIDTHS = [0.01, 0.1];
const NO_INCENTIVE = "无激励";

export function seriesRange(nowMs, dayCount, offsetHours) {
  const todayStart = startOfDay(nowMs, offsetHours);
  const lastStart = todayStart - DAY_MS;
  const firstStart = lastStart - (dayCount - 1) * DAY_MS;
  return {
    fromMs: firstStart,
    toMs: lastStart + 23 * HOUR_MS,
    calcToMs: lastStart + DAY_MS,
  };
}

const SOURCE_SPECS = [
  { id: "snapshot", name: "链上快照" },
  { id: "cetus", name: "Cetus 成交统计" },
  { id: "ohlcv", name: "GeckoTerminal K 线" },
];

function protocolRate(params) {
  if (!params) return null;
  return params.protocol_fee_rate ?? params.protocolFeeRate ?? null;
}

function decimalsOf(symbol, appConfig) {
  if (symbol === appConfig.pool.coinA.symbol) return appConfig.pool.coinA.decimals;
  if (symbol === appConfig.pool.coinB.symbol) return appConfig.pool.coinB.decimals;
  const found = appConfig.incentivePools?.find((item) => item.symbol === symbol);
  return found ? found.decimalsB : null;
}

function formatPercent(rate) {
  const pct = rate * 100;
  const digits = Number.isInteger(pct) ? 0 : 2;
  return pct.toFixed(digits) + "%";
}

function exampleLabel(width) {
  return "$10,000 ±" + (width * 100) + "%";
}

export function collectionSources({ snapshotAt = null, cetusAt = null, ohlcvAt = null, now, staleMs, offsetHours }) {
  const times = { snapshot: snapshotAt, cetus: cetusAt, ohlcv: ohlcvAt };
  const sources = SOURCE_SPECS.map((spec) => {
    const collectedAt = times[spec.id] ?? null;
    return {
      id: spec.id,
      name: spec.name,
      collectedAt,
      label: formatDateTime(collectedAt, offsetHours),
      stale: collectedAt == null || now - collectedAt > staleMs,
    };
  });
  const staleOnes = sources.filter((item) => item.stale);
  const hours = staleMs / HOUR_MS;
  const staleBanner = staleOnes.length
    ? "数据已过期：" + staleOnes.map((item) => (
      item.collectedAt == null
        ? item.name + "尚未成功采集"
        : item.name + "最后成功采集于 " + item.label
    )).join("；") + "，已超过 " + hours + " 小时。"
    : null;
  return { sources, stale: staleOnes.length > 0, staleBanner };
}

function incentiveRows(snapshot, appConfig) {
  const row = asSnapshot(snapshot);
  if (!row) return { incentiveStatus: STATUS.insufficient, incentives: [] };
  const rows = row.rewarders.filter((item) => item.coin && item.emissionsPerSecond != null).map((item) => {
    const symbol = symbolFromCoin(item.coin);
    const decimals = decimalsOf(symbol, appConfig);
    if (decimals == null) {
      return { symbol, coin: item.coin, perSecond: null, perDay: null, settlement: SETTLEMENT, status: STATUS.insufficient };
    }
    return {
      symbol,
      coin: item.coin,
      perSecond: humanEmissionPerSecond(item.emissionsPerSecond, decimals),
      perDay: humanEmissionPerDay(item.emissionsPerSecond, decimals),
      settlement: SETTLEMENT,
      status: STATUS.ok,
    };
  });
  if (!rows.length || rows.every((item) => item.perSecond === 0)) {
    return { incentiveStatus: NO_INCENTIVE, incentives: [] };
  }
  const incentives = rows.filter((item) => item.perSecond !== 0);
  const incentiveStatus = incentives.some((item) => item.status === STATUS.insufficient) ? STATUS.insufficient : STATUS.ok;
  return { incentiveStatus, incentives };
}

export function buildPool({ snapshot, params, sources, appConfig }) {
  const row = asSnapshot(snapshot);
  const protocolFeeRate = protocolRate(params);
  const rates = row && protocolFeeRate != null ? feeRates(row.feeRate, protocolFeeRate) : null;
  const incentive = incentiveRows(snapshot, appConfig);
  const offset = appConfig.timezoneOffsetHours;
  return {
    address: appConfig.pool.address,
    name: appConfig.pool.name,
    pair: appConfig.pool.coinA.symbol + "/" + appConfig.pool.coinB.symbol,
    cetusUrl: "https://app.cetus.zone/clmm?poolAddress=" + appConfig.pool.address,
    feeRate: rates ? { raw: String(row.feeRate), rate: rates.trade, display: formatPercent(rates.trade) } : null,
    protocolFeeRate: rates ? { raw: String(protocolFeeRate), rate: rates.protocol, display: formatPercent(rates.protocol) } : null,
    lpFeeRate: rates ? { rate: rates.lp, display: formatPercent(rates.lp) } : null,
    tickSpacing: row?.tickSpacing ?? null,
    decimalsA: appConfig.pool.coinA.decimals,
    decimalsB: appConfig.pool.coinB.decimals,
    asOf: row ? {
      hourTs: row.hourTs,
      checkpoint: row.checkpoint,
      checkpointTs: row.checkpointTs,
      label: formatDateTime(row.hourTs, offset),
    } : null,
    incentives: incentive.incentives,
    incentiveStatus: incentive.incentiveStatus,
    settlement: SETTLEMENT,
    ...sources,
  };
}

function shapeExample(width, result) {
  return {
    width,
    label: exampleLabel(width),
    capital: 10000,
    fee: result.fee,
    inRangeHours: result.inRangeHours,
    validHours: result.validHours,
    openPrice: result.openPrice,
    pa: result.pa,
    pb: result.pb,
    tickLow: result.tickLow,
    tickHigh: result.tickHigh,
    lRaw: result.lRaw,
    sui: result.sui,
    usdc: result.usdc,
    status: result.status,
  };
}

function emptyExample(width) {
  return shapeExample(width, {
    fee: null,
    inRangeHours: 0,
    validHours: 0,
    openPrice: null,
    pa: null,
    pb: null,
    tickLow: null,
    tickHigh: null,
    lRaw: null,
    sui: null,
    usdc: null,
    status: STATUS.insufficient,
  });
}

function denseSnapshots(rows, startMs, endMs) {
  const byHour = new Map();
  for (const row of rows) {
    const snapshot = asSnapshot(row);
    if (snapshot?.hourTs != null) byHour.set(snapshot.hourTs, row);
  }
  const out = [];
  for (let ts = startMs; ts <= endMs; ts += HOUR_MS) out.push(byHour.get(ts) ?? null);
  return out;
}

function pointLabel(utcMs, offsetHours) {
  const parsed = typeof utcMs === "number" ? utcMs : Date.parse(utcMs);
  return formatDateTime(Number.isFinite(parsed) ? parsed : null, offsetHours);
}

export function buildRevenue({
  snapshot,
  params,
  stats,
  snapshots = [],
  prices = [],
  candles = [],
  reconcileCandles,
  sources,
  appConfig,
  now,
}) {
  const row = asSnapshot(snapshot);
  const offset = appConfig.timezoneOffsetHours;
  const decimalsA = appConfig.pool.coinA.decimals;
  const decimalsB = appConfig.pool.coinB.decimals;
  const protocolFeeRate = protocolRate(params);
  let price = { value: null, status: STATUS.insufficient, checkpoint: null, checkpointTs: null, hourTs: null, label: null };
  let liquidity = { raw: null, status: STATUS.insufficient, hourTs: null, label: null };
  let depth = { status: STATUS.insufficient };
  if (row) {
    const current = currentPool(row, decimalsA, decimalsB);
    const label = pointLabel(row.checkpointTs, offset) || formatDateTime(row.hourTs, offset);
    price = {
      value: current.price,
      status: STATUS.ok,
      checkpoint: row.checkpoint,
      checkpointTs: row.checkpointTs,
      hourTs: row.hourTs,
      label,
    };
    liquidity = { raw: String(row.liquidity), status: STATUS.ok, hourTs: row.hourTs, label };
    if (row.tickSpacing) {
      depth = {
        status: STATUS.ok,
        tickSpacing: row.tickSpacing,
        ...tickDepth({
          tick: row.tick,
          tickSpacing: row.tickSpacing,
          liquidity: row.liquidity,
          price: current.price,
          decimalsA,
          decimalsB,
        }),
      };
    }
  }
  const sampledAt = stats?.sampled_at ?? stats?.sampledAt ?? null;
  const fee = poolFee24h({
    vol: stats?.vol_24h ?? stats?.vol24h ?? null,
    fee: stats?.fee_24h ?? stats?.fee24h ?? null,
    protocolFeeRate,
    sampledAt,
    now,
    staleMs: appConfig.staleMs,
  });
  const fee24h = {
    gross: fee.gross,
    lpNet: fee.lpNet,
    volume: fee.volume,
    sampledAt: fee.sampledAt,
    sampledAtLabel: formatDateTime(fee.sampledAt, offset),
    source: "Cetus 官方统计",
    window: "由 Cetus 定义",
    status: fee.status,
    stale: fee.stale,
  };
  const summed = sumCompletedCandles(reconcileCandles ?? candles, Math.floor(now / 1000), 24);
  const reconcile = fee.volume == null || summed.count < 24
    ? {
      cetusVol: fee.volume,
      candleVol: summed.count ? summed.volumeUsd : null,
      deviation: null,
      candleCount: summed.count,
      status: STATUS.insufficient,
    }
    : {
      ...reconcileVolumes({
        cetusVol: fee.volume,
        candleVol: summed.volumeUsd,
        threshold: appConfig.reconcileThreshold,
      }),
      candleCount: summed.count,
    };
  let incentives24h = {
    status: STATUS.insufficient,
    totalUsd: null,
    tokens: [],
    startMs: null,
    endMs: null,
    startLabel: null,
    endLabel: null,
    validHours: 0,
  };
  let unitFee24h = {
    status: STATUS.insufficient,
    perRawL: null,
    per1e12: null,
    startMs: null,
    endMs: null,
    startLabel: null,
    endLabel: null,
    validHours: 0,
  };
  let examples = EXAMPLE_WIDTHS.map((width) => emptyExample(width));
  if (row) {
    const endMs = row.hourTs;
    const startMs = endMs - 24 * HOUR_MS;
    const unit = unitFeeWindow(denseSnapshots(snapshots, startMs, endMs), { decimalsA, decimalsB });
    unitFee24h = {
      status: unit.status,
      perRawL: unit.perRawL,
      per1e12: unit.perRawL == null ? null : unit.perRawL * 1e12,
      startMs,
      endMs,
      startLabel: formatDateTime(startMs, offset),
      endLabel: formatDateTime(endMs, offset),
      validHours: unit.validHours,
    };
    const income = incentiveIncome24h({ snapshots, prices, appConfig, startMs, endMs });
    incentives24h = {
      status: income.status,
      totalUsd: income.totalUsd,
      tokens: income.tokens,
      startMs: income.startMs,
      endMs: income.endMs,
      startLabel: formatDateTime(income.startMs, offset),
      endLabel: formatDateTime(income.endMs, offset),
      validHours: income.validHours,
    };
    examples = EXAMPLE_WIDTHS.map((width) => shapeExample(width, exampleWindowFee({
      startMs,
      snapshots,
      candles,
      width,
      decimalsA,
      decimalsB,
      hours: 24,
      tickSpacing: row.tickSpacing,
    })));
  }
  return { price, liquidity, depth, fee24h, reconcile, incentives24h, unitFee24h, examples, ...sources };
}

function feePoint(point) {
  return {
    date: point.date,
    dayStartMs: point.dayStartMs,
    fee: point.fee,
    volumeUsd: point.volumeUsd,
    candleCount: point.candleCount,
    status: point.status,
  };
}

function positionPoint(point) {
  return {
    date: point.date,
    dayStartMs: point.dayStartMs,
    fee: point.fee,
    openPrice: point.openPrice,
    pa: point.pa,
    pb: point.pb,
    tickLow: point.tickLow,
    tickHigh: point.tickHigh,
    lRaw: point.lRaw,
    sui: point.sui,
    usdc: point.usdc,
    inRangeHours: point.inRangeHours,
    validHours: point.validHours,
    status: point.status,
  };
}

export function buildSeries({ n, snapshots = [], candles = [], appConfig, now }) {
  const offsetHours = appConfig.timezoneOffsetHours;
  const range = seriesRange(now, n, offsetHours);
  const latest = snapshots.map(asSnapshot).filter(Boolean).sort((a, b) => b.hourTs - a.hourTs)[0];
  const decimalsA = appConfig.pool.coinA.decimals;
  const decimalsB = appConfig.pool.coinB.decimals;
  const fees = dailyFeeSeries({
    candles,
    snapshots,
    offsetHours,
    nowMs: now,
    fromMs: range.fromMs,
    toMs: range.toMs,
  }).map(feePoint);
  const positions = EXAMPLE_WIDTHS.map((width) => ({
    width,
    label: exampleLabel(width),
    points: exampleDailySeries({
      snapshots,
      candles,
      width,
      decimalsA,
      decimalsB,
      offsetHours,
      nowMs: now,
      fromMs: range.fromMs,
      toMs: range.toMs,
      tickSpacing: latest?.tickSpacing ?? null,
    }).map(positionPoint),
  }));
  const liquidity = liquiditySeries({ snapshots, fromMs: range.fromMs, toMs: range.toMs }).map((point) => ({
    hourTs: point.hourTs,
    liquidity: point.liquidity,
    label: formatDateTime(point.hourTs, offsetHours),
  }));
  return { n, fromMs: range.fromMs, toMs: range.toMs, fees, positions, liquidity };
}

export function parseSeriesN(value) {
  if (value == null || value === "") return 7;
  if (!/^[0-9]+$/.test(String(value))) return null;
  const dayCount = Number(value);
  return SERIES_DAYS.includes(dayCount) ? dayCount : null;
}

