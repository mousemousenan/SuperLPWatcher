import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export const config = {
  graphqlUrl: "https://graphql.mainnet.sui.io/graphql",
  cetusStatsUrl: "https://api-sui.cetus.zone/v3/sui/clmm/stats_pools",
  globalConfig: "0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f",
  timezoneOffsetHours: 8,
  cpsPerHour: 15275,
  backfillDays: 30,
  ohlcvRefreshHours: 48,
  reconcileThreshold: 0.05,
  staleMs: 2 * 60 * 60 * 1000,
  dbPath: path.join(root, "data", "pool.sqlite"),
  probePath: path.join(root, "data", "probe-alignment.jsonl"),
  pool: {
    address: "0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105",
    name: "Cetus USDC/SUI 0.25%",
    coinA: {
      symbol: "USDC",
      decimals: 6,
      typeMarker: "::usdc::USDC",
    },
    coinB: {
      symbol: "SUI",
      decimals: 9,
      typeMarker: "::sui::SUI",
    },
  },
  incentivePools: [
    {
      symbol: "CETUS",
      poolAddress: "0x3b13ac70030d587624e407bbe791160b459c48f1049e04269eb8ee731f5442b4",
      coinATypeMarker: "::usdc::USDC",
      coinBTypeMarker: "::cetus::CETUS",
      decimalsA: 6,
      decimalsB: 9,
    },
  ],
};

export function geckoOhlcvUrl(poolAddress = config.pool.address) {
  return `https://api.geckoterminal.com/api/v2/networks/sui-network/pools/${poolAddress}/ohlcv/hour`;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  console.log(config.pool.address);
}