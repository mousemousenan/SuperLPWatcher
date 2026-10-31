// 抽样：最近若干笔触及池子的交易，汇总本池 SwapEvent 的成交额与手续费，用来交叉验证 feeGrowth 推算
import fs from 'fs';
const _f = globalThis.fetch;
const fetch = async (u, o) => { for (let i = 0; ; i++) { try { const r = await _f(u, o); const t = await r.text(); return JSON.parse(t); } catch (e) { if (i >= 6) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); } } };
const POOL = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105';
let before = null, swaps = [], txs = 0, senders = new Map();
for (let page = 0; page < 40; page++) {
  const q = `{ transactions(last: 50${before ? `, before: "${before}"` : ''}, filter: { affectedObject: "${POOL}" }) { pageInfo { startCursor hasPreviousPage } nodes { digest sender { address } effects { timestamp events { nodes { contents { type { repr } json } } } } } } }`;
  const j = await fetch('https://graphql.mainnet.sui.io/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) });
  if (j.errors) { console.log(JSON.stringify(j.errors).slice(0, 300)); break; }
  const t = j.data.transactions;
  for (const n of t.nodes) {
    txs++;
    for (const e of n.effects.events.nodes) {
      if (!e.contents.type.repr.endsWith('pool::SwapEvent') || e.contents.json.pool !== POOL) continue;
      const s = e.contents.json; const amt = Number(s.amount_in);
      const usdIn = s.atob ? amt / 1e6 : null; // atob: 输入 USDC
      swaps.push({ ts: n.effects.timestamp, atob: s.atob, amount_in: s.amount_in, amount_out: s.amount_out, fee: s.fee_amount, steps: s.steps, sender: n.sender.address });
      senders.set(n.sender.address, (senders.get(n.sender.address) || 0) + 1);
    }
  }
  if (!t.pageInfo.hasPreviousPage) break; before = t.pageInfo.startCursor; process.stdout.write('.');
}
fs.writeFileSync('swaps.json', JSON.stringify(swaps));
console.log('\ntxs', txs, 'swaps', swaps.length, 'from', swaps.at(-1)?.ts, 'to', swaps[0]?.ts);
console.log('top senders', [...senders].sort((a, b) => b[1] - a[1]).slice(0, 5));
