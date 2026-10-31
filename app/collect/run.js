import { pathToFileURL } from "node:url";
import { config as defaultConfig } from "../config.js";
import { openDb } from "../lib/db.js";
import { createHttp } from "../lib/http.js";
import { floorHour, hoursBetween, HOUR_MS } from "../lib/time.js";
import { createCheckpointGetter } from "./checkpoint.js";
import { collectCetusStats } from "./cetus-stats.js";
import { geckoFetchPage, syncOhlcv } from "./ohlcv.js";
import { collectPriceForSnapshot, collectSnapshotHour } from "./snapshot.js";

export async function runCollection({
  db,
  now = Date.now(),
  appConfig = defaultConfig,
  backfillDays = appConfig.backfillDays,
  collectSnapshot,
  collectCetus,
  collectOhlcv,
  collectMissingPrice,
  log = () => {},
}) {
  const end = floorHour(now);
  const start = end - backfillDays * 24 * HOUR_MS;
  const symbol = appConfig.incentivePools[0].symbol;
  const missing = hoursBetween(start, end).filter((hourTs) => !db.getSnapshot(hourTs));
  const snapshotResults = [];
  let hint;
  for (const hourTs of missing.slice().reverse()) {
    log(`snapshot ${new Date(hourTs).toISOString()}`);
    const result = await collectSnapshot(hourTs, hint);
    snapshotResults.push({ hourTs, ...result });
    if (result.hint) hint = result.hint;
  }
  const priceResults = [];
  for (const hourTs of db.listSnapshotHours(start, end)) {
    if (db.getPrice(hourTs, symbol)) continue;
    log(`price ${new Date(hourTs).toISOString()}`);
    priceResults.push({ hourTs, ...(await collectMissingPrice(hourTs)) });
  }
  let cetusResult = null;
  if (!db.getCetusStats(end)) {
    log(`cetus ${new Date(end).toISOString()}`);
    cetusResult = { hourTs: end, ...(await collectCetus(end)) };
  }
  const ohlcvResult = await collectOhlcv();
  return { start, end, missing, snapshotResults, priceResults, cetusResult, ohlcvResult };
}

export function createCollector({ db, gql, getCheckpoint, http, appConfig = defaultConfig, now = Date.now() }) {
  return {
    collectSnapshot: (hourTs, hint) => collectSnapshotHour({ db, gql, getCheckpoint, appConfig, hourTs, now, hint }),
    collectCetus: (hourTs) => collectCetusStats({ http, db, appConfig, hourTs, now }),
    collectMissingPrice: (hourTs) => collectPriceForSnapshot({ db, gql, appConfig, hourTs, now }),
    collectOhlcv: () => syncOhlcv({
      db,
      fetchPage: geckoFetchPage(http, appConfig.pool.address),
      nowSec: Math.floor(now / 1000),
      backfillDays: appConfig.backfillDays,
      refreshHours: appConfig.ohlcvRefreshHours,
    }),
  };
}

export async function runOnce({ appConfig = defaultConfig, now = Date.now() } = {}) {
  const http = createHttp();
  const gql = (query) => http.gql(appConfig.graphqlUrl, query);
  const db = openDb(appConfig.dbPath);
  try {
    const collector = createCollector({
      db,
      gql,
      getCheckpoint: createCheckpointGetter(gql),
      http,
      appConfig,
      now,
    });
    return await runCollection({
      db,
      now,
      appConfig,
      log: (line) => console.error(line),
      ...collector,
    });
  } finally {
    db.close();
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const once = !process.argv.includes("--loop");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  do {
    const started = Date.now();
    const result = await runOnce({ now: started });
    console.error(`run done ${new Date(result.end).toISOString()} snapshots+${result.missing.length}`);
    if (once) break;
    const wait = floorHour(Date.now()) + HOUR_MS + 5000 - Date.now();
    await sleep(Math.max(wait, 1000));
  } while (process.argv.includes("--loop"));
}