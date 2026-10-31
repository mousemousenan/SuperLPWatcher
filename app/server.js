import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config as defaultConfig } from "./config.js";
import { openDb } from "./lib/db.js";
import { HOUR_MS } from "./lib/time.js";
import { buildPool, buildRevenue, buildSeries, collectionSources, parseSeriesN, seriesRange } from "./metrics/dashboard.js";

const publicDir = fileURLToPath(new URL("./public/", import.meta.url));

function send(res, status, body, type) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(payload);
}

function readSources(db, appConfig, now) {
  return collectionSources({
    snapshotAt: db.latestSnapshot()?.hour_ts ?? null,
    cetusAt: db.latestCetusStats()?.sampled_at ?? null,
    ohlcvAt: db.maxOhlcvCollectedAt(),
    now,
    staleMs: appConfig.staleMs,
    offsetHours: appConfig.timezoneOffsetHours,
  });
}

function poolPayload(db, appConfig, now) {
  const snapshot = db.latestSnapshot();
  const params = snapshot ? db.getParams(snapshot.hour_ts) : null;
  return buildPool({ snapshot, params, sources: readSources(db, appConfig, now), appConfig });
}

function revenuePayload(db, appConfig, now) {
  const snapshot = db.latestSnapshot();
  const params = snapshot ? db.getParams(snapshot.hour_ts) : null;
  const stats = db.latestCetusStats();
  const nowSec = Math.floor(now / 1000);
  let snapshots = [];
  let prices = [];
  let candles = [];
  if (snapshot) {
    const startMs = snapshot.hour_ts - 24 * HOUR_MS;
    snapshots = db.listSnapshots(startMs, snapshot.hour_ts);
    prices = db.listPrices(startMs, snapshot.hour_ts);
    candles = db.listOhlcv(Math.floor(startMs / 1000), nowSec);
  }
  return buildRevenue({
    snapshot,
    params,
    stats,
    snapshots,
    prices,
    candles,
    reconcileCandles: db.latestCompletedOhlcv(nowSec, 24),
    sources: readSources(db, appConfig, now),
    appConfig,
    now,
  });
}

function seriesPayload(db, appConfig, now, dayCount) {
  const range = seriesRange(now, dayCount, appConfig.timezoneOffsetHours);
  return buildSeries({
    n: dayCount,
    snapshots: db.listSnapshots(range.fromMs, range.calcToMs),
    candles: db.listOhlcv(Math.floor(range.fromMs / 1000), Math.floor(range.toMs / 1000)),
    appConfig,
    now,
  });
}

export function createServer({ db, appConfig = defaultConfig, now = () => Date.now() } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "GET") {
      send(res, 405, { error: "method not allowed" }, "application/json; charset=utf-8");
      return;
    }
    try {
      if (url.pathname === "/api/pool") {
        send(res, 200, poolPayload(db, appConfig, now()), "application/json; charset=utf-8");
        return;
      }
      if (url.pathname === "/api/revenue") {
        send(res, 200, revenuePayload(db, appConfig, now()), "application/json; charset=utf-8");
        return;
      }
      if (url.pathname === "/api/series") {
        const dayCount = parseSeriesN(url.searchParams.get("n"));
        if (url.searchParams.has("n") && dayCount == null) {
          send(res, 400, { error: "N must be 7, 14, or 30" }, "application/json; charset=utf-8");
          return;
        }
        send(res, 200, seriesPayload(db, appConfig, now(), dayCount ?? 7), "application/json; charset=utf-8");
        return;
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        send(res, 200, fs.readFileSync(path.join(publicDir, "index.html")), "text/html; charset=utf-8");
        return;
      }
      send(res, 404, { error: "not found" }, "application/json; charset=utf-8");
    } catch (error) {
      send(res, 500, { error: error.message }, "application/json; charset=utf-8");
    }
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const db = openDb(defaultConfig.dbPath);
  const server = createServer({ db });
  const rawPort = process.env.PORT;
  const port = rawPort ? Number(rawPort) : 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("bad PORT");
  server.listen(port, "127.0.0.1", () => {
    console.log("http://127.0.0.1:" + server.address().port);
  });
}

