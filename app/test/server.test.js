import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { config } from "../config.js";
import { openDb } from "../lib/db.js";
import { HOUR_MS } from "../lib/time.js";
import { createServer } from "../server.js";

const execFileAsync = promisify(execFile);
const SQRT = "609642842451606482089";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function curl(port, path) {
  const { stdout } = await execFileAsync("curl.exe", ["-sS", "-w", "\n%{http_code}", "http://127.0.0.1:" + port + path]);
  const text = String(stdout).replace(/\r/g, "");
  const split = text.lastIndexOf("\n");
  const status = Number(text.slice(split + 1));
  const raw = text.slice(0, split);
  let body = raw;
  if (raw.startsWith("{") || raw.startsWith("[")) body = JSON.parse(raw);
  return { status, body, raw };
}

function rewarders() {
  return JSON.stringify([
    { coin: "abc::cetus::CETUS", emissionsPerSecond: (1n << 64n).toString(), growthGlobal: "0" },
    { coin: "abc::sui::SUI", emissionsPerSecond: (2n << 64n).toString(), growthGlobal: "0" },
  ]);
}

function seed(db, now) {
  const end = Math.floor(now / HOUR_MS) * HOUR_MS;
  for (let i = 0; i <= 24; i += 1) {
    const hourTs = end - (24 - i) * HOUR_MS;
    db.upsertSnapshot({
      hourTs,
      checkpoint: 1000 + i,
      checkpointTs: new Date(hourTs).toISOString(),
      sqrtPrice: SQRT,
      tickBits: 69963,
      tick: 69963,
      liquidity: "286000000000000",
      feeGrowthGlobalA: String(BigInt(i) << 64n),
      feeGrowthGlobalB: "0",
      feeRate: "2500",
      coinA: "1",
      coinB: "1",
      tickSpacing: 60,
      rewardersJson: rewarders(),
    });
    db.upsertParams({ hourTs, checkpoint: 1000 + i, protocolFeeRate: "2000" });
    db.upsertPrice({
      hourTs,
      symbol: "CETUS",
      price: 0.021008,
      sqrtPrice: "1",
      checkpoint: 1000 + i,
      poolAddress: config.incentivePools[0].poolAddress,
    });
    db.upsertOhlcv({
      startTs: Math.floor(hourTs / 1000),
      open: 0.9156,
      high: 0.92,
      low: 0.91,
      close: 0.9156,
      volumeUsd: 1000,
      collectedAt: now,
    });
  }
  db.upsertCetusStats({
    hourTs: end,
    sampledAt: now,
    vol24h: "24000",
    fee24h: "60",
    vol7d: "1",
    fee7d: "1",
    vol30d: "1",
    fee30d: "1",
    tvl: "1",
    feeRate: "0.0025",
    rawJson: "{}",
  });
}

