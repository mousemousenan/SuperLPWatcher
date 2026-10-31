import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as defaultConfig, geckoOhlcvUrl } from "../config.js";
import { createHttp } from "../lib/http.js";
import { parseCetusStats } from "./cetus-stats.js";
import { parseOhlcvList } from "./ohlcv.js";

export function completedCandleVolume(candles, nowSec) {
  const done = candles
    .filter((candle) => candle.startTs + 3600 <= nowSec)
    .sort((a, b) => b.startTs - a.startTs)
    .slice(0, 24);
  return {
    sum: done.reduce((total, candle) => total + candle.volumeUsd, 0),
    count: done.length,
  };
}

export function summarizeProbe(samples) {
  let changes = 0;
  const intervalsMin = [];
  let lastChangeAt = samples[0] ? Date.parse(samples[0].at) : null;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].cetusVol24h !== samples[i - 1].cetusVol24h) {
      changes += 1;
      intervalsMin.push((Date.parse(samples[i].at) - lastChangeAt) / 60000);
      lastChangeAt = Date.parse(samples[i].at);
    }
  }
  const deviations = samples.map((sample) => sample.deviation).filter((value) => Number.isFinite(value));
  const deviationMin = deviations.length ? Math.min(...deviations) : null;
  const deviationMax = deviations.length ? Math.max(...deviations) : null;
  const within5 = deviations.filter((value) => Math.abs(value) <= 0.05).length;
  return {
    samples: samples.length,
    cetusVolChanges: changes,
    minutesBetweenChanges: intervalsMin,
    deviationMin,
    deviationMax,
    deviationMean: deviations.length ? deviations.reduce((sum, value) => sum + value, 0) / deviations.length : null,
    within5pct: within5,
    outside5pct: deviations.length - within5,
  };
}

export async function sampleOnce({ http, appConfig = defaultConfig, now = new Date() }) {
  const nowSec = Math.floor(now.getTime() / 1000);
  const statsText = await http.text(`${appConfig.cetusStatsUrl}?pool=${appConfig.pool.address}`);
  const stats = parseCetusStats(statsText, appConfig.pool.address);
  const url = new URL(geckoOhlcvUrl(appConfig.pool.address));
  url.searchParams.set("aggregate", "1");
  url.searchParams.set("currency", "usd");
  url.searchParams.set("token", "quote");
  url.searchParams.set("limit", "25");
  const candles = parseOhlcvList(await http.json(url));
  const completed = completedCandleVolume(candles, nowSec);
  const cetusVol = stats.ok ? Number(stats.vol24h) : null;
  const deviation = stats.ok && cetusVol ? (cetusVol - completed.sum) / cetusVol : null;
  return {
    at: now.toISOString(),
    cetusOk: stats.ok,
    cetusVol24h: stats.ok ? stats.vol24h : null,
    cetusFee24h: stats.ok ? stats.fee24h : null,
    cetusReason: stats.ok ? null : stats.reason,
    completedCount: completed.count,
    completed24Sum: completed.sum,
    deviation,
  };
}

function readSamples(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const once = process.argv.includes("--once");
  const durationMs = once ? 0 : numberArg("--duration-ms", 3 * 60 * 60 * 1000);
  const intervalMs = numberArg("--interval-ms", 5 * 60 * 1000);
  const file = defaultConfig.probePath;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const http = createHttp();
  const started = Date.now();
  console.error(`probe -> ${file}`);
  console.error(once ? "single sample" : `every ${intervalMs / 60000} min for ${durationMs / 3600000} h`);
  do {
    try {
      const sample = await sampleOnce({ http });
      fs.appendFileSync(file, `${JSON.stringify(sample)}\n`);
      console.error(`${sample.at} vol=${sample.cetusVol24h} kline=${sample.completed24Sum} dev=${sample.deviation}`);
    } catch (error) {
      const failure = { at: new Date().toISOString(), error: error.message };
      fs.appendFileSync(file, `${JSON.stringify(failure)}\n`);
      console.error(`sample failed: ${error.message}`);
    }
    if (once || Date.now() - started >= durationMs) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
  const summary = summarizeProbe(readSamples(file).filter((row) => row.cetusVol24h != null));
  const summaryPath = file.replace(/\.jsonl$/, "-summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`summary -> ${summaryPath}`);
  console.log(JSON.stringify(summary));
}

function numberArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  return Number(process.argv[index + 1]);
}