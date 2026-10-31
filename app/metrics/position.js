import { liquidityForCapital, outwardRange, sqrtPriceToHuman } from "../lib/math.js";
import { HOUR_MS, formatDay } from "../lib/time.js";
import { endedDayStarts } from "./daily.js";
import { asCandle, asSnapshot } from "./rows.js";
import { STATUS } from "./status.js";
import { unitFeeBetween } from "./unit-fee.js";

export const EXAMPLE_CAPITAL = 10000;

export function overlapFraction(low, high, close, pa, pb) {
  if (!(high >= low)) return null;
  if (high === low) {
    if (close == null) return null;
    return close >= pa && close <= pb ? 1 : 0;
  }
  const overlap = Math.max(0, Math.min(high, pb) - Math.max(low, pa));
  return overlap / (high - low);
}

export function accruePositionFee(lRaw, hours) {
  let fee = 0;
  let inRangeHours = 0;
  let validHours = 0;
  for (const hour of hours) {
    if (hour == null || hour.unitFee == null) continue;
    const fraction = hour.fraction ?? overlapFraction(hour.low, hour.high, hour.close, hour.pa, hour.pb);
    if (fraction == null) continue;
    fee += lRaw * hour.unitFee * fraction;
    inRangeHours += fraction;
    validHours += 1;
  }
  const status = validHours === 0 ? STATUS.insufficient : validHours === hours.length ? STATUS.ok : STATUS.partial;
  return {
    fee: validHours === 0 ? null : fee,
    inRangeHours,
    validHours,
    status,
  };
}

export function examplePositionFee({
  price,
  tickSpacing,
  width,
  capital = EXAMPLE_CAPITAL,
  decimalsA,
  decimalsB,
  hours,
}) {
  const range = outwardRange(price, width, tickSpacing, decimalsA, decimalsB);
  const opened = liquidityForCapital(capital, price, range.pa, range.pb, decimalsA, decimalsB);
  const slots = hours.map((hour) => {
    if (hour == null || hour.fraction != null || hour.low == null) return hour;
    return { ...hour, pa: range.pa, pb: range.pb };
  });
  const accrued = accruePositionFee(opened.lRaw, slots);
  return {
    ...accrued,
    openPrice: price,
    pa: range.pa,
    pb: range.pb,
    tickLow: range.tickLow,
    tickHigh: range.tickHigh,
    lRaw: opened.lRaw,
    sui: opened.coinB,
    usdc: opened.coinA,
  };
}

export function exampleFromGrid({
  startMs,
  snapshots,
  candles,
  width,
  capital = EXAMPLE_CAPITAL,
  decimalsA,
  decimalsB,
  hours = 24,
  tickSpacing = null,
}) {
  const byHour = new Map(snapshots.map(asSnapshot).filter(Boolean).map((row) => [row.hourTs, row]));
  const byCandle = new Map(candles.map(asCandle).map((row) => [row.startTs, row]));
  const open = byHour.get(startMs);
  if (!open || open.sqrtPrice == null) {
    return {
      fee: null,
      openPrice: null,
      pa: null,
      pb: null,
      lRaw: null,
      sui: null,
      usdc: null,
      inRangeHours: 0,
      validHours: 0,
      status: STATUS.insufficient,
    };
  }
  const price = sqrtPriceToHuman(open.sqrtPrice, decimalsA, decimalsB);
  const spacing = Number(open.tickSpacing ?? tickSpacing);
  const slots = [];
  for (let i = 0; i < hours; i += 1) {
    const ts = startMs + i * HOUR_MS;
    const start = byHour.get(ts);
    const end = byHour.get(ts + HOUR_MS);
    const candle = byCandle.get(ts / 1000);
    if (!start || !end || !candle) {
      slots.push(null);
      continue;
    }
    const unit = unitFeeBetween(start, end, { decimalsA, decimalsB });
    slots.push(unit.missing ? null : {
      unitFee: unit.perRawL,
      low: candle.low,
      high: candle.high,
      close: candle.close,
    });
  }
  return examplePositionFee({
    price,
    tickSpacing: spacing,
    width,
    capital,
    decimalsA,
    decimalsB,
    hours: slots,
  });
}

export function exampleWindowFee(args) {
  return exampleFromGrid(args);
}

export function exampleDailySeries({
  snapshots,
  candles,
  width,
  capital = EXAMPLE_CAPITAL,
  decimalsA,
  decimalsB,
  offsetHours,
  nowMs,
  fromMs,
  toMs,
  tickSpacing = null,
}) {
  return endedDayStarts({ candles, offsetHours, nowMs, fromMs, toMs }).map((dayStartMs) => ({
    date: formatDay(dayStartMs, offsetHours),
    dayStartMs,
    ...exampleFromGrid({
      startMs: dayStartMs,
      snapshots,
      candles,
      width,
      capital,
      decimalsA,
      decimalsB,
      tickSpacing,
    }),
  }));
}
