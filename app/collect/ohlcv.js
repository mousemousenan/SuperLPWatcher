import { geckoOhlcvUrl } from "../config.js";

export function parseOhlcvList(body) {
  const list = body?.data?.attributes?.ohlcv_list ?? [];
  return list.map((row) => ({
    startTs: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volumeUsd: Number(row[5]),
  }));
}

export async function fetchOhlcvPages({ fetchPage, sinceSec, limit = 1000, sleepImpl = async () => {} }) {
  const out = [];
  let before = null;
  for (let page = 0; page < 20; page += 1) {
    const batch = await fetchPage({ limit, beforeTimestamp: before });
    if (!batch.length) break;
    out.push(...batch);
    const oldest = Math.min(...batch.map((candle) => candle.startTs));
    if (oldest <= sinceSec || batch.length < limit) break;
    before = oldest;
    await sleepImpl(2000);
  }
  return out.filter((candle) => candle.startTs >= sinceSec);
}

export async function syncOhlcv({
  db,
  fetchPage,
  nowSec,
  backfillDays = 30,
  refreshHours = 48,
  sleepImpl,
}) {
  const latest = db.latestOhlcvStart();
  const currentHour = Math.floor(nowSec / 3600) * 3600;
  const backfillSince = currentHour - backfillDays * 24 * 3600;
  let candles;
  if (latest == null) {
    candles = await fetchOhlcvPages({ fetchPage, sinceSec: backfillSince, sleepImpl });
  } else if (currentHour - latest <= refreshHours * 3600) {
    candles = await fetchPage({ limit: refreshHours });
  } else {
    candles = await fetchOhlcvPages({ fetchPage, sinceSec: latest, sleepImpl });
  }
  const collectedAt = nowSec * 1000;
  db.upsertOhlcvMany(candles.map((candle) => ({ ...candle, collectedAt })));
  return { ok: true, written: candles.length };
}

export function geckoFetchPage(http, poolAddress) {
  return async ({ limit, beforeTimestamp }) => {
    const url = new URL(geckoOhlcvUrl(poolAddress));
    url.searchParams.set("aggregate", "1");
    url.searchParams.set("currency", "usd");
    url.searchParams.set("token", "quote");
    url.searchParams.set("limit", String(limit));
    if (beforeTimestamp != null) url.searchParams.set("before_timestamp", String(beforeTimestamp));
    return parseOhlcvList(await http.json(url));
  };
}