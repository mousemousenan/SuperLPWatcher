import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import {
  decodeTickBits,
  outwardRange,
  q64ToNumber,
  relativeDiff,
  sqrtPriceToHuman,
  tickSegment,
  wrapSubU128,
} from "../lib/math.js";
import { DAY_MS, HOUR_MS, formatDay, startOfDay } from "../lib/time.js";
import { dailyFeeSeries, liquiditySeries } from "../metrics/daily.js";
import { humanEmissionPerDay, humanEmissionPerSecond, incentiveIncome24h } from "../metrics/incentives.js";
import { currentPool, feeRates, poolFee24h, reconcileVolumes, sumCompletedCandles, tickDepth } from "../metrics/pool.js";
import { accruePositionFee, exampleDailySeries, examplePositionFee, exampleWindowFee, overlapFraction } from "../metrics/position.js";
import { STATUS } from "../metrics/status.js";
import { unitFeeBetween, unitFeeWindow } from "../metrics/unit-fee.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SQRT = "609642842451606482089";
const DEC_A = config.pool.coinA.decimals;
const DEC_B = config.pool.coinB.decimals;
const OFFSET = config.timezoneOffsetHours;

function readScratch(name) {
  return JSON.parse(fs.readFileSync(path.join(root, "scratch", name), "utf8"));
}

function flatCandle(startTs, volumeUsd, price = 1) {
  return { startTs, open: price, high: price, low: price, close: price, volumeUsd };
}

test("5.1 wraps u128, converts the sqrt price, and decodes a negative tick", () => {
  assert.equal(wrapSubU128(20n, 5n), 15n);
  assert.equal(wrapSubU128(5n, (1n << 128n) - 10n), 15n);
  assert.ok(Math.abs(sqrtPriceToHuman(SQRT, DEC_A, DEC_B) - 0.9156) < 0.0001);
  assert.equal(decodeTickBits(69963), 69963);
  assert.equal(decodeTickBits(4294967235), -61);
  assert.deepEqual(tickSegment(-61, 60), { lower: -120, upper: -60 });
  assert.deepEqual(tickSegment(5, 1), { lower: 5, upper: 6 });
  const wrapped = unitFeeBetween(
    { sqrtPrice: SQRT, feeGrowthGlobalA: ((1n << 128n) - 5n).toString(), feeGrowthGlobalB: "0" },
    { sqrtPrice: SQRT, feeGrowthGlobalA: "3", feeGrowthGlobalB: "0" },
    { decimalsA: DEC_A, decimalsB: DEC_B },
  );
  assert.ok(wrapped.perRawL > 0);
  assert.ok(Math.abs(wrapped.quoteA - q64ToNumber(8n) / 10 ** DEC_A) < 1e-18);
});

test("5.2 fee rates and current liquidity come from the same snapshot", () => {
  const rates = feeRates("2500", "2000");
  assert.equal((rates.trade * 100).toFixed(2), "0.25");
  assert.equal((rates.protocol * 100).toFixed(0), "20");
  assert.equal((rates.lp * 100).toFixed(2), "0.20");
  const current = currentPool(
    { sqrtPrice: SQRT, liquidity: "286000000000000", tick: 69963, hourTs: 5, checkpointTs: "t" },
    DEC_A,
    DEC_B,
  );
  assert.ok(Math.abs(current.price - 0.9156) < 0.0001);
  assert.equal(current.liquidity, "286000000000000");
  assert.equal(current.tick, 69963);
  assert.equal(current.hourTs, 5);
  assert.equal(current.checkpointTs, "t");
});

