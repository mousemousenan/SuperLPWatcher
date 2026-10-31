export function parseCetusStats(raw, expectedPool) {
  const text = String(raw);
  if (/"list"\s*:\s*\[\s*\]/.test(text)) return { ok: false, reason: "empty list" };
  const poolMatch = text.match(/"pool"\s*:\s*"(0x[0-9a-fA-F]+)"/);
  if (!poolMatch) return { ok: false, reason: "empty list" };
  if (poolMatch[1].toLowerCase() !== expectedPool.toLowerCase()) {
    return { ok: false, reason: `pool mismatch: ${poolMatch[1]}` };
  }
  const stats = {};
  const objects = text.matchAll(/\{[^{}]*"dateType"\s*:\s*"([^"]+)"[^{}]*\}/g);
  for (const match of objects) {
    const body = match[0];
    const vol = body.match(/"vol"\s*:\s*"?(?<n>[0-9]+(?:\.[0-9]+)?)"?/);
    const fee = body.match(/"fee"\s*:\s*"?(?<n>[0-9]+(?:\.[0-9]+)?)"?/);
    if (!vol || !fee) return { ok: false, reason: `incomplete ${match[1]}` };
    stats[match[1]] = { vol: vol.groups.n, fee: fee.groups.n };
  }
  for (const key of ["24H", "7D", "30D"]) {
    if (!stats[key]) return { ok: false, reason: `missing ${key}` };
  }
  const tvl = text.match(/"tvl"\s*:\s*"([^"]+)"/);
  const feeRate = text.match(/"feeRate"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/);
  return {
    ok: true,
    vol24h: stats["24H"].vol,
    fee24h: stats["24H"].fee,
    vol7d: stats["7D"].vol,
    fee7d: stats["7D"].fee,
    vol30d: stats["30D"].vol,
    fee30d: stats["30D"].fee,
    tvl: tvl ? tvl[1] : null,
    feeRate: feeRate ? feeRate[1] : null,
    rawJson: text,
  };
}

export async function collectCetusStats({ http, db, appConfig, hourTs, now = Date.now(), rawText }) {
  try {
    const text = rawText ?? await http.text(`${appConfig.cetusStatsUrl}?pool=${appConfig.pool.address}`);
    const parsed = parseCetusStats(text, appConfig.pool.address);
    if (!parsed.ok) {
      db.insertGap({ source: "cetus_stats", hourTs, detail: parsed.reason, createdAt: now });
      return { ok: false, reason: parsed.reason };
    }
    db.upsertCetusStats({
      hourTs,
      sampledAt: now,
      vol24h: parsed.vol24h,
      fee24h: parsed.fee24h,
      vol7d: parsed.vol7d,
      fee7d: parsed.fee7d,
      vol30d: parsed.vol30d,
      fee30d: parsed.fee30d,
      tvl: parsed.tvl,
      feeRate: parsed.feeRate,
      rawJson: parsed.rawJson,
    });
    return { ok: true };
  } catch (error) {
    db.insertGap({ source: "cetus_stats", hourTs, detail: error.message, createdAt: now });
    return { ok: false, reason: error.message };
  }
}