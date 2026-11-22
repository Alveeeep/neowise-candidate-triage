import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { server } from "./server.mjs";

let endpoint;
before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  endpoint = `http://127.0.0.1:${server.address().port}/api/triage`;
});

after(async () => {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
});

function post(body) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(3_000),
  });
}

for (const [name, body] of [
  ["empty string", '{"text":""}'],
  ["whitespace only", JSON.stringify({ text: " \t\n" })],
  ["missing text", "{}"],
  ["non-string text", '{"text":42}'],
  ["null payload", "null"],
  ["malformed request JSON", '{"text":'],
]) {
  test(`rejects ${name} with 400 invalid_input`, async () => {
    const reply = await post(body);
    assert.equal(reply.status, 400);
    assert.deepEqual(await reply.json(), { status: "invalid_input" });
  });
}

test("returns a topic and draft for a valid request", async () => {
  const reply = await post(JSON.stringify({ text: "Когда будет доставка?" }));
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), {
    status: "ready",
    topic: "delivery",
    draft: "Спасибо за обращение. Уточним детали заявки.",
  });
});

for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]", "[timeout]"]) {
  test(`falls back to manual review for ${marker}`, async () => {
    const start = performance.now();
    const reply = await post(JSON.stringify({ text: `Тестовая заявка ${marker}` }));
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { status: "manual_review", topic: null, draft: null });
    if (marker === "[timeout]") {
      const elapsed = performance.now() - start;
      // Leave room for CI scheduling while distinguishing the mock's 1,200 ms delay.
      assert.ok(elapsed < 950, `Timeout response took ${Math.round(elapsed)} ms`);
    }
  });
}
