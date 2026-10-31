import { decodeTickBits, sqrtPriceToHuman, typeOrderOk } from "../lib/math.js";
import { findCheckpointForHour } from "./checkpoint.js";
import { poolStateQuery } from "./graphql.js";

export function parsePoolJson(json) {
  const tickBits = Number(json.current_tick_index.bits);
  return {
    sqrtPrice: String(json.current_sqrt_price),
    tickBits,
    tick: decodeTickBits(tickBits),
    liquidity: String(json.liquidity),
    feeGrowthGlobalA: String(json.fee_growth_global_a),
    feeGrowthGlobalB: String(json.fee_growth_global_b),
    feeRate: String(json.fee_rate),
    coinA: String(json.coin_a),
    coinB: String(json.coin_b),
    tickSpacing: Number(json.tick_spacing),
    rewarders: (json.rewarder_manager?.rewarders ?? []).map((rewarder) => ({
      coin: String(rewarder.reward_coin),
      emissionsPerSecond: String(rewarder.emissions_per_second),
      growthGlobal: String(rewarder.growth_global),
    })),
  };
}

export function interpretPoolState(data, appConfig) {
  const poolJson = data?.pool?.asMoveObject?.contents?.json;
  const poolRepr = data?.pool?.asMoveObject?.contents?.type?.repr;
  const cfgJson = data?.cfg?.asMoveObject?.contents?.json;
  if (!poolJson || !poolRepr) throw new Error("pool object missing");
  if (cfgJson?.protocol_fee_rate == null) throw new Error("protocol fee rate missing");
  if (!typeOrderOk(poolRepr, appConfig.pool.coinA.typeMarker, appConfig.pool.coinB.typeMarker)) {
    throw new Error(`pool type mismatch: ${poolRepr}`);
  }
  const parsed = parsePoolJson(poolJson);
  const checkpoint = Number(data.c?.sequenceNumber);
  const checkpointTs = data.c?.timestamp;
  if (!Number.isInteger(checkpoint) || !checkpointTs) throw new Error("checkpoint metadata missing");
  return {
    snapshot: {
      checkpoint,
      checkpointTs,
      ...parsed,
      rewardersJson: JSON.stringify(parsed.rewarders),
    },
    protocolFeeRate: String(cfgJson.protocol_fee_rate),
    price: interpretPricePool(data, appConfig),
  };
}

export function interpretPricePool(data, appConfig) {
  const spec = appConfig.incentivePools[0];
  const contents = data?.pricePool?.asMoveObject?.contents;
  const json = contents?.json;
  const repr = contents?.type?.repr;
  if (!json || !repr) return { ok: false, reason: "price pool missing", symbol: spec.symbol };
  if (!typeOrderOk(repr, spec.coinATypeMarker, spec.coinBTypeMarker)) {
    return { ok: false, reason: `price pool type mismatch: ${repr}`, symbol: spec.symbol };
  }
  const sqrtPrice = String(json.current_sqrt_price);
  return {
    ok: true,
    symbol: spec.symbol,
    sqrtPrice,
    poolAddress: spec.poolAddress,
    price: sqrtPriceToHuman(sqrtPrice, spec.decimalsA, spec.decimalsB),
  };
}

export async function fetchPoolState(gql, appConfig, checkpoint) {
  const spec = appConfig.incentivePools[0];
  return gql(poolStateQuery({
    pool: appConfig.pool.address,
    globalConfig: appConfig.globalConfig,
    pricePool: spec.poolAddress,
    checkpoint,
  }));
}

export async function collectSnapshotHour({ db, gql, getCheckpoint, appConfig, hourTs, now = Date.now(), hint }) {
  try {
    const found = await findCheckpointForHour(getCheckpoint, hourTs, { cpsPerHour: appConfig.cpsPerHour, hint });
    const checkpoint = found.checkpoint.sequenceNumber;
    const data = await fetchPoolState(gql, appConfig, checkpoint);
    const interpreted = interpretPoolState(data, appConfig);
    db.transaction(() => {
      db.upsertSnapshot({ hourTs, ...interpreted.snapshot });
      db.upsertParams({
        hourTs,
        checkpoint: interpreted.snapshot.checkpoint,
        protocolFeeRate: interpreted.protocolFeeRate,
      });
      if (interpreted.price.ok) {
        db.upsertPrice({
          hourTs,
          symbol: interpreted.price.symbol,
          price: interpreted.price.price,
          sqrtPrice: interpreted.price.sqrtPrice,
          checkpoint: interpreted.snapshot.checkpoint,
          poolAddress: interpreted.price.poolAddress,
        });
      }
    });
    if (!interpreted.price.ok) {
      db.insertGap({
        source: "price",
        hourTs,
        detail: interpreted.price.reason,
        createdAt: now,
      });
    }
    return { ok: true, checkpoint, priceOk: interpreted.price.ok, hint: found.checkpoint };
  } catch (error) {
    db.insertGap({ source: "snapshot", hourTs, detail: error.message, createdAt: now });
    return { ok: false, reason: error.message };
  }
}

export async function collectPriceForSnapshot({ db, gql, appConfig, hourTs, now = Date.now() }) {
  const snapshot = db.getSnapshot(hourTs);
  if (!snapshot) return { ok: false, reason: "snapshot missing" };
  try {
    const data = await fetchPoolState(gql, appConfig, snapshot.checkpoint);
    const price = interpretPricePool(data, appConfig);
    if (!price.ok) {
      db.insertGap({ source: "price", hourTs, detail: price.reason, createdAt: now });
      return { ok: false, reason: price.reason };
    }
    db.upsertPrice({
      hourTs,
      symbol: price.symbol,
      price: price.price,
      sqrtPrice: price.sqrtPrice,
      checkpoint: snapshot.checkpoint,
      poolAddress: price.poolAddress,
    });
    return { ok: true, price: price.price };
  } catch (error) {
    db.insertGap({ source: "price", hourTs, detail: error.message, createdAt: now });
    return { ok: false, reason: error.message };
  }
}