test("5.3 tick depth matches both numeric examples and a negative tick", () => {
  const depth = tickDepth({ tick: 69963, tickSpacing: 60, liquidity: 2.86e14, decimalsA: DEC_A, decimalsB: DEC_B });
  assert.equal(depth.tickLower, 69960);
  assert.equal(depth.tickUpper, 70020);
  assert.equal(depth.priceLow.toFixed(4), "0.9104");
  assert.equal(depth.priceHigh.toFixed(4), "0.9159");
  assert.equal((depth.width * 100).toFixed(2), "0.60");
  assert.equal(depth.price.toFixed(4), "0.9156");
  assert.equal(Math.round(depth.usdc), 25926);
  assert.equal(Math.round(depth.sui), 28392);
  assert.equal(Math.round(depth.suiValue), 25996);
  assert.equal(Math.round(depth.toLowerUsdc), 24627);
  assert.equal(Math.round(depth.toUpperSui), 1418);
  const negative = tickDepth({ tick: -61, tickSpacing: 60, liquidity: 1, decimalsA: DEC_A, decimalsB: DEC_B });
  assert.equal(negative.tickLower, -120);
  assert.equal(negative.tickUpper, -60);
});

test("5.4 reads the Cetus 24h fee and reconciles completed candles", () => {
  const fee = poolFee24h({
    vol: "5310334.24",
    fee: "13275.84",
    protocolFeeRate: "2000",
    sampledAt: 10,
    now: 10,
    staleMs: config.staleMs,
  });
  const otherLiquidity = poolFee24h({
    vol: "5310334.24",
    fee: "13275.84",
    protocolFeeRate: "2000",
    liquidity: "1e30",
  });
  assert.equal(fee.gross, 13275.84);
  assert.equal(fee.lpNet.toFixed(2), "10620.67");
  assert.equal(fee.volume, 5310334.24);
  assert.equal(fee.sampledAt, 10);
  assert.equal(fee.stale, false);
  assert.equal(fee.status, STATUS.ok);
  assert.equal(fee.lpNet, otherLiquidity.lpNet);
  const stale = poolFee24h({
    vol: "1",
    fee: "1",
    protocolFeeRate: "2000",
    sampledAt: 0,
    now: config.staleMs + 1,
    staleMs: config.staleMs,
  });
  assert.equal(stale.status, STATUS.stale);
  assert.equal(stale.gross, 1);
  const candles = Array.from({ length: 25 }, (_, index) => flatCandle(index * 3600, index + 1));
  const completed = sumCompletedCandles(candles, 25 * 3600 - 1);
  assert.equal(completed.count, 24);
  assert.equal(completed.volumeUsd, (24 * 25) / 2);
  const good = reconcileVolumes({ cetusVol: 3288612, candleVol: 3287709, threshold: config.reconcileThreshold });
  assert.equal(good.status, STATUS.consistent);
  assert.equal((good.deviation * 100).toFixed(2), "0.03");
  const bad = reconcileVolumes({ cetusVol: 100, candleVol: 108, threshold: config.reconcileThreshold });
  assert.equal(bad.status, STATUS.inconsistent);
  assert.equal(bad.deviation, -0.08);
  assert.equal(bad.cetusVol, 100);
  assert.equal(bad.candleVol, 108);
});

