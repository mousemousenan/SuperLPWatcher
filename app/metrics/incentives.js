import { q64ToNumber, sqrtPriceToHuman } from "../lib/math.js";
import { HOUR_MS } from "../lib/time.js";
import { asPrice, asSnapshot, symbolFromCoin } from "./rows.js";
import { STATUS } from "./status.js";

export function humanEmissionPerSecond(emissionsPerSecond, decimals) {
  return q64ToNumber(emissionsPerSecond) / 10 ** decimals;
}

export function humanEmissionPerDay(emissionsPerSecond, decimals) {
  return humanEmissionPerSecond(emissionsPerSecond, decimals) * 86400;
}

function decimalsOf(symbol, appConfig) {
  if (symbol === appConfig.pool.coinA.symbol) return appConfig.pool.coinA.decimals;
  if (symbol === appConfig.pool.coinB.symbol) return appConfig.pool.coinB.decimals;
  const found = appConfig.incentivePools?.find((item) => item.symbol === symbol);
  return found ? found.decimalsB : null;
}

function priceOf(symbol, snapshot, priceMap, appConfig) {
  if (symbol === appConfig.pool.coinB.symbol) {
    return sqrtPriceToHuman(snapshot.sqrtPrice, appConfig.pool.coinA.decimals, appConfig.pool.coinB.decimals);
  }
  if (symbol === appConfig.pool.coinA.symbol) return 1;
  const value = priceMap.get(`${snapshot.hourTs}:${symbol}`);
  return value == null ? null : value;
}

export function incentiveIncome24h({ snapshots, prices = [], appConfig, startMs, endMs }) {
  const points = snapshots.map(asSnapshot).filter(Boolean);
  const byHour = new Map(points.map((row) => [row.hourTs, row]));
  const priceMap = new Map(prices.map(asPrice).map((row) => [`${row.hourTs}:${row.symbol}`, row.price]));
  const start = startMs ?? points[0]?.hourTs ?? null;
  const end = endMs ?? (start == null ? null : start + 24 * HOUR_MS);
  if (start == null || end == null || end <= start) {
    return { status: STATUS.insufficient, startMs: start, endMs: end, tokens: [], totalUsd: null, validHours: 0 };
  }
  const tokens = new Map();
  let hours = 0;
  let missingHours = 0;
  for (let ts = start; ts < end; ts += HOUR_MS) {
    hours += 1;
    const snapshot = byHour.get(ts);
    if (!snapshot) {
      missingHours += 1;
      continue;
    }
    for (const rewarder of snapshot.rewarders) {
      if (rewarder.emissionsPerSecond == null || rewarder.coin == null) continue;
      const symbol = symbolFromCoin(rewarder.coin);
      const decimals = decimalsOf(symbol, appConfig);
      if (decimals == null) continue;
      const amount = humanEmissionPerSecond(rewarder.emissionsPerSecond, decimals) * (HOUR_MS / 1000);
      const price = priceOf(symbol, snapshot, priceMap, appConfig);
      const current = tokens.get(symbol) ?? {
        symbol,
        coin: rewarder.coin,
        amount: 0,
        usd: 0,
        priceMissing: false,
      };
      current.amount += amount;
      if (price == null) current.priceMissing = true;
      else current.usd += amount * price;
      tokens.set(symbol, current);
    }
  }
  const list = [...tokens.values()].map((token) => ({
    symbol: token.symbol,
    coin: token.coin,
    amount: token.amount,
    usd: token.priceMissing ? null : token.usd,
    status: token.priceMissing ? STATUS.priceMissing : STATUS.ok,
  }));
  const priceMissing = list.some((token) => token.status === STATUS.priceMissing);
  let status = STATUS.ok;
  if (hours === 0 || missingHours === hours) status = STATUS.insufficient;
  else if (priceMissing) status = STATUS.priceMissing;
  else if (missingHours > 0) status = STATUS.partial;
  return {
    status,
    startMs: start,
    endMs: end,
    tokens: list,
    totalUsd: priceMissing || status === STATUS.insufficient ? null : list.reduce((sum, token) => sum + token.usd, 0),
    validHours: hours - missingHours,
  };
}
