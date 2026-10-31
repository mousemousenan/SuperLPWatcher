import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../config.js";
import { collectCetusStats, parseCetusStats } from "../collect/cetus-stats.js";
import { completedCandleVolume, summarizeProbe } from "../collect/probe-alignment.js";
import { runCollection } from "../collect/run.js";
import { syncOhlcv } from "../collect/ohlcv.js";
import { collectSnapshotHour, interpretPricePool, parsePoolJson } from "../collect/snapshot.js";
import { openDb } from "../lib/db.js";
import { humanPriceFromRawSquare, sqrtPriceToHuman } from "../lib/math.js";
import { HOUR_MS } from "../lib/time.js";

const POOL = config.pool.address;

function statsRaw(pool, vol = "5310334.24", fee = "13275.84") {
  return JSON.stringify({
    code: 0,
    data: {
      total: 1,
      list: [{
        pool,
        feeRate: 2500,
        tvl: "12.5",
        stats: [
          { dateType: "24H", vol: Number(vol), fee: Number(fee), apr: 1 },
          { dateType: "7D", vol: 2, fee: 1, apr: 1 },
          { dateType: "30D", vol: 3, fee: 2, apr: 1 },
        ],
      }],
    },
  }).replace(`"vol":${Number(vol)}`, `"vol":${vol}`).replace(`"fee":${Number(fee)}`, `"fee":${fee}`);
}

function cetusRow(hourTs) {
  return {
    hourTs,
    sampledAt: hourTs,
    vol24h: "1",
    fee24h: "1",
    vol7d: "1",
    fee7d: "1",
    vol30d: "1",
    fee30d: "1",
    tvl: "1",
    feeRate: "2500",
    rawJson: "{}",
  };
}

function snapshot(hourTs, sqrtPrice = "100") {
  return {
    hourTs,
    checkpoint: 7,
    checkpointTs: new Date(hourTs).toISOString(),
    sqrtPrice,
    tickBits: 3,
    tick: 3,
    liquidity: "1",
    feeGrowthGlobalA: "1",
    feeGrowthGlobalB: "2",
    feeRate: "2500",
    coinA: "3",
    coinB: "4",
    tickSpacing: 60,
    rewardersJson: "[]",
  };
}

test("cetus stats keep decimal strings and reject an empty or foreign pool", async () => {
  const parsed = parseCetusStats(statsRaw(POOL), POOL);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.vol24h, "5310334.24");
  assert.equal(parsed.fee24h, "13275.84");

  const db = openDb(":memory:");
  const empty = await collectCetusStats({
    db,
    appConfig: config,
    hourTs: 0,
    rawText: '{"data":{"total":0,"list":[]}}',
  });
  const foreign = await collectCetusStats({
    db,
    appConfig: config,
    hourTs: 0,
    rawText: statsRaw("0x1111111111111111111111111111111111111111111111111111111111111111"),
  });
  assert.equal(empty.ok, false);
  assert.equal(foreign.ok, false);
  assert.equal(db.countCetusStats(), 0);
  assert.equal(db.listGaps("cetus_stats").length, 2);
  db.close();
});

