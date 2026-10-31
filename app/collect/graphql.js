export function poolStateQuery({ pool, globalConfig, pricePool, checkpoint }) {
  if (!Number.isInteger(checkpoint) || checkpoint < 0) throw new Error(`bad checkpoint: ${checkpoint}`);
  return `{
    c: checkpoint(sequenceNumber: ${checkpoint}) { sequenceNumber timestamp }
    pool: object(address: "${pool}", atCheckpoint: ${checkpoint}) { asMoveObject { contents { type { repr } json } } }
    cfg: object(address: "${globalConfig}", atCheckpoint: ${checkpoint}) { asMoveObject { contents { json } } }
    pricePool: object(address: "${pricePool}", atCheckpoint: ${checkpoint}) { asMoveObject { contents { type { repr } json } } }
  }`;
}