import { q64ToNumber, sqrtPriceToHuman, wrapSubU128 } from "../lib/math.js";
import { asSnapshot } from "./rows.js";
import { STATUS } from "./status.js";

export function unitFeeBetween(startRow, endRow, { decimalsA, decimalsB }) {
  const start = asSnapshot(startRow);
  const end = asSnapshot(endRow);
  if (!start || !end || start.feeGrowthGlobalA == null || end.feeGrowthGlobalA == null) {
    return { missing: true, perRawL: null };
  }
  const dA = q64ToNumber(wrapSubU128(end.feeGrowthGlobalA, start.feeGrowthGlobalA));
  const dB = q64ToNumber(wrapSubU128(end.feeGrowthGlobalB, start.feeGrowthGlobalB));
  const price = sqrtPriceToHuman(start.sqrtPrice, decimalsA, decimalsB);
  const quoteA = dA / 10 ** decimalsA;
  const quoteB = (dB / 10 ** decimalsB) * price;
  return { missing: false, perRawL: quoteA + quoteB, quoteA, quoteB, price, dA, dB };
}

export function unitFeeWindow(rows, { decimalsA, decimalsB }) {
  const points = rows.map((row) => (row == null ? null : asSnapshot(row)));
  const hours = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    if (!points[i] || !points[i + 1]) hours.push({ missing: true, perRawL: null });
    else hours.push(unitFeeBetween(points[i], points[i + 1], { decimalsA, decimalsB }));
  }
  const valid = hours.filter((hour) => !hour.missing);
  if (hours.length === 0 || valid.length === 0) {
    return { status: STATUS.insufficient, perRawL: null, quoteA: null, quoteB: null, hours, validHours: 0 };
  }
  const missing = valid.length !== hours.length;
  const quoteA = missing
    ? valid.reduce((sum, hour) => sum + hour.quoteA, 0)
    : q64ToNumber(wrapSubU128(points.at(-1).feeGrowthGlobalA, points[0].feeGrowthGlobalA)) / 10 ** decimalsA;
  const quoteB = valid.reduce((sum, hour) => sum + hour.quoteB, 0);
  return {
    status: missing ? STATUS.partial : STATUS.ok,
    perRawL: quoteA + quoteB,
    quoteA,
    quoteB,
    hours,
    validHours: valid.length,
  };
}
