import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchLocalModels, isLocalModel, localBase, localErrorText, localId, localModelName, localRequestBody } from "../src/lmstudio";
import { OpenRouterError, streamChat } from "../src/openrouter";

const realFetch = globalThis.fetch;
function withFetch(fake: typeof fetch, fn: () => Promise<void>): Promise<void> {
  globalThis.fetch = fake;
  return fn().finally(() => {
    globalThis.fetch = realFetch;
  });
}

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const req = (onText: (t: string) => void) => ({
  apiKey: "sk-should-not-be-sent",
  model: "lmstudio/google/gemma-4-31b-qat",
  sessionId: "dialog-test",
  messages: [{ role: "user" as const, content: "hi" }],
  effort: "high" as const,
  tools: true,
  pdfEngine: "cloudflare-ai" as const,
  localServer: "http://localhost:1234",
  onText,
});

test("local model ids: marked by lmstudio/, sent to LM Studio without it", () => {
  assert.equal(isLocalModel("lmstudio/google/gemma-4-31b-qat"), true);
  assert.equal(isLocalModel(" lmstudio/qwen/qwen3.8-27b "), true);
  assert.equal(isLocalModel("google/gemini-pro"), false);
  assert.equal(localId("lmstudio/google/gemma-4-31b-qat"), "google/gemma-4-31b-qat");
});

test("the LM Studio address: with or without http://, a trailing slash or /v1", () => {
  for (const a of ["http://localhost:1234", "localhost:1234", "http://localhost:1234/", "http://localhost:1234/v1", " http://localhost:1234/v1/ "]) {
    assert.equal(localBase(a), "http://localhost:1234/v1", a);
  }
  assert.equal(localBase("https://studio.test:8443"), "https://studio.test:8443/v1");
});

test("local model names: words capitalized, sizes and short tags in capitals", () => {
  assert.equal(localModelName("google/gemma-4-31b-qat"), "Gemma 4 31B QAT");
  assert.equal(localModelName("google/gemma-4-e4b"), "Gemma 4 E4B");
  assert.equal(localModelName("qwen/qwen3.8-27b"), "Qwen3.8 27B");
  assert.equal(localModelName("mistral-small_24b"), "Mistral Small 24B");
});

test("request body for LM Studio: just the model, messages and streaming; none of OpenRouter's extras", () => {
  const body = localRequestBody({ model: "lmstudio/google/gemma-4-31b-qat", messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(body, {
    model: "google/gemma-4-31b-qat",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    stream_options: { include_usage: true },
  });
});

test("LM Studio's errors in plain words: a conversation too long for the model's window", () => {
  const raw =
    'Engine protocol predict request returned 400: {"error":{"code":400,"message":"request (12020 tokens) exceeds the available context size (8192 tokens), try increasing it"}}';
  const text = localErrorText(raw, "http://localhost:1234");
  assert.match(text, /too long for the model as LM Studio has it loaded: it needs 12,020 tokens, and the model's window is 8,192\./);
  assert.match(text, /load the model again with a larger context length/);
  assert.equal(localErrorText("Model crashed", "http://localhost:1234"), "LM Studio, at http://localhost:1234, reported a problem: Model crashed");
});

test("streamChat sends an LM Studio model to the address in Settings, with no key, and reads its stream", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let text = "";
  await withFetch(
    (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return sseResponse([
        'data: {"model":"google/gemma-4-31b-qat","choices":[{"delta":{"role":"assistant","reasoning_content":"Thinking"}}]}\n\n',
        'data: {"model":"google/gemma-4-31b-qat","choices":[{"delta":{"content":"Hello there."}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":22,"completion_tokens":237,"completion_tokens_details":{"reasoning_tokens":225}}}\n\n',
        "data: [DONE]\n\n",
      ]);
    }) as typeof fetch,
    async () => {
      const result = await streamChat(req((t) => (text += t)));
      assert.equal(text, "Hello there.", "the thinking isn't shown");
      assert.equal(result.model, "lmstudio/google/gemma-4-31b-qat", "written as the seat's model is");
      assert.equal(result.cost, undefined);
      assert.deepEqual(result.usage, { promptTokens: 22, completionTokens: 237, reasoningTokens: 225, cachedTokens: 0, cacheWriteTokens: 0 });
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://localhost:1234/v1/chat/completions");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined, "the OpenRouter key never goes to LM Studio");
  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(body.model, "google/gemma-4-31b-qat");
  for (const k of ["tools", "plugins", "reasoning", "session_id", "cache_control"]) assert.equal(body[k], undefined, k);
});

test("streamChat: LM Studio's error partway through, an HTTP error, and no server, in plain words", async () => {
  await withFetch(
    (async () =>
      sseResponse([
        'event: error\ndata: {"error":{"message":"Engine protocol predict request returned 400: request (12020 tokens) exceeds the available context size (8192 tokens), try increasing it"}}\n\n',
      ])) as typeof fetch,
    async () => {
      await assert.rejects(streamChat(req(() => {})), (e: unknown) => {
        assert.ok(e instanceof OpenRouterError);
        assert.match(e.message, /too long for the model as LM Studio has it loaded/);
        assert.doesNotMatch(e.message, /OpenRouter/);
        return true;
      });
    },
  );
  await withFetch(
    (async () => new Response(JSON.stringify({ error: "'messages' field is required" }), { status: 400 })) as typeof fetch,
    async () => {
      await assert.rejects(streamChat(req(() => {})), /LM Studio, at http:\/\/localhost:1234, reported a problem: 'messages' field is required/);
    },
  );
  await withFetch(
    (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch,
    async () => {
      await assert.rejects(streamChat(req(() => {})), (e: unknown) => {
        assert.ok(e instanceof OpenRouterError);
        assert.match(e.message, /^Couldn't reach LM Studio at http:\/\/localhost:1234\. Check that its server is running and was started with CORS on/);
        assert.match(e.message, /lms server start --cors/);
        assert.match(e.message, /Safari doesn't let the online Dialog reach a server on this computer/);
        return true;
      });
    },
  );
});

test("LM Studio's model list: chat models only, which can see images, which are loaded", async () => {
  let asked = "";
  const data = [
    { id: "google/gemma-4-31b-qat", type: "vlm", state: "loaded", max_context_length: 262144, loaded_context_length: 8192 },
    { id: "qwen/qwen3.8-27b", type: "llm", state: "not-loaded", max_context_length: 131072 },
    { id: "text-embedding-nomic-embed-text-v1.5", type: "embeddings", state: "not-loaded", max_context_length: 2048 },
  ];
  await withFetch(
    (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ data, object: "list" }));
    }) as typeof fetch,
    async () => {
      const list = await fetchLocalModels("localhost:1234/v1");
      assert.deepEqual(
        list.map((m) => [m.id, m.name, m.contextLength, m.inputModalities, m.local]),
        [
          ["lmstudio/google/gemma-4-31b-qat", "Gemma 4 31B QAT (LM Studio)", 8192, ["text", "image"], { loaded: true }],
          ["lmstudio/qwen/qwen3.8-27b", "Qwen3.8 27B (LM Studio)", 131072, ["text"], { loaded: false }],
        ],
      );
      assert.ok(list.every((m) => m.tools === false && m.inputPrice === 0 && m.outputPrice === 0));
    },
  );
  assert.equal(asked, "http://localhost:1234/api/v0/models");
  await withFetch(
    (async () => {
      throw new TypeError("Load failed");
    }) as typeof fetch,
    async () => {
      await assert.rejects(fetchLocalModels("http://localhost:1234"), /^Error: Couldn't reach LM Studio at http:\/\/localhost:1234\./);
    },
  );
});
