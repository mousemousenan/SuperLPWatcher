import assert from "node:assert/strict";
import test from "node:test";
import { openDb } from "../lib/db.js";

function snapshot(hourTs, liquidity = "1") {
  return {
    hourTs,
    checkpoint: 7,
    checkpointTs: "2026-10-01T00:00:00.000Z",
    sqrtPrice: "100",
    tickBits: 3,
    tick: 3,
    liquidity,
    feeGrowthGlobalA: "1",
    feeGrowthGlobalB: "2",
    feeRate: "2500",
    coinA: "3",
    coinB: "4",
    tickSpacing: 60,
    rewardersJson: "[]",
  };
}

test("one row per hour, and ohlcv writes replace the previous row", () => {
  const db = openDb(":memory:");
  db.upsertSnapshot(snapshot(0, "1"));
  db.upsertSnapshot(snapshot(0, "9"));
  db.upsertSnapshot(snapshot(3_600_000, "4"));
  assert.equal(db.countSnapshots(), 2);
  assert.equal(db.getSnapshot(0).liquidity, "9");

  db.upsertOhlcv({ startTs: 10, open: 1, high: 2, low: 0.5, close: 1.1, volumeUsd: 10, collectedAt: 1 });
  db.upsertOhlcv({ startTs: 10, open: 1, high: 3, low: 0.4, close: 2.5, volumeUsd: 12, collectedAt: 2 });
  assert.equal(db.countOhlcv(), 1);
  assert.equal(db.getOhlcv(10).close, 2.5);
  assert.equal(db.getOhlcv(10).volume_usd, 12);
  db.close();
});