test("ohlcv writes a batch even when close is more than 5% from the snapshot", async () => {
  const db = openDb(":memory:");
  const startTs = 1_700_000_000;
  const result = await syncOhlcv({
    db,
    nowSec: startTs + 60,
    backfillDays: 1,
    fetchPage: async () => [{ startTs, open: 1, high: 1, low: 1, close: 1.06, volumeUsd: 10 }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.written, 1);
  assert.equal(db.countOhlcv(), 1);
  assert.equal(db.getOhlcv(startTs).close, 1.06);
  assert.equal(db.listGaps("ohlcv").length, 0);
  db.close();
});

test("ohlcv backfills the hours missed during a 5 hour stop", async () => {
  const db = openDb(":memory:");
  const start = 1_700_000_000;
  db.upsertOhlcv({ startTs: start, open: 1, high: 1, low: 1, close: 1, volumeUsd: 1, collectedAt: 1 });
  const nowSec = start + 5 * 3600;
  const candles = [];
  for (let i = 0; i <= 5; i += 1) {
    candles.push({ startTs: start + i * 3600, open: 1, high: 1, low: 1, close: 1, volumeUsd: i + 1 });
  }
  const result = await syncOhlcv({
    db,
    nowSec,
    refreshHours: 48,
    fetchPage: async () => candles,
  });
  assert.equal(result.ok, true);
  assert.equal(db.countOhlcv(), 6);
  assert.equal(db.getOhlcv(start + 5 * 3600).volume_usd, 6);
  assert.equal(db.getOhlcv(start + 3600).close, 1);
  db.close();
});

test("price example and a reversed pricing pool are not stored", async () => {
  const price = humanPriceFromRawSquare(47601.637, 6, 9);
  assert.ok(Math.abs(price - 0.021008) < 5e-7, price);

  const reversed = interpretPricePool({
    pricePool: {
      asMoveObject: {
        contents: {
          type: { repr: "pool::Pool<0x1::cetus::CETUS, 0x2::usdc::USDC>" },
          json: { current_sqrt_price: "1" },
        },
      },
    },
  }, config);
  assert.equal(reversed.ok, false);

  const db = openDb(":memory:");
  const hourTs = Date.parse("2026-10-01T00:00:00Z");
  const result = await collectSnapshotHour({
    db,
    appConfig: config,
    hourTs,
    getCheckpoint: async (seq) => {
      const tip = 100_000;
      const sequenceNumber = seq ?? tip;
      const timestamp = new Date(hourTs + 3_600_000 - (tip - sequenceNumber) * 250).toISOString();
      return { sequenceNumber, timestamp };
    },
    gql: async () => ({
      c: { sequenceNumber: "42", timestamp: "2026-10-01T00:00:00.000Z" },
      pool: {
        asMoveObject: {
          contents: {
            type: { repr: "0x1::pool::Pool<0xabc::usdc::USDC, 0x2::sui::SUI>" },
            json: {
              current_sqrt_price: "609642842451606482089",
              current_tick_index: { bits: 4294967235 },
              liquidity: "286000000000000",
              fee_growth_global_a: "1",
              fee_growth_global_b: "2",
              fee_rate: "2500",
              coin_a: "3",
              coin_b: "4",
              tick_spacing: 60,
              rewarder_manager: { rewarders: [] },
            },
          },
        },
      },
      cfg: { asMoveObject: { contents: { json: { protocol_fee_rate: "2000" } } } },
      pricePool: {
        asMoveObject: {
          contents: {
            type: { repr: "pool::Pool<0x1::cetus::CETUS, 0x2::usdc::USDC>" },
            json: { current_sqrt_price: "5" },
          },
        },
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.priceOk, false);
  assert.equal(db.getSnapshot(hourTs).tick, -61);
  assert.equal(db.getParams(hourTs).protocol_fee_rate, "2000");
  assert.equal(db.getPrice(hourTs, "CETUS"), undefined);
  assert.equal(db.listGaps("price").length, 1);
  db.close();
});

test("a deleted hourly snapshot is collected again, but cetus stats are not backfilled", async () => {
  const db = openDb(":memory:");
  const end = Date.parse("2026-10-30T04:00:00Z");
  const snapshotCalls = [];
  const cetusCalls = [];
  const priceCalls = [];
  const run = () => runCollection({
    db,
    now: end,
    appConfig: config,
    backfillDays: 3 / 24,
    log() {},
    async collectSnapshot(hourTs) {
      snapshotCalls.push(hourTs);
      db.upsertSnapshot(snapshot(hourTs));
      return { ok: true };
    },
    async collectCetus(hourTs) {
      cetusCalls.push(hourTs);
      db.upsertCetusStats(cetusRow(hourTs));
      return { ok: true };
    },
    async collectMissingPrice(hourTs) {
      priceCalls.push(hourTs);
      db.upsertPrice({
        hourTs,
        symbol: "CETUS",
        price: 0.02,
        sqrtPrice: "1",
        checkpoint: 1,
        poolAddress: config.incentivePools[0].poolAddress,
      });
      return { ok: true };
    },
    async collectOhlcv() {
      return { ok: true, written: 0 };
    },
  });

  await run();
  assert.equal(snapshotCalls.length, 4);
  assert.deepEqual(cetusCalls, [end]);
  const removed = end - HOUR_MS;
  db.deleteSnapshot(removed);
  db.deleteCetusStats(end);
  db.deleteCetusStats(removed);
  await run();
  assert.equal(db.getSnapshot(removed).liquidity, "1");
  assert.deepEqual(cetusCalls, [end, end]);
  assert.equal(db.getCetusStats(removed), undefined);
  assert.equal(db.countCetusStats(), 1);
  assert.ok(priceCalls.includes(end));
  db.close();
});

test("completed candles skip the open hour", () => {
  const nowSec = 10_000 + 100;
  const { sum, count } = completedCandleVolume([
    { startTs: 10_000, volumeUsd: 9 },
    { startTs: 10_000 - 3600, volumeUsd: 5 },
    { startTs: 10_000 - 7200, volumeUsd: 1 },
  ], nowSec);
  assert.equal(count, 2);
  assert.equal(sum, 6);
  const summary = summarizeProbe([
    { at: "2026-10-30T00:00:00.000Z", cetusVol24h: "10", deviation: 0.01 },
    { at: "2026-10-30T00:05:00.000Z", cetusVol24h: "10", deviation: 0.02 },
    { at: "2026-10-30T00:10:00.000Z", cetusVol24h: "12", deviation: -0.08 },
  ]);
  assert.equal(summary.cetusVolChanges, 1);
  assert.equal(summary.minutesBetweenChanges[0], 10);
  assert.equal(summary.outside5pct, 1);
});

test("parser keeps the on-chain tick spacing and signed tick", () => {
  const parsed = parsePoolJson({
    current_sqrt_price: "609642842451606482089",
    current_tick_index: { bits: 69963 },
    liquidity: "1",
    fee_growth_global_a: "1",
    fee_growth_global_b: "1",
    fee_rate: "2500",
    coin_a: "1",
    coin_b: "1",
    tick_spacing: 60,
    rewarder_manager: { rewarders: [] },
  });
  assert.equal(parsed.tick, 69963);
  assert.equal(parsed.tickSpacing, 60);
  assert.ok(Math.abs(sqrtPriceToHuman(parsed.sqrtPrice, 6, 9) - 0.9156) < 0.0001);
});