test("5.5 daily emissions match chain Q64 and stats_pools", () => {
  assert.equal(humanEmissionPerDay((1n << 64n).toString(), 8), 86400 / 1e8);
  const rewarders = readScratch("snaps.json").at(-1).rw;
  const cetus = rewarders.find((row) => row.coin === "CETUS");
  const sui = rewarders.find((row) => row.coin === "SUI");
  const cetusDecimals = config.incentivePools[0].decimalsB;
  const suiDecimals = config.pool.coinB.decimals;
  assert.ok(Math.abs(humanEmissionPerDay(cetus.eps, cetusDecimals) - 2000) < 1e-6);
  assert.ok(Math.abs(humanEmissionPerDay(sui.eps, suiDecimals) - 2184) < 1e-6);
  assert.ok(Math.abs(humanEmissionPerSecond(cetus.eps, cetusDecimals) - 0.0231481481481481) < 1e-12);
  assert.ok(Math.abs(humanEmissionPerSecond(sui.eps, suiDecimals) - 0.0252777777777778) < 1e-12);

  const snapshots = [];
  const prices = [];
  for (let index = 0; index < 24; index += 1) {
    const hourTs = index * HOUR_MS;
    snapshots.push({
      hourTs,
      sqrtPrice: SQRT,
      rewarders: [
        { coin: "06864a6f::cetus::CETUS", emissionsPerSecond: cetus.eps },
        { coin: "0x2::sui::SUI", emissionsPerSecond: sui.eps },
      ],
    });
    prices.push({ hourTs, symbol: "CETUS", price: 0.021008 });
    prices.push({ hourTs, symbol: "SUI", price: 5 });
  }
  const full = incentiveIncome24h({ snapshots, prices, appConfig: config, startMs: 0, endMs: 24 * HOUR_MS });
  const cetusRow = full.tokens.find((token) => token.symbol === "CETUS");
  const suiRow = full.tokens.find((token) => token.symbol === "SUI");
  const suiPrice = sqrtPriceToHuman(SQRT, DEC_A, DEC_B);
  assert.equal(full.status, STATUS.ok);
  assert.equal(full.startMs, 0);
  assert.equal(full.endMs, 24 * HOUR_MS);
  assert.ok(Math.abs(cetusRow.amount - 2000) < 1e-6);
  assert.ok(Math.abs(suiRow.amount - 2184) < 1e-6);
  assert.ok(relativeDiff(cetusRow.usd, 2000 * 0.021008) < 1e-9);
  assert.ok(relativeDiff(suiRow.usd, 2184 * suiPrice) < 1e-9);
  assert.ok(relativeDiff(full.totalUsd, cetusRow.usd + suiRow.usd) < 1e-9);

  const dropped = prices.filter((row) => !(row.hourTs === 0 && row.symbol === "CETUS"));
  const missing = incentiveIncome24h({ snapshots, prices: dropped, appConfig: config, startMs: 0, endMs: 24 * HOUR_MS });
  const missingCetus = missing.tokens.find((token) => token.symbol === "CETUS");
  assert.equal(missing.status, STATUS.priceMissing);
  assert.equal(missingCetus.usd, null);
  assert.equal(missing.totalUsd, null);
  assert.ok(Math.abs(missingCetus.amount - 2000) < 1e-6);
  assert.ok(missing.tokens.find((token) => token.symbol === "SUI").usd > 0);
});

test("5.6 24h unit L fee follows hourly start prices on scratch/hourly.json", () => {
  const hourly = readScratch("hourly.json");
  const last = hourly.slice(-25);
  const result = unitFeeWindow(last, { decimalsA: DEC_A, decimalsB: DEC_B });
  let spec = 0;
  let midpoint = 0;
  for (let index = 0; index < last.length - 1; index += 1) {
    const dA = q64ToNumber(wrapSubU128(last[index + 1].fga, last[index].fga));
    const dB = q64ToNumber(wrapSubU128(last[index + 1].fgb, last[index].fgb));
    const startPrice = sqrtPriceToHuman(last[index].sqrt, DEC_A, DEC_B);
    const endPrice = sqrtPriceToHuman(last[index + 1].sqrt, DEC_A, DEC_B);
    spec += dA / 10 ** DEC_A + (dB / 10 ** DEC_B) * startPrice;
    midpoint += dA / 10 ** DEC_A + (dB / 10 ** DEC_B) * ((startPrice + endPrice) / 2);
  }
  assert.equal(result.status, STATUS.ok);
  assert.equal(result.validHours, 24);
  assert.ok(result.perRawL < 1e-9);
  assert.ok(relativeDiff(result.perRawL, spec) < 1e-6);
  assert.ok(relativeDiff(spec, midpoint) < 0.001);
  assert.equal(unitFeeBetween(last[0], null, { decimalsA: DEC_A, decimalsB: DEC_B }).missing, true);

  let midpoint7 = 0;
  for (let index = 0; index < hourly.length - 1; index += 1) {
    const dA = q64ToNumber(wrapSubU128(hourly[index + 1].fga, hourly[index].fga));
    const dB = q64ToNumber(wrapSubU128(hourly[index + 1].fgb, hourly[index].fgb));
    const startPrice = sqrtPriceToHuman(hourly[index].sqrt, DEC_A, DEC_B);
    const endPrice = sqrtPriceToHuman(hourly[index + 1].sqrt, DEC_A, DEC_B);
    midpoint7 += dA / 10 ** DEC_A + (dB / 10 ** DEC_B) * ((startPrice + endPrice) / 2);
  }
  assert.equal(midpoint7.toExponential(3), "7.330e-11");
  const whole = unitFeeWindow(hourly, { decimalsA: DEC_A, decimalsB: DEC_B });
  assert.ok(relativeDiff(whole.perRawL, midpoint7) < 0.002);
});

