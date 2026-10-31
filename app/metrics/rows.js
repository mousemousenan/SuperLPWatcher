export function symbolFromCoin(coin) {
  const parts = String(coin).split("::");
  return parts[parts.length - 1];
}

export function asSnapshot(row) {
  if (!row) return null;
  const rewardersRaw = row.rewarders ?? row.rewardersJson ?? row.rewarders_json ?? [];
  const rewarders = typeof rewardersRaw === "string" ? JSON.parse(rewardersRaw) : rewardersRaw;
  return {
    hourTs: row.hourTs ?? row.hour_ts ?? null,
    checkpoint: row.checkpoint ?? null,
    checkpointTs: row.checkpointTs ?? row.checkpoint_ts ?? null,
    sqrtPrice: row.sqrtPrice ?? row.sqrt_price ?? row.sqrt ?? null,
    tick: row.tick == null ? null : Number(row.tick),
    liquidity: row.liquidity ?? row.L ?? null,
    feeGrowthGlobalA: row.feeGrowthGlobalA ?? row.fee_growth_global_a ?? row.fga ?? null,
    feeGrowthGlobalB: row.feeGrowthGlobalB ?? row.fee_growth_global_b ?? row.fgb ?? null,
    feeRate: row.feeRate ?? row.fee_rate ?? null,
    tickSpacing: row.tickSpacing ?? row.tick_spacing ?? null,
    rewarders: rewarders.map((item) => {
      if (typeof item === "string") return { coin: null, emissionsPerSecond: null, growthGlobal: item };
      return {
        coin: item.coin ?? item.reward_coin ?? null,
        emissionsPerSecond: item.emissionsPerSecond ?? item.emissions_per_second ?? item.eps ?? null,
        growthGlobal: item.growthGlobal ?? item.growth_global ?? item.g ?? null,
      };
    }),
  };
}

export function asCandle(row) {
  return {
    startTs: Number(row.startTs ?? row.start_ts),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volumeUsd: Number(row.volumeUsd ?? row.volume_usd ?? row.v),
  };
}

export function asPrice(row) {
  return {
    hourTs: row.hourTs ?? row.hour_ts,
    symbol: row.symbol,
    price: Number(row.price),
  };
}
