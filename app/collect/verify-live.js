import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "../config.js";
import { createHttp } from "../lib/http.js";
import { sqrtPriceToHuman } from "../lib/math.js";
import { createCheckpointGetter, findCheckpointForHour } from "./checkpoint.js";
import { fetchPoolState, parsePoolJson } from "./snapshot.js";
import { interpretPricePool } from "./snapshot.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function compareSnap(parsed, snap) {
  const mismatches = [];
  const expect = [
    ["sqrt", parsed.sqrtPrice, snap.sqrt],
    ["tick bits", parsed.tickBits, snap.tick],
    ["liquidity", parsed.liquidity, snap.L],
    ["fga", parsed.feeGrowthGlobalA, snap.fga],
    ["fgb", parsed.feeGrowthGlobalB, snap.fgb],
    ["coin_a", parsed.coinA, snap.coin_a],
    ["coin_b", parsed.coinB, snap.coin_b],
  ];
  for (const [name, actual, expected] of expect) {
    if (String(actual) !== String(expected)) mismatches.push(`${name}: ${actual} != ${expected}`);
  }
  for (const reward of snap.rw) {
    const found = parsed.rewarders.find((item) => item.coin.split("::").pop() === reward.coin);
    if (!found) {
      mismatches.push(`rewarder ${reward.coin} missing`);
      continue;
    }
    if (found.emissionsPerSecond !== reward.eps) mismatches.push(`${reward.coin} eps ${found.emissionsPerSecond} != ${reward.eps}`);
    if (found.growthGlobal !== reward.g) mismatches.push(`${reward.coin} growth ${found.growthGlobal} != ${reward.g}`);
  }
  return mismatches;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const snaps = JSON.parse(fs.readFileSync(path.join(root, "scratch", "snaps.json"), "utf8"));
  const snap = snaps.at(-1);
  const http = createHttp();
  const gql = (query) => http.gql(config.graphqlUrl, query);
  const data = await fetchPoolState(gql, config, snap.cp);
  const parsed = parsePoolJson(data.pool.asMoveObject.contents.json);
  const mismatches = compareSnap(parsed, snap);
  const protocolFee = data.cfg?.asMoveObject?.contents?.json?.protocol_fee_rate;
  console.log(`checkpoint ${snap.cp} ${snap.ts}`);
  console.log(`protocol_fee_rate ${protocolFee}`);
  console.log(`tick_spacing ${parsed.tickSpacing} signed tick ${parsed.tick}`);
  if (mismatches.length) {
    console.error(mismatches.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("snapshot fields match scratch/snaps.json");
  }
  const hourTs = Math.floor(Date.parse(snap.ts) / 3600000) * 3600000;
  const found = await findCheckpointForHour(createCheckpointGetter(gql), hourTs, { cpsPerHour: config.cpsPerHour });
  const foundTs = Date.parse(found.checkpoint.timestamp);
  const nextTs = Date.parse(found.next.timestamp);
  const bracket = foundTs <= hourTs && nextTs > hourTs && found.next.sequenceNumber === found.checkpoint.sequenceNumber + 1;
  console.log(`hour ${new Date(hourTs).toISOString()} cp ${found.checkpoint.sequenceNumber} ${found.checkpoint.timestamp} next ${found.next.timestamp} bracket ${bracket}`);
  if (!bracket) process.exitCode = 1;
  const hourState = await fetchPoolState(gql, config, found.checkpoint.sequenceNumber);
  const price = interpretPricePool(hourState, config);
  const sui = sqrtPriceToHuman(parsed.sqrtPrice, config.pool.coinA.decimals, config.pool.coinB.decimals);
  console.log(`sui price ${sui}`);
  if (!price.ok) {
    console.error(`cetus price failed: ${price.reason}`);
    process.exitCode = 1;
  } else {
    const closeHour = hourTs - 3600000;
    const klines = await http.json(`https://api.binance.com/api/v3/klines?symbol=CETUSUSDT&interval=1h&startTime=${closeHour}&limit=1`);
    const close = Number(klines?.[0]?.[4]);
    const diff = Math.abs(price.price - close) / close;
    console.log(`cetus at hour ${price.price} binance close ${close} diff ${(diff * 100).toFixed(3)}%`);
    if (!(diff <= 0.02)) {
      console.error("cetus price differs from Binance by more than 2%");
      process.exitCode = 1;
    }
  }
}