const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createHttp({
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
  maxRetries = 6,
  baseDelayMs = 200,
} = {}) {
  async function request(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetchImpl(url, options);
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries) break;
        await sleepImpl(baseDelayMs * 2 ** attempt);
      }
    }
    throw lastError;
  }

  async function text(url, options) {
    const response = await request(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.text();
  }

  async function json(url, options) {
    return JSON.parse(await text(url, options));
  }

  async function gql(endpoint, query) {
    const body = await json(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (body.errors?.length) {
      throw new Error(body.errors.map((error) => error.message).join("; "));
    }
    return body.data;
  }

  return { request, text, json, gql };
}