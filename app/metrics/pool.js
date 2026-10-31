import { rawPerHumanL, sqrtPriceToHuman, tickSegment, tickToHumanPrice } from "../lib/math.js";
import { asCandle, asSnapshot } from "./rows.js";
import { STATUS } from "./status.js";

const FEE_RATE_UNIT = 1e6;
const PROTOCOL_FEE_UNIT = 1e4;

export function feeRates(feeRate, protocolFeeRate) {
  const trade = Number(feeRate) / FEE_RATE_UNIT;
  const protocol = Number(protocolFeeRate) / PROTOCOL_FEE_UNIT;
  return { trade, protocol, lp: trade * (1 - protocol) };
}

export function currentPool(row, decimalsA, decimalsB) {
  const snapshot = asSnapshot(row);
  return {
    price: sqrtPriceToHuman(snapshot.sqrtPrice, decimalsA, decimalsB),
    liquidity: String(snapshot.liquidity),
    tick: snapshot.tick,
    hourTs: snapshot.hourTs,
    checkpoint: snapshot.checkpoint,
    checkpointTs: snapshot.checkpointTs,
  };
}

export function tickDepth({ tick, tickSpacing, liquidity, price, decimalsA, decimalsB }) {
  const segment = tickSegment(tick, tickSpacing);
  const priceHigh = tickToHumanPrice(segment.lower, decimalsA, decimalsB);
  const priceLow = tickToHumanPrice(segment.upper, decimalsA, decimalsB);
  const priceNow = price ?? tickToHumanPrice(tick, decimalsA, decimalsB);
  const humanL = Number(liquidity) / rawPerHumanL(decimalsA, decimalsB);
  const usdc = humanL * (Math.sqrt(priceHigh) - Math.sqrt(priceLow));
  const sui = humanL * (1 / Math.sqrt(priceLow) - 1 / Math.sqrt(priceHigh));
  return {
    tickLower: segment.lower,
    tickUpper: segment.upper,
    priceLow,
    priceHigh,
    price: priceNow,
    width: priceHigh / priceLow - 1,
    usdc,
    sui,
    suiValue: sui * priceNow,
    toLowerUsdc: humanL * (Math.sqrt(priceNow) - Math.sqrt(priceLow)),
    toUpperSui: humanL * (1 / Math.sqrt(priceNow) - 1 / Math.sqrt(priceHigh)),
  };
}

export function poolFee24h({ vol, fee, protocolFeeRate, sampledAt = null, now = null, staleMs = null }) {
  if (fee == null || vol == null || protocolFeeRate == null) {
    return { status: STATUS.insufficient, gross: null, lpNet: null, volume: null, sampledAt, stale: false };
  }
  const protocol = Number(protocolFeeRate) / PROTOCOL_FEE_UNIT;
  const gross = Number(fee);
  const stale = staleMs != null && now != null && sampledAt != null && now - sampledAt > staleMs;
  return {
    status: stale ? STATUS.stale : STATUS.ok,
    gross,
    lpNet: gross * (1 - protocol),
    volume: Number(vol),
    sampledAt,
    stale,
  };
}

export function sumCompletedCandles(candles, nowSec, count = 24) {
  const done = candles
    .map(asCandle)
    .filter((candle) => candle.startTs + 3600 <= nowSec)
    .sort((a, b) => b.startTs - a.startTs)
    .slice(0, count);
  return {
    volumeUsd: done.reduce((sum, candle) => sum + candle.volumeUsd, 0),
    count: done.length,
  };
}

export function reconcileVolumes({ cetusVol, candleVol, threshold }) {
  const cetus = Number(cetusVol);
  const candle = Number(candleVol);
  const deviation = (cetus - candle) / cetus;
  return {
    cetusVol: cetus,
    candleVol: candle,
    deviation,
    status: Math.abs(deviation) <= threshold ? STATUS.consistent : STATUS.inconsistent,
  };
}
