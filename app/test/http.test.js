import assert from "node:assert/strict";
import test from "node:test";
import { createHttp } from "../lib/http.js";

test("retries twice and then returns the successful response", async () => {
  const sleeps = [];
  let calls = 0;
  const http = createHttp({
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new Error("socket reset");
      return { status: 200, ok: true };
    },
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
    baseDelayMs: 200,
  });
  const response = await http.request("https://example.test/graphql");
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [200, 400]);
});