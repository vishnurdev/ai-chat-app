import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler, { validate, MODELS, getModels, resetModelCache } from "../api/chat.js";

const MODEL = MODELS[0].id;
const realFetch = globalThis.fetch;

function post(body) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function sseResponse(chunks) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

beforeEach(() => {
  process.env.GROQ_API_KEY = "test-key";
  resetModelCache();
  // default: model list endpoint fails -> fallback list is used
  globalThis.fetch = async () => new Response("down", { status: 500 });
});
afterEach(() => { globalThis.fetch = realFetch; });

test("validate accepts a normal conversation", () => {
  const r = validate({ model: MODEL, messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.error, undefined);
  assert.equal(r.persona, "assistant");
});

test("validate rejects bad input", () => {
  assert.ok(validate({ model: "nope", messages: [{ role: "user", content: "hi" }] }).error);
  assert.ok(validate({ model: MODEL, messages: [] }).error);
  assert.ok(validate({ model: MODEL, messages: [{ role: "system", content: "x" }] }).error);
  assert.ok(validate({ model: MODEL, messages: [{ role: "user", content: "x".repeat(5000) }] }).error);
  assert.ok(validate({ model: MODEL, persona: "pirate", messages: [{ role: "user", content: "hi" }] }).error);
  assert.ok(validate({ model: MODEL, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }).error);
});

test("GET returns models and personas", async () => {
  const res = await handler(new Request("http://localhost/api/chat"));
  const data = await res.json();
  assert.ok(data.models.length >= 1);
  assert.ok(data.personas.some((p) => p.id === "assistant"));
});

test("missing API key returns 500", async () => {
  delete process.env.GROQ_API_KEY;
  const res = await handler(post({ model: MODEL, messages: [{ role: "user", content: "hi" }] }));
  assert.equal(res.status, 500);
});

test("invalid JSON returns 400", async () => {
  const res = await handler(post("{not json"));
  assert.equal(res.status, 400);
});

test("streams text from Groq SSE, even when events are split across chunks", async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/models")) return new Response("down", { status: 500 });
    sent = JSON.parse(init.body);
    assert.equal(init.headers.Authorization, "Bearer test-key");
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"con',
      'tent":"lo!"}}]}\n\ndata: {"choices":[{"delta":{}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
  };
  const res = await handler(post({ model: MODEL, persona: "coder", messages: [{ role: "user", content: "hi" }] }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "Hello!");
  assert.equal(sent.messages[0].role, "system");
  assert.equal(sent.stream, true);
});

test("upstream rate limit becomes a friendly 429", async () => {
  globalThis.fetch = async (url) => String(url).endsWith("/models")
    ? new Response("down", { status: 500 })
    : new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429 });
  const res = await handler(post({ model: MODEL, messages: [{ role: "user", content: "hi" }] }));
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /Rate limit/);
});

test("upstream error message is passed through", async () => {
  globalThis.fetch = async (url) => String(url).endsWith("/models")
    ? new Response("down", { status: 500 })
    : new Response(JSON.stringify({ error: { message: "model overloaded" } }), { status: 503 });
  const res = await handler(post({ model: MODEL, messages: [{ role: "user", content: "hi" }] }));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "model overloaded");
});

test("live model list keeps only active chat models", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [
    { id: "openai/gpt-oss-120b", active: true },
    { id: "whisper-large-v3", active: true },
    { id: "meta-llama/llama-guard-4-12b", active: true },
    { id: "qwen/qwen3-32b", active: true },
    { id: "old-model", active: false },
  ] }), { status: 200 });
  const list = await getModels("k");
  assert.deepEqual(list.map((m) => m.id).sort(), ["openai/gpt-oss-120b", "qwen/qwen3-32b"]);
  assert.equal(list.find((m) => m.id === "openai/gpt-oss-120b").label, "GPT OSS 120B");
});

test("a model from the live list is accepted, unknown ones rejected", async () => {
  const live = [{ id: "qwen/qwen3-32b", label: "Qwen3 32B" }];
  assert.equal(validate({ model: "qwen/qwen3-32b", messages: [{ role: "user", content: "hi" }] }, live).error, undefined);
  assert.ok(validate({ model: MODEL, messages: [{ role: "user", content: "hi" }] }, live).error);
});

test("'no access' errors become a friendly message", async () => {
  globalThis.fetch = async (url) => String(url).endsWith("/models")
    ? new Response("down", { status: 500 })
    : new Response(JSON.stringify({ error: { message: "The model `x` does not exist or you do not have access to it." } }), { status: 404 });
  const res = await handler(post({ model: MODEL, messages: [{ role: "user", content: "hi" }] }));
  assert.match((await res.json()).error, /isn't available for your API key/);
});
