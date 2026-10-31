// 7 天逐小时池子快照（fee_growth / rewarder growth），以及 Gas 样本、SUI 永续资金费
import fs from 'fs';
const _f = globalThis.fetch;
const fetch = async (u, o) => { for (let i = 0; ; i++) { try { const r = await _f(u, o); if (r.status === 429) throw new Error('429'); return r; } catch (e) { if (i >= 6) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); } } };
const POOL = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105';
const GQL = 'https://graphql.mainnet.sui.io/graphql';
const gql = async q => (await (await fetch(GQL, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({query:q})})).json());
const now = (await gql('{ checkpoint { sequenceNumber timestamp } }')).data.checkpoint;
const CPS_PER_HOUR = 15275;
const N = 7 * 24, out = new Array(N + 1);
const one = async h => {
  const cp = Number(now.sequenceNumber) - (N - h) * CPS_PER_HOUR;
  const r = await gql(`{ c: checkpoint(sequenceNumber: ${cp}) { timestamp } object(address: "${POOL}", atCheckpoint: ${cp}) { asMoveObject { contents { json } } } }`);
  const j = r.data.object.asMoveObject.contents.json;
  out[h] = { cp, ts: r.data.c.timestamp, sqrt: j.current_sqrt_price, tick: j.current_tick_index.bits, L: j.liquidity,
    fga: j.fee_growth_global_a, fgb: j.fee_growth_global_b, rw: j.rewarder_manager.rewarders.map(x => x.growth_global) };
};
for (let h = 0; h <= N; h += 8) { await Promise.all([...Array(8).keys()].map(k => h + k).filter(k => k <= N).map(one)); process.stdout.write('.'); }
fs.writeFileSync('hourly.json', JSON.stringify(out));
// 最近几笔触及该池子的交易的 Gas
const g = await gql(`{ transactions(last: 20, filter: { affectedObject: "${POOL}" }) { nodes { digest effects { gasEffects { gasSummary { computationCost storageCost storageRebate } } } kind { __typename } } } }`);
fs.writeFileSync('gas.json', JSON.stringify(g));
// Binance SUIUSDT 永续资金费（最近 90 期 = 30 天）
try { const fr = await (await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=SUIUSDT&limit=90')).json(); fs.writeFileSync('funding.json', JSON.stringify(fr)); } catch (e) { console.log('funding fail', e.message); }
console.log('\nok');