test("5.7 daily fees use UTC+8 boundaries, the last snapshot fee rate, and blank liquidity hours", () => {
  const day28 = Date.parse("2026-10-27T16:00:00.000Z");
  assert.equal(startOfDay(day28, OFFSET), day28);
  assert.equal(startOfDay(day28 - 1, OFFSET), day28 - DAY_MS);
  assert.equal(formatDay(day28, OFFSET), "2026-10-28");
  assert.equal(formatDay(day28 - DAY_MS, OFFSET), "2026-10-27");

  const boundary = dailyFeeSeries({
    candles: [
      flatCandle(Date.parse("2026-10-27T15:00:00.000Z") / 1000, 100),
      flatCandle(day28 / 1000, 200),
    ],
    snapshots: [
      { hour_ts: Date.parse("2026-10-27T15:00:00.000Z"), fee_rate: "2500" },
      { hour_ts: day28, fee_rate: "3000" },
    ],
    offsetHours: OFFSET,
    nowMs: day28 + 2 * DAY_MS,
    fromMs: day28 - DAY_MS,
    toMs: day28,
  });
  const oct27 = boundary.find((row) => row.date === "2026-10-27");
  const oct28 = boundary.find((row) => row.date === "2026-10-28");
  assert.equal(oct27.volumeUsd, 100);
  assert.equal(oct27.feeRate, "2500");
  assert.equal(oct27.fee, 0.25);
  assert.equal(oct28.volumeUsd, 200);
  assert.equal(oct28.feeRate, "3000");
  assert.equal(oct28.fee, 0.6);

  const full = Array.from({ length: 24 }, (_, index) => flatCandle((day28 + index * HOUR_MS) / 1000, 5902860 / 24));
  const spec = dailyFeeSeries({
    candles: full,
    snapshots: [
      { hourTs: day28, feeRate: "1000" },
      { hourTs: day28 + 23 * HOUR_MS, feeRate: "2500" },
    ],
    offsetHours: OFFSET,
    nowMs: day28 + 2 * DAY_MS,
    fromMs: day28,
    toMs: day28,
  });
  assert.equal(spec.length, 1);
  assert.equal(spec[0].status, STATUS.ok);
  assert.equal(spec[0].candleCount, 24);
  assert.equal(spec[0].fee.toFixed(2), "14757.15");
  assert.equal(spec[0].volumeUsd, 5902860);

  const partial = dailyFeeSeries({
    candles: full.slice(0, 22),
    snapshots: [{ hourTs: day28 + 21 * HOUR_MS, feeRate: "2500" }],
    offsetHours: OFFSET,
    nowMs: day28 + 2 * DAY_MS,
    fromMs: day28,
    toMs: day28,
  });
  assert.equal(partial[0].status, STATUS.partial);
  assert.equal(partial[0].candleCount, 22);
  assert.equal(partial[0].fee, (5902860 / 24) * 22 * 0.0025);

  const openDay = dailyFeeSeries({
    candles: full,
    snapshots: [{ hourTs: day28, feeRate: "2500" }],
    offsetHours: OFFSET,
    nowMs: day28 + 12 * HOUR_MS,
    fromMs: day28,
    toMs: day28,
  });
  assert.equal(openDay.length, 0);

  const withGap = dailyFeeSeries({
    candles: full,
    snapshots: [],
    offsetHours: OFFSET,
    nowMs: day28 + 2 * DAY_MS,
    fromMs: day28 - DAY_MS,
    toMs: day28,
  });
  assert.equal(withGap.find((row) => row.date === "2026-10-27").status, STATUS.missing);
  assert.equal(withGap.find((row) => row.date === "2026-10-27").fee, null);

  const liquidity = liquiditySeries({
    snapshots: [
      { hourTs: 0, liquidity: "10" },
      { hourTs: 2 * HOUR_MS, liquidity: "30" },
    ],
    fromMs: 0,
    toMs: 2 * HOUR_MS,
  });
  assert.deepEqual(liquidity.map((point) => point.liquidity), ["10", null, "30"]);
});

