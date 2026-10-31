import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  hour_ts INTEGER PRIMARY KEY,
  checkpoint INTEGER NOT NULL,
  checkpoint_ts TEXT NOT NULL,
  sqrt_price TEXT NOT NULL,
  tick_bits INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  liquidity TEXT NOT NULL,
  fee_growth_global_a TEXT NOT NULL,
  fee_growth_global_b TEXT NOT NULL,
  fee_rate TEXT NOT NULL,
  coin_a TEXT NOT NULL,
  coin_b TEXT NOT NULL,
  tick_spacing INTEGER NOT NULL,
  rewarders_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cetus_stats (
  hour_ts INTEGER PRIMARY KEY,
  sampled_at INTEGER NOT NULL,
  vol_24h TEXT NOT NULL,
  fee_24h TEXT NOT NULL,
  vol_7d TEXT NOT NULL,
  fee_7d TEXT NOT NULL,
  vol_30d TEXT NOT NULL,
  fee_30d TEXT NOT NULL,
  tvl TEXT,
  fee_rate TEXT,
  raw_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ohlcv (
  start_ts INTEGER PRIMARY KEY,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume_usd REAL NOT NULL,
  collected_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS params (
  hour_ts INTEGER PRIMARY KEY,
  checkpoint INTEGER NOT NULL,
  protocol_fee_rate TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prices (
  hour_ts INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  price REAL NOT NULL,
  sqrt_price TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  PRIMARY KEY (hour_ts, symbol)
);
CREATE TABLE IF NOT EXISTS gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  hour_ts INTEGER,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function openDb(file = ":memory:") {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);

  function transaction(fn) {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    db,
    transaction,
    close() {
      db.close();
    },
    upsertSnapshot(row) {
      run(
        `INSERT INTO snapshots (
          hour_ts, checkpoint, checkpoint_ts, sqrt_price, tick_bits, tick, liquidity,
          fee_growth_global_a, fee_growth_global_b, fee_rate, coin_a, coin_b, tick_spacing, rewarders_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(hour_ts) DO UPDATE SET
          checkpoint = excluded.checkpoint,
          checkpoint_ts = excluded.checkpoint_ts,
          sqrt_price = excluded.sqrt_price,
          tick_bits = excluded.tick_bits,
          tick = excluded.tick,
          liquidity = excluded.liquidity,
          fee_growth_global_a = excluded.fee_growth_global_a,
          fee_growth_global_b = excluded.fee_growth_global_b,
          fee_rate = excluded.fee_rate,
          coin_a = excluded.coin_a,
          coin_b = excluded.coin_b,
          tick_spacing = excluded.tick_spacing,
          rewarders_json = excluded.rewarders_json`,
        row.hourTs,
        row.checkpoint,
        row.checkpointTs,
        row.sqrtPrice,
        row.tickBits,
        row.tick,
        row.liquidity,
        row.feeGrowthGlobalA,
        row.feeGrowthGlobalB,
        row.feeRate,
        row.coinA,
        row.coinB,
        row.tickSpacing,
        row.rewardersJson,
      );
    },
    getSnapshot(hourTs) {
      return get("SELECT * FROM snapshots WHERE hour_ts = ?", hourTs);
    },
    listSnapshotHours(fromTs, toTs) {
      return all(
        "SELECT hour_ts FROM snapshots WHERE hour_ts >= ? AND hour_ts <= ? ORDER BY hour_ts",
        fromTs,
        toTs,
      ).map((row) => row.hour_ts);
    },
    listSnapshots(fromTs, toTs) {
      return all(
        "SELECT * FROM snapshots WHERE hour_ts >= ? AND hour_ts <= ? ORDER BY hour_ts",
        fromTs,
        toTs,
      );
    },
    deleteSnapshot(hourTs) {
      run("DELETE FROM snapshots WHERE hour_ts = ?", hourTs);
    },
    countSnapshots() {
      return get("SELECT COUNT(*) AS n FROM snapshots").n;
    },
    upsertParams(row) {
      run(
        `INSERT INTO params (hour_ts, checkpoint, protocol_fee_rate)
         VALUES (?, ?, ?)
         ON CONFLICT(hour_ts) DO UPDATE SET
           checkpoint = excluded.checkpoint,
           protocol_fee_rate = excluded.protocol_fee_rate`,
        row.hourTs,
        row.checkpoint,
        row.protocolFeeRate,
      );
    },
    getParams(hourTs) {
      return get("SELECT * FROM params WHERE hour_ts = ?", hourTs);
    },
    upsertCetusStats(row) {
      run(
        `INSERT INTO cetus_stats (
          hour_ts, sampled_at, vol_24h, fee_24h, vol_7d, fee_7d, vol_30d, fee_30d, tvl, fee_rate, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(hour_ts) DO UPDATE SET
          sampled_at = excluded.sampled_at,
          vol_24h = excluded.vol_24h,
          fee_24h = excluded.fee_24h,
          vol_7d = excluded.vol_7d,
          fee_7d = excluded.fee_7d,
          vol_30d = excluded.vol_30d,
          fee_30d = excluded.fee_30d,
          tvl = excluded.tvl,
          fee_rate = excluded.fee_rate,
          raw_json = excluded.raw_json`,
        row.hourTs,
        row.sampledAt,
        row.vol24h,
        row.fee24h,
        row.vol7d,
        row.fee7d,
        row.vol30d,
        row.fee30d,
        row.tvl,
        row.feeRate,
        row.rawJson,
      );
    },
    getCetusStats(hourTs) {
      return get("SELECT * FROM cetus_stats WHERE hour_ts = ?", hourTs);
    },
    deleteCetusStats(hourTs) {
      run("DELETE FROM cetus_stats WHERE hour_ts = ?", hourTs);
    },
    countCetusStats() {
      return get("SELECT COUNT(*) AS n FROM cetus_stats").n;
    },
    upsertOhlcv(row) {
      run(
        `INSERT INTO ohlcv (start_ts, open, high, low, close, volume_usd, collected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(start_ts) DO UPDATE SET
           open = excluded.open,
           high = excluded.high,
           low = excluded.low,
           close = excluded.close,
           volume_usd = excluded.volume_usd,
           collected_at = excluded.collected_at`,
        row.startTs,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volumeUsd,
        row.collectedAt,
      );
    },
    upsertOhlcvMany(rows) {
      transaction(() => {
        for (const row of rows) this.upsertOhlcv(row);
      });
    },
    getOhlcv(startTs) {
      return get("SELECT * FROM ohlcv WHERE start_ts = ?", startTs);
    },
    latestOhlcvStart() {
      return get("SELECT MAX(start_ts) AS start_ts FROM ohlcv")?.start_ts ?? null;
    },
    countOhlcv() {
      return get("SELECT COUNT(*) AS n FROM ohlcv").n;
    },
    listOhlcv(fromTs, toTs) {
      return all(
        "SELECT * FROM ohlcv WHERE start_ts >= ? AND start_ts <= ? ORDER BY start_ts",
        fromTs,
        toTs,
      );
    },
    upsertPrice(row) {
      run(
        `INSERT INTO prices (hour_ts, symbol, price, sqrt_price, checkpoint, pool_address)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(hour_ts, symbol) DO UPDATE SET
           price = excluded.price,
           sqrt_price = excluded.sqrt_price,
           checkpoint = excluded.checkpoint,
           pool_address = excluded.pool_address`,
        row.hourTs,
        row.symbol,
        row.price,
        row.sqrtPrice,
        row.checkpoint,
        row.poolAddress,
      );
    },
    getPrice(hourTs, symbol) {
      return get("SELECT * FROM prices WHERE hour_ts = ? AND symbol = ?", hourTs, symbol);
    },
    insertGap(row) {
      run(
        "INSERT INTO gaps (source, hour_ts, detail, created_at) VALUES (?, ?, ?, ?)",
        row.source,
        row.hourTs ?? null,
        row.detail,
        row.createdAt ?? Date.now(),
      );
    },
    listGaps(source) {
      if (source) return all("SELECT * FROM gaps WHERE source = ? ORDER BY id", source);
      return all("SELECT * FROM gaps ORDER BY id");
    },
    latestSnapshot() {
      return get("SELECT * FROM snapshots ORDER BY hour_ts DESC LIMIT 1") ?? null;
    },
    latestCetusStats() {
      return get("SELECT * FROM cetus_stats ORDER BY sampled_at DESC LIMIT 1") ?? null;
    },
    maxOhlcvCollectedAt() {
      return get("SELECT MAX(collected_at) AS collected_at FROM ohlcv")?.collected_at ?? null;
    },
    listPrices(fromTs, toTs) {
      return all(
        "SELECT * FROM prices WHERE hour_ts >= ? AND hour_ts <= ? ORDER BY hour_ts, symbol",
        fromTs,
        toTs,
      );
    },
    latestCompletedOhlcv(nowSec, limit = 24) {
      const count = Number(limit);
      if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("bad limit");
      return all(
        "SELECT * FROM ohlcv WHERE start_ts + 3600 <= ? ORDER BY start_ts DESC LIMIT " + count,
        nowSec,
      );
    },
  };
}