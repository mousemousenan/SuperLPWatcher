export function decodeTickBits(bits) {
  const value = Number(bits);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`invalid tick bits: ${bits}`);
  }
  return value >= 2 ** 31 ? value - 2 ** 32 : value;
}

export function sqrtPriceToHuman(sqrtX64, decimalsA, decimalsB) {
  const sqrt = Number(BigInt(sqrtX64)) / 2 ** 64;
  if (!(sqrt > 0)) throw new Error("invalid sqrt price");
  return humanPriceFromRawSquare(sqrt * sqrt, decimalsA, decimalsB);
}

export function humanPriceFromRawSquare(rawSquare, decimalsA, decimalsB) {
  if (!(rawSquare > 0)) throw new Error("invalid raw price square");
  return 10 ** (decimalsB - decimalsA) / rawSquare;
}

export function typeOrderOk(repr, coinAMarker, coinBMarker) {
  if (typeof repr !== "string") return false;
  const lower = repr.toLowerCase();
  const a = lower.indexOf(String(coinAMarker).toLowerCase());
  const b = lower.indexOf(String(coinBMarker).toLowerCase());
  return a !== -1 && b !== -1 && a < b;
}

export function relativeDiff(actual, base) {
  const denom = Math.abs(base);
  if (denom === 0) return actual === 0 ? 0 : Infinity;
  return Math.abs(actual - base) / denom;
}

const U128 = 1n << 128n;

export function wrapSubU128(end, start) {
  const delta = BigInt(end) - BigInt(start);
  return ((delta % U128) + U128) % U128;
}

export function q64ToNumber(value) {
  return Number(BigInt(value)) / 2 ** 64;
}

export function tickToHumanPrice(tick, decimalsA, decimalsB) {
  return 10 ** (decimalsB - decimalsA) / 1.0001 ** tick;
}

export function humanPriceToTick(price, decimalsA, decimalsB) {
  return Math.log(10 ** (decimalsB - decimalsA) / price) / Math.log(1.0001);
}

export function tickSegment(tick, spacing) {
  const lower = Math.floor(tick / spacing) * spacing;
  return { lower, upper: lower + spacing };
}

export function outwardRange(price, width, spacing, decimalsA, decimalsB) {
  const tickHigh = Math.floor(humanPriceToTick(price * (1 + width), decimalsA, decimalsB) / spacing) * spacing;
  const tickLow = Math.ceil(humanPriceToTick(price * (1 - width), decimalsA, decimalsB) / spacing) * spacing;
  return {
    tickLow,
    tickHigh,
    pa: tickToHumanPrice(tickLow, decimalsA, decimalsB),
    pb: tickToHumanPrice(tickHigh, decimalsA, decimalsB),
  };
}

export function rawPerHumanL(decimalsA, decimalsB) {
  return Math.sqrt(10 ** (decimalsA + decimalsB));
}

export function humanAmounts(price, pa, pb, humanL) {
  const p = Math.min(pb, Math.max(pa, price));
  return {
    coinB: humanL * (1 / Math.sqrt(p) - 1 / Math.sqrt(pb)),
    coinA: humanL * (Math.sqrt(p) - Math.sqrt(pa)),
  };
}

export function liquidityForCapital(capital, price, pa, pb, decimalsA, decimalsB) {
  const unit = humanAmounts(price, pa, pb, 1);
  const value = unit.coinB * price + unit.coinA;
  const humanL = capital / value;
  const scale = rawPerHumanL(decimalsA, decimalsB);
  const amounts = humanAmounts(price, pa, pb, humanL);
  return {
    humanL,
    lRaw: humanL * scale,
    coinA: amounts.coinA,
    coinB: amounts.coinB,
  };
}
