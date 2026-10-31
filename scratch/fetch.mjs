// 拉取：30 天每日池子快照 + 小时K线 + CETUS 价格
import fs from 'fs';
const _f = globalThis.fetch;
const fetch = async (u, o) => { for (let i = 0; ; i++) { try { const r = await _f(u, o); if (r.status === 429) throw new Error('429'); return r; } catch (e) { if (i >= 6) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); } } };
const POOL = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105';
const GQL = 'https://graphql.mainnet.sui.io/graphql';
const gql = async q => (await (await fetch(GQL, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({query:q})})).json());
const now = (await gql('{ checkpoint { sequenceNumber timestamp } }')).data.checkpoint;
const CPS_PER_DAY = 366600;
const snaps = [];
for (let d = 30; d >= 0; d--) {
  const cp = Number(now.sequenceNumber) - d * CPS_PER_DAY;
  const r = await gql(`{ c: checkpoint(sequenceNumber: ${cp}) { timestamp } object(address: "${POOL}", atCheckpoint: ${cp}) { asMoveObject { contents { json } } } }`);
  const j = r.data.object.asMoveObject.contents.json;
  snaps.push({ cp, ts: r.data.c.timestamp, sqrt: j.current_sqrt_price, tick: j.current_tick_index.bits, L: j.liquidity,
    fga: j.fee_growth_global_a, fgb: j.fee_growth_global_b, coin_a: j.coin_a, coin_b: j.coin_b,
    rw: j.rewarder_manager.rewarders.map(x => ({coin: x.reward_coin.split('::').pop(), eps: x.emissions_per_second, g: x.growth_global})) });
  process.stdout.write('.');
}
fs.writeFileSync('snaps.json', JSON.stringify(snaps, null, 1));
const GT = 'https://api.geckoterminal.com/api/v2/networks/sui-network';
const ohlcv = await (await fetch(`${GT}/pools/${POOL}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=quote`)).json();
fs.writeFileSync('ohlcv_hour.json', JSON.stringify(ohlcv));
const cetus = await (await fetch(`${GT}/tokens/0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS`)).json();
fs.writeFileSync('cetus.json', JSON.stringify(cetus));
console.log('\nok', snaps.length, ohlcv.data?.attributes?.ohlcv_list?.length, cetus.data?.attributes?.price_usd);
