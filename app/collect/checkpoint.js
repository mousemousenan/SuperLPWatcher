export async function findCheckpointForHour(getCheckpoint, hourTs, options = {}) {
  const cpsPerHour = options.cpsPerHour ?? 15275;
  const tip = options.hint ?? await getCheckpoint(null);
  const tipSeq = Number(tip.sequenceNumber);
  const tipTs = Date.parse(tip.timestamp);
  if (!Number.isFinite(tipTs)) throw new Error("checkpoint timestamp missing");
  if (hourTs > tipTs) throw new Error("hour is after the latest checkpoint");

  const elapsedHours = (tipTs - hourTs) / 3600000;
  const guess = Math.max(1, Math.min(tipSeq, Math.round(tipSeq - elapsedHours * cpsPerHour)));
  const direct = await walkToHour(getCheckpoint, hourTs, guess, tipSeq);
  if (direct) return direct;
  let lo = Math.max(1, guess - cpsPerHour);
  let hi = Math.min(tipSeq, Math.max(lo + 1, guess + cpsPerHour));
  if (hi <= lo) hi = Math.min(tipSeq, lo + 1);
  if (hi === lo) throw new Error("no checkpoint after hour");

  let loCp = await getCheckpoint(lo);
  let hiCp = await getCheckpoint(hi);
  for (let guard = 0; Date.parse(loCp.timestamp) > hourTs && lo > 1 && guard < 30; guard += 1) {
    lo = Math.max(1, lo - cpsPerHour * 2 ** Math.min(guard, 8));
    loCp = await getCheckpoint(lo);
  }
  for (let guard = 0; Date.parse(hiCp.timestamp) <= hourTs && hi < tipSeq && guard < 30; guard += 1) {
    hi = Math.min(tipSeq, hi + cpsPerHour * 2 ** Math.min(guard, 8));
    hiCp = await getCheckpoint(hi);
  }
  if (Date.parse(loCp.timestamp) > hourTs) throw new Error("hour is before available checkpoints");
  if (Date.parse(hiCp.timestamp) <= hourTs) throw new Error("no checkpoint after hour");

  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midCp = await getCheckpoint(mid);
    if (Date.parse(midCp.timestamp) <= hourTs) {
      lo = mid;
      loCp = midCp;
    } else {
      hi = mid;
      hiCp = midCp;
    }
  }

  if (hi !== lo + 1) throw new Error("checkpoint bracket failed");
  if (!(Date.parse(loCp.timestamp) <= hourTs && Date.parse(hiCp.timestamp) > hourTs)) {
    throw new Error("checkpoint bracket failed");
  }
  return {
    checkpoint: normalizeCheckpoint(loCp),
    next: normalizeCheckpoint(hiCp),
  };
}


async function walkToHour(getCheckpoint, hourTs, guess, tipSeq) {
  let seq = Math.max(1, Math.min(tipSeq, guess));
  let cp = await getCheckpoint(seq);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const ts = Date.parse(cp.timestamp);
    if (!Number.isFinite(ts)) return null;
    if (ts <= hourTs) {
      if (seq >= tipSeq) return null;
      const next = await getCheckpoint(seq + 1);
      const nextTs = Date.parse(next.timestamp);
      if (nextTs > hourTs) return { checkpoint: normalizeCheckpoint(cp), next: normalizeCheckpoint(next) };
      const stepMs = Math.max(1, nextTs - ts);
      seq = Math.min(tipSeq, seq + Math.max(1, Math.floor((hourTs - ts) / stepMs)));
    } else {
      if (seq <= 1) return null;
      const prev = await getCheckpoint(seq - 1);
      const prevTs = Date.parse(prev.timestamp);
      if (prevTs <= hourTs) return { checkpoint: normalizeCheckpoint(prev), next: normalizeCheckpoint(cp) };
      const stepMs = Math.max(1, ts - prevTs);
      seq = Math.max(1, seq - Math.max(1, Math.ceil((ts - hourTs) / stepMs)));
    }
    cp = await getCheckpoint(seq);
  }
  return null;
}
export function normalizeCheckpoint(cp) {
  return {
    sequenceNumber: Number(cp.sequenceNumber),
    timestamp: cp.timestamp,
  };
}

export function createCheckpointGetter(gql) {
  const cache = new Map();
  return async (seq) => {
    if (seq != null && cache.has(seq)) return cache.get(seq);
    const data = await gql(checkpointQuery(seq));
    const cp = data?.checkpoint;
    if (!cp?.timestamp) throw new Error(`checkpoint ${seq ?? "latest"} missing`);
    const norm = normalizeCheckpoint(cp);
    if (seq != null) cache.set(norm.sequenceNumber, norm);
    return norm;
  };
}

export function checkpointQuery(seq) {
  if (seq == null) return "{ checkpoint { sequenceNumber timestamp } }";
  if (!Number.isInteger(seq) || seq < 0) throw new Error(`bad checkpoint: ${seq}`);
  return `{ checkpoint(sequenceNumber: ${seq}) { sequenceNumber timestamp } }`;
}