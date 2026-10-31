import { DAY_MS, formatDay, hoursBetween, startOfDay } from "../lib/time.js";
import { asCandle, asSnapshot } from "./rows.js";
import { STATUS } from "./status.js";

const FEE_RATE_UNIT = 1e6;

export function endedDayStarts({ candles = [], offsetHours, nowMs, fromMs, toMs }) {
  const times = candles.map((candle) => Number(candle.startTs ?? candle.start_ts) * 1000);
  const first = fromMs ?? (times.length ? Math.min(...times) : null);
  const last = toMs ?? (times.length ? Math.max(...times) : null);
  if (first == null || last == null || !Number.isFinite(first) || !Number.isFinite(last)) return [];
  const days = [];
  for (let day = startOfDay(first, offsetHours); day <= startOfDay(last, offsetHours); day += DAY_MS) {
    if (nowMs != null && day + DAY_MS > nowMs) continue;
    days.push(day);
  }
  return days;
}

function groupedCandles(candles, offsetHours) {
  const grouped = new Map();
  for (const candle of candles.map(asCandle)) {
    const day = startOfDay(candle.startTs * 1000, offsetHours);
    const list = grouped.get(day) ?? [];
    list.push(candle);
    grouped.set(day, list);
  }
  return grouped;
}

function dayStatus(count) {
  if (count <= 0) return STATUS.missing;
  if (count < 24) return STATUS.partial;
  return STATUS.ok;
}

function lastFeeRate(snapshots, day, offsetHours) {
  const inDay = snapshots
    .map(asSnapshot)
    .filter((row) => row && row.hourTs != null && startOfDay(row.hourTs, offsetHours) === day && row.feeRate != null)
    .sort((a, b) => a.hourTs - b.hourTs);
  return inDay.length ? inDay[inDay.length - 1].feeRate : null;
}

export function dailyFeeSeries({ candles, snapshots = [], offsetHours, nowMs, fromMs, toMs }) {
  const grouped = groupedCandles(candles, offsetHours);
  return endedDayStarts({ candles, offsetHours, nowMs, fromMs, toMs }).map((day) => {
    const rows = grouped.get(day) ?? [];
    const volumeUsd = rows.reduce((sum, row) => sum + row.volumeUsd, 0);
    const feeRate = lastFeeRate(snapshots, day, offsetHours);
    return {
      date: formatDay(day, offsetHours),
      dayStartMs: day,
      fee: rows.length > 0 && feeRate != null ? (volumeUsd * Number(feeRate)) / FEE_RATE_UNIT : null,
      volumeUsd: rows.length ? volumeUsd : null,
      feeRate,
      candleCount: rows.length,
      status: dayStatus(rows.length),
    };
  });
}

export function liquiditySeries({ snapshots, fromMs, toMs }) {
  const byHour = new Map();
  for (const row of snapshots) {
    const snapshot = asSnapshot(row);
    if (snapshot?.hourTs != null) byHour.set(snapshot.hourTs, snapshot.liquidity);
  }
  return hoursBetween(fromMs, toMs).map((hourTs) => ({
    hourTs,
    liquidity: byHour.has(hourTs) ? String(byHour.get(hourTs)) : null,
  }));
}

