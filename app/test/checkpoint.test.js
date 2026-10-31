import assert from "node:assert/strict";
import test from "node:test";
import { findCheckpointForHour } from "../collect/checkpoint.js";

function chain(tip = 50_000) {
  return async (seq) => {
    const sequenceNumber = seq ?? tip;
    return { sequenceNumber, timestamp: new Date(sequenceNumber * 1000).toISOString() };
  };
}

test("a nearby guess resolves without scanning the whole chain", async () => {
  let calls = 0;
  const getCheckpoint = async (seq) => {
    calls += 1;
    const tip = 50_000;
    const sequenceNumber = seq ?? tip;
    return { sequenceNumber, timestamp: new Date(sequenceNumber * 1000).toISOString() };
  };
  const found = await findCheckpointForHour(getCheckpoint, 10_000_500, { cpsPerHour: 15_275 });
  assert.equal(found.checkpoint.sequenceNumber, 10_000);
  assert.ok(calls < 12, calls);
});
test("checkpoint timestamp is at or before the hour and the next one is after it", async () => {
  const hour = 10_000_500;
  const found = await findCheckpointForHour(chain(), hour, { cpsPerHour: 15_275 });
  assert.equal(found.checkpoint.sequenceNumber, 10_000);
  assert.ok(Date.parse(found.checkpoint.timestamp) <= hour);
  assert.ok(Date.parse(found.next.timestamp) > hour);
  assert.equal(found.next.sequenceNumber, found.checkpoint.sequenceNumber + 1);

  const exact = await findCheckpointForHour(chain(), 20_000_000, { cpsPerHour: 100 });
  assert.equal(exact.checkpoint.sequenceNumber, 20_000);
  assert.equal(Date.parse(exact.checkpoint.timestamp), 20_000_000);
  assert.ok(Date.parse(exact.next.timestamp) > 20_000_000);
});