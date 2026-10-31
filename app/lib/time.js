export const HOUR_MS = 60 * 60 * 1000;

export function floorHour(ms) {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export function hoursBetween(startMs, endMs) {
  const out = [];
  for (let ts = startMs; ts <= endMs; ts += HOUR_MS) out.push(ts);
  return out;
}

export const DAY_MS = 24 * HOUR_MS;

export function startOfDay(utcMs, offsetHours) {
  const offset = offsetHours * HOUR_MS;
  return Math.floor((utcMs + offset) / DAY_MS) * DAY_MS - offset;
}

export function formatDay(dayStartMs, offsetHours) {
  const shifted = new Date(dayStartMs + offsetHours * HOUR_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

export function formatDateTime(utcMs, offsetHours) {
  if (utcMs == null || !Number.isFinite(Number(utcMs))) return null;
  const shifted = new Date(Number(utcMs) + offsetHours * HOUR_MS);
  const pad = (value) => String(value).padStart(2, "0");
  const sign = offsetHours >= 0 ? "+" : "";
  return shifted.getUTCFullYear() + "-" + pad(shifted.getUTCMonth() + 1) + "-" + pad(shifted.getUTCDate()) + " " + pad(shifted.getUTCHours()) + ":" + pad(shifted.getUTCMinutes()) + "（UTC" + sign + offsetHours + "）";
}