test("5.9 overlap, one example day, and the in-range identity on scratch hours", () => {
  assert.ok(Math.abs(overlapFraction(0.9, 0.92, 0.91, 0.9049, 0.9269) - 0.755) < 1e-12);
  assert.equal(overlapFraction(0.88, 0.899, 0.89, 0.9049, 0.9269), 0);
  assert.equal(overlapFraction(0.91, 0.91, 0.91, 0.9, 0.92), 1);
  assert.equal(overlapFraction(0.91, 0.91, 0.8, 0.9, 0.92), 0);
  const hours = [
    { unitFee: 0.5 / 1e12, fraction: 0.755 },
    ...Array.from({ length: 23 }, () => ({ unitFee: 0.5 / 1e12, fraction: 0 })),
  ];
  const day = accruePositionFee(2.76e13, hours);
  assert.equal(day.status, STATUS.ok);
  assert.equal(day.fee.toFixed(2), "10.42");
  assert.ok(Math.abs(day.inRangeHours - 0.755) < 1e-12);
  const incomplete = accruePositionFee(2.76e13, [...hours.slice(0, 22), null, null]);
  assert.equal(incomplete.validHours, 22);
  assert.equal(incomplete.status, STATUS.partial);

  const slice = readScratch("hourly.json").slice(0, 25);
  const realHours = [];
  let sum = 0;
  for (let index = 0; index < 24; index += 1) {
    const unit = unitFeeBetween(slice[index], slice[index + 1], { decimalsA: DEC_A, decimalsB: DEC_B });
    realHours.push({ unitFee: unit.perRawL, fraction: 1 });
    sum += unit.perRawL;
  }
  const quoted = examplePositionFee({
    price: sqrtPriceToHuman(slice[0].sqrt, DEC_A, DEC_B),
    tickSpacing: 60,
    width: 0.1,
    decimalsA: DEC_A,
    decimalsB: DEC_B,
    hours: realHours,
  });
  assert.equal(quoted.status, STATUS.ok);
  assert.equal(quoted.validHours, 24);
  assert.ok(relativeDiff(quoted.fee, quoted.lRaw * sum) < 1e-9);
});