test("6.1 curl returns pool, revenue, series, and 400 for a bad N", async () => {
  const db = openDb(":memory:");
  const now = Date.parse("2026-10-31T02:30:00.000Z");
  seed(db, now);
  const server = createServer({ db, now: () => now });
  const port = await listen(server);
  try {
    const pool = await curl(port, "/api/pool");
    assert.equal(pool.status, 200);
    assert.equal(pool.body.address, config.pool.address);
    assert.equal(pool.body.pair, "USDC/SUI");
    assert.equal(pool.body.feeRate.display, "0.25%");
    assert.equal(pool.body.protocolFeeRate.display, "20%");
    assert.equal(pool.body.lpFeeRate.display, "0.20%");
    assert.equal(pool.body.tickSpacing, 60);
    assert.deepEqual(pool.body.incentives.map((item) => item.symbol), ["CETUS", "SUI"]);
    assert.equal(pool.body.sources.length, 3);
    assert.equal(pool.body.stale, false);
    const revenue = await curl(port, "/api/revenue");
    assert.equal(revenue.status, 200);
    assert.equal(revenue.body.fee24h.source, "Cetus 官方统计");
    assert.equal(revenue.body.fee24h.window, "由 Cetus 定义");
    assert.equal(revenue.body.fee24h.gross, 60);
    assert.equal(revenue.body.fee24h.lpNet, 48);
    assert.equal(revenue.body.fee24h.status, "正常");
    assert.equal(revenue.body.reconcile.status, "一致");
    assert.equal(revenue.body.reconcile.candleCount, 24);
    assert.ok(revenue.body.price.value > 0);
    assert.equal(revenue.body.liquidity.raw, "286000000000000");
    assert.equal(revenue.body.depth.tickLower, 69960);
    assert.equal(revenue.body.unitFee24h.status, "正常");
    assert.equal(revenue.body.unitFee24h.startMs, revenue.body.incentives24h.startMs);
    assert.equal(revenue.body.unitFee24h.endMs, revenue.body.incentives24h.endMs);
    assert.equal(revenue.body.incentives24h.status, "正常");
    assert.deepEqual(revenue.body.examples.map((item) => item.width), [0.01, 0.1]);
    for (const example of revenue.body.examples) {
      assert.equal(example.status, "正常");
      assert.ok(example.fee > 0);
      assert.ok(example.lRaw > 0);
      assert.ok(example.pa < example.pb);
    }
    const week = await curl(port, "/api/series?n=7");
    assert.equal(week.status, 200);
    assert.equal(week.body.n, 7);
    assert.equal(week.body.fees.length, 7);
    assert.equal(week.body.positions.length, 2);
    assert.equal(week.body.positions[0].points.length, 7);
    assert.equal(week.body.positions[1].points.length, 7);
    assert.equal(week.body.liquidity.length, 7 * 24);
    assert.deepEqual(Object.keys(week.body), ["n", "fromMs", "toMs", "fees", "positions", "liquidity"]);
    assert.deepEqual(Object.keys(week.body.fees[0]), ["date", "dayStartMs", "fee", "volumeUsd", "candleCount", "status"]);
    const point = week.body.positions[0].points[0];
    for (const key of ["date", "fee", "openPrice", "pa", "pb", "lRaw", "inRangeHours", "status"]) assert.ok(key in point);
    assert.equal(JSON.stringify(week.body).includes("volumeSui"), false);
    assert.equal(JSON.stringify(week.body).includes("suiVolume"), false);
    const twoWeeks = await curl(port, "/api/series?n=14");
    const month = await curl(port, "/api/series?n=30");
    assert.equal(twoWeeks.body.fees.length, 14);
    assert.equal(twoWeeks.body.liquidity.length, 14 * 24);
    assert.equal(month.body.fees.length, 30);
    assert.equal(month.body.positions[1].points.length, 30);
    assert.equal(month.body.liquidity.length, 30 * 24);
    const bad = await curl(port, "/api/series?n=8");
    assert.equal(bad.status, 400);
    const word = await curl(port, "/api/series?n=abc");
    assert.equal(word.status, 400);
  } finally {
    server.close();
    db.close();
  }
});

test("6.2 a K-line collection time 3 hours ago is stale, and exactly 2 hours is not", async () => {
  const db = openDb(":memory:");
  let now = Date.now();
  seed(db, now);
  const server = createServer({ db, now: () => now });
  const port = await listen(server);
  try {
    db.db.prepare("UPDATE ohlcv SET collected_at = ?").run(now - config.staleMs);
    const fresh = await curl(port, "/api/revenue");
    assert.equal(fresh.body.sources.find((item) => item.id === "ohlcv").stale, false);
    assert.equal(config.staleMs, 2 * HOUR_MS);
    now = Date.now();
    db.db.prepare("UPDATE ohlcv SET collected_at = ?").run(now - 3 * HOUR_MS);
    db.db.prepare("UPDATE cetus_stats SET sampled_at = ?").run(now);
    const stale = await curl(port, "/api/revenue");
    const gecko = stale.body.sources.find((item) => item.id === "ohlcv");
    const cetus = stale.body.sources.find((item) => item.id === "cetus");
    const chain = stale.body.sources.find((item) => item.id === "snapshot");
    assert.equal(gecko.stale, true);
    assert.equal(cetus.stale, false);
    assert.equal(chain.stale, false);
    assert.match(stale.body.staleBanner, /数据已过期/);
    assert.match(stale.body.staleBanner, /GeckoTerminal K 线/);
    assert.equal(stale.body.staleBanner.includes("Cetus 成交统计最后"), false);
    assert.equal(stale.body.fee24h.status, "正常");
    assert.equal(stale.body.fee24h.gross, 60);
    const page = await curl(port, "/");
    assert.equal(page.status, 200);
    assert.match(page.raw, /id="stale"/);
    assert.match(page.raw, /revenue\.staleBanner/);
    assert.match(page.raw, /id="fee"/);
    assert.match(page.raw, /id="pos1"/);
    assert.match(page.raw, /id="pos10"/);
    assert.match(page.raw, /id="liq"/);
    assert.match(page.raw, /function bars/);
    assert.match(page.raw, /function liqChart/);
    assert.equal(page.raw.includes("成交量加权"), false);
  } finally {
    server.close();
    db.close();
  }
});