test("5.10 24h example positions match the open scenario and the same calendar day", () => {
  const narrow = outwardRange(0.9156, 0.01, 60, DEC_A, DEC_B);
  const wide = outwardRange(0.9156, 0.1, 60, DEC_A, DEC_B);
  assert.equal(narrow.pa.toFixed(4), "0.9049");
  assert.equal(narrow.pb.toFixed(4), "0.9269");
  assert.equal(narrow.tickHigh, 69840);
  assert.equal(narrow.tickLow, 70080);
  assert.equal(wide.pa.toFixed(4), "0.8221");
  assert.equal(wide.pb.toFixed(4), "1.0081");
  const unit = (10.5 / 24) / 1e12;
  const narrowHours = Array.from({ length: 24 }, (_, index) => ({ unitFee: unit, fraction: index < 8 ? 1 : 0 }));
  const wideHours = Array.from({ length: 24 }, () => ({ unitFee: unit, fraction: 1 }));
  const narrowFee = accruePositionFee(2.76e13, narrowHours);
  const wideFee = accruePositionFee(3.32e12, wideHours);
  assert.equal(narrowFee.inRangeHours, 8);
  assert.equal(narrowFee.fee.toFixed(1), "96.6");
  assert.equal(wideFee.inRangeHours, 24);
  assert.equal(wideFee.fee.toFixed(1), "34.9");

  const openedNarrow = examplePositionFee({
    price: 0.9156,
    tickSpacing: 60,
    width: 0.01,
    decimalsA: DEC_A,
    decimalsB: DEC_B,
    hours: narrowHours,
  });
  const openedWide = examplePositionFee({
    price: 0.9156,
    tickSpacing: 60,
    width: 0.1,
    decimalsA: DEC_A,
    decimalsB: DEC_B,
    hours: wideHours,
  });
  assert.equal(openedNarrow.lRaw.toExponential(2), "2.76e+13");
  assert.equal(Math.round(openedNarrow.sui), 5588);
  assert.equal(Math.round(openedNarrow.usdc), 4883);
  assert.equal(openedWide.lRaw.toExponential(2), "3.32e+12");
  assert.equal(Math.round(openedWide.sui), 5162);
  assert.equal(Math.round(openedWide.usdc), 5273);
  assert.ok(Math.abs(openedNarrow.fee - 96.6) < 0.1);
  assert.equal(openedWide.fee.toFixed(1), "34.9");
  const unavailable = examplePositionFee({
    price: 0.9156,
    tickSpacing: 60,
    width: 0.01,
    decimalsA: DEC_A,
    decimalsB: DEC_B,
    hours: Array.from({ length: 24 }, () => null),
  });
  assert.equal(unavailable.status, STATUS.insufficient);
  assert.equal(unavailable.fee, null);
  assert.equal(unavailable.pa.toFixed(4), "0.9049");
  assert.ok(unavailable.usdc > 0);

  const start = Date.parse("2026-10-27T16:00:00.000Z");
  const snapshots = [];
  const candles = [];
  for (let index = 0; index <= 24; index += 1) {
    snapshots.push({
      hourTs: start + index * HOUR_MS,
      sqrtPrice: SQRT,
      tickSpacing: 60,
      feeGrowthGlobalA: String(10n ** 15n + BigInt(index) * 10n ** 12n),
      feeGrowthGlobalB: String(10n ** 15n + BigInt(index) * 10n ** 12n),
    });
  }
  for (let index = 0; index < 24; index += 1) {
    candles.push({
      startTs: (start + index * HOUR_MS) / 1000,
      open: 0.91,
      high: 0.92,
      low: 0.9,
      close: 0.91,
      volumeUsd: 1,
    });
  }
  const daily = exampleDailySeries({
    snapshots,
    candles,
    width: 0.01,
    decimalsA: DEC_A,
    decimalsB: DEC_B,
    offsetHours: OFFSET,
    nowMs: start + 2 * DAY_MS,
    fromMs: start,
    toMs: start,
  });
  const windowFee = exampleWindowFee({
    startMs: start,
    snapshots,
    candles,
    width: 0.01,
    decimalsA: DEC_A,
    decimalsB: DEC_B,
  });
  assert.equal(daily.length, 1);
  assert.equal(daily[0].date, "2026-10-28");
  assert.equal(daily[0].status, STATUS.ok);
  assert.equal(daily[0].validHours, 24);
  assert.equal(daily[0].fee, windowFee.fee);
  assert.equal(daily[0].lRaw, windowFee.lRaw);
  assert.equal(daily[0].inRangeHours, windowFee.inRangeHours);
});
