import { test } from "node:test";
import assert from "node:assert/strict";
import { citationsFrom, errorDetails, fetchHost, fetchModels, interpretPayload, requestBody, SSEParser, streamChat, thinkingFrom, OpenRouterError } from "../src/openrouter";

test("SSE parser handles split lines, comments, CRLF and [DONE]", () => {
  const p = new SSEParser();
  assert.deepEqual(p.push(": OPENROUTER PROCESSING\n\ndata: {\"a\""), [": OPENROUTER PROCESSING"], "keep-alive comments passed on, in order");
  assert.deepEqual(p.push(":1}\r\n\r\ndata: [DO"), ['{"a":1}']);
  assert.deepEqual(p.push("NE]\n"), ["[DONE]"]);
});

test("payload interpretation: text, usage, cost, citations, errors", () => {
  assert.deepEqual(interpretPayload("[DONE]"), { done: true });
  assert.deepEqual(interpretPayload("not json"), {});
  assert.equal(interpretPayload('{"choices":[{"delta":{"content":"Hi"}}]}').text, "Hi");

  const flat = interpretPayload(
    '{"model":"anthropic/claude-opus-5.5","choices":[{"delta":{"content":""},"finish_reason":"stop"}],' +
      '"usage":{"prompt_tokens":100,"completion_tokens":40,"reasoning_tokens":25,"cached_tokens":60,"cost":0.0123}}',
  );
  assert.equal(flat.cost, 0.0123);
  assert.deepEqual(flat.usage, { promptTokens: 100, completionTokens: 40, reasoningTokens: 25, cachedTokens: 60, cacheWriteTokens: 0 });
  assert.equal(flat.model, "anthropic/claude-opus-5.5");
  assert.equal(flat.text, undefined);

  const nested = interpretPayload(
    '{"usage":{"prompt_tokens":10,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":4,"cache_write_tokens":6},' +
      '"completion_tokens_details":{"reasoning_tokens":3},"cost":0}}',
  );
  assert.deepEqual(nested.usage, { promptTokens: 10, completionTokens: 5, reasoningTokens: 3, cachedTokens: 4, cacheWriteTokens: 6 });
  assert.equal(nested.cost, 0);

  const err = interpretPayload('{"error":{"code":"server_error","message":"Overloaded"}}').error ?? "";
  assert.match(err, /host failed partway through\. OpenRouter says: \u201cOverloaded\u201d \(code: server_error\)$/);
});

test("thinking: read once though OpenRouter sends it twice; LM Studio's fields; encrypted thinking skipped", () => {
  const both = interpretPayload('{"choices":[{"delta":{"content":"","reasoning":"Hmm.","reasoning_details":[{"type":"reasoning.text","text":"Hmm."}]}}]}');
  assert.equal(both.thinking, "Hmm.");
  assert.equal(both.text, undefined);
  assert.equal(thinkingFrom({ reasoning_details: [{ type: "reasoning.summary", summary: "In short, " }, { type: "reasoning.text", text: "yes." }] }), "In short, yes.");
  assert.equal(thinkingFrom({ reasoning_details: [{ type: "reasoning.encrypted", data: "[REDACTED]" }] }), "");
  assert.equal(thinkingFrom({ reasoning: null, reasoning_content: "Older LM Studio." }), "Older LM Studio.");
  assert.equal(thinkingFrom({ content: "Hi" }), "");
});

test("web use: searches, and all web tools where the host counts them, under either name", () => {
  const observed = interpretPayload('{"usage":{"prompt_tokens":1,"completion_tokens":1,"server_tool_use_details":{"web_search_requests":1,"tool_calls_requested":2,"tool_calls_executed":2}}}');
  assert.equal(observed.usage?.webSearches, 1);
  assert.equal(observed.usage?.webToolsUsed, 2);
  const documented = interpretPayload('{"usage":{"prompt_tokens":1,"completion_tokens":1,"server_tool_use":{"web_search_requests":3}}}');
  assert.equal(documented.usage?.webSearches, 3);
  assert.equal(documented.usage?.webToolsUsed, undefined);
  assert.equal(interpretPayload('{"usage":{"prompt_tokens":1,"completion_tokens":1}}').usage?.webSearches, undefined);
});

test("streamChat: text resuming after a pause (two or more keep-alive comments) is marked", async () => {
  const text = (t: string) => `data: {"choices":[{"delta":{"content":${JSON.stringify(t)}}}]}\n\n`;
  const quiet = ": OPENROUTER PROCESSING\n\n";
  const chunks = [quiet, quiet, quiet, text("Searching."), quiet, text(" Still"), quiet, quiet, text("Found it."), "data: [DONE]\n\n"];
  await withFetch((async () => sseResponse(chunks)) as typeof fetch, async () => {
    const got: [string, boolean][] = [];
    await streamChat({ ...req(() => {}), onText: (t, afterPause) => got.push([t, afterPause]) });
    assert.deepEqual(got, [
      ["Searching.", true],
      [" Still", false],
      ["Found it.", true],
    ]);
  });
});

test("error details: host, its code, what it said, and the request id", () => {
  assert.equal(errorDetails({ message: "x" }), "");
  assert.equal(
    errorDetails({ code: 502, metadata: { provider_name: "Google AI Studio", provider_code: "INVALID_ARGUMENT", raw: { error: "bad image" } } }, "gen-123"),
    '(host: Google AI Studio; code: INVALID_ARGUMENT; host said: {"error":"bad image"}; request gen-123)',
  );
  const long = errorDetails({ metadata: { raw: "z".repeat(400) } });
  assert.ok(long.length < 330 && long.includes("\u2026"));
});

test("citations in both known shapes", () => {
  const c = citationsFrom([
    { type: "url_citation", url_citation: { url: "https://a.org", title: "A" } },
    { type: "url_citation", url: "https://b.org" },
    { type: "file_citation", url: "https://ignored.org" },
    "junk",
  ]);
  assert.deepEqual(c, [
    { url: "https://a.org", title: "A" },
    { url: "https://b.org", title: undefined },
  ]);
});

test("request body: thinking level when asked; web search and page reading for models that use tools", () => {
  const base = { model: "x-ai/grok-4.7", sessionId: "dialog-S1", messages: [{ role: "user" as const, content: "hi" }] };
  const plain = requestBody({ ...base, effort: "default", tools: false });
  assert.deepEqual(plain, { model: "x-ai/grok-4.7", messages: base.messages, stream: true, session_id: "dialog-S1" });
  const full = requestBody({ ...base, effort: "high", tools: true });
  assert.deepEqual(full.reasoning, { effort: "high" }, "the thinking comes back, to be shown");
  assert.deepEqual(full.tools, [
    { type: "openrouter:web_search", parameters: { max_uses: 10 } },
    { type: "openrouter:web_fetch" },
  ]);
});

test("request body: the free PDF converter only when asked for", () => {
  const base = { model: "x-ai/grok-4.7", sessionId: "s", messages: [], tools: false, effort: "default" };
  assert.equal(requestBody(base).plugins, undefined);
  assert.deepEqual(requestBody({ ...base, pdfEngine: "cloudflare-ai" }).plugins, [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]);
});

test("request body: Claude gets the 1-hour cache; others cache automatically", () => {
  const base = { sessionId: "s", messages: [], tools: false, effort: "default" };
  for (const id of ["anthropic/claude-opus-5.5", "~anthropic/claude-sonnet-latest", " anthropic/x "]) {
    assert.deepEqual(requestBody({ ...base, model: id }).cache_control, { type: "ephemeral", ttl: "1h" }, id);
  }
  for (const id of ["openai/gpt-6-astra", "~google/gemini-pro-latest", "x-ai/grok-4.7", "~deepseek/deepseek-pro-latest", "notanthropic/claude"]) {
    assert.equal(requestBody({ ...base, model: id }).cache_control, undefined, id);
  }
});

// --- streamChat against a fake fetch -------------------------------------------------

function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } });
}

const realFetch = globalThis.fetch;
function withFetch(fake: typeof fetch, fn: () => Promise<void>): Promise<void> {
  globalThis.fetch = fake;
  return fn().finally(() => {
    globalThis.fetch = realFetch;
  });
}

const req = (onText: (t: string) => void) => ({
  apiKey: "sk-test",
  model: "x-ai/grok-4.7",
  sessionId: "dialog-test",
  messages: [{ role: "user" as const, content: "hi" }],
  effort: "default" as const,
  tools: true,
  onText,
});

test("streamChat assembles text, cost and de-duplicated citations from a chunked stream", async () => {
  let sentBody: unknown;
  let sentAuth = "";
  const body =
    ': OPENROUTER PROCESSING\n\n' +
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"lo","annotations":[{"type":"url_citation","url_citation":{"url":"https://x.org","title":"X"}}]}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":" world","annotations":[{"type":"url_citation","url_citation":{"url":"https://x.org","title":"X"}}]}}]}\n\n' +
    'data: {"model":"x-ai/grok-4.7","choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":3,"cost":0.0042}}\n\n' +
    "data: [DONE]\n\n";
  // Split at awkward places to exercise buffering.
  const chunks = [body.slice(0, 7), body.slice(7, 61), body.slice(61, 200), body.slice(200)];
  await withFetch(
    (async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      sentAuth = String((init?.headers as Record<string, string>).Authorization);
      return sseResponse(chunks);
    }) as typeof fetch,
    async () => {
      let text = "";
      const r = await streamChat(req((t) => (text += t)));
      assert.equal(text, "Hello world");
      assert.equal(r.cost, 0.0042);
      assert.equal(r.model, "x-ai/grok-4.7");
      assert.deepEqual(r.citations, [{ url: "https://x.org", title: "X" }]);
    },
  );
  assert.equal(sentAuth, "Bearer sk-test");
  assert.deepEqual((sentBody as { tools: unknown }).tools, [
    { type: "openrouter:web_search", parameters: { max_uses: 10 } },
    { type: "openrouter:web_fetch" },
  ]);
});

test("streamChat: a model none of whose hosts can use tools is asked again without them", async () => {
  const bodies: { tools?: unknown }[] = [];
  await withFetch(
    (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) {
        return new Response(JSON.stringify({ error: { message: "No endpoints found that support tool use.", code: 404 } }), { status: 404 });
      }
      return sseResponse(['data: {"choices":[{"delta":{"content":"Fine."},"finish_reason":"stop"}]}\n\n', "data: [DONE]\n\n"]);
    }) as typeof fetch,
    async () => {
      let text = "";
      await streamChat(req((t) => (text += t)));
      assert.equal(text, "Fine.");
    },
  );
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0]?.tools);
  assert.equal(bodies[1]?.tools, undefined);
});

test("streamChat: a 404 for the model itself says it may be withdrawn, not something about search", async () => {
  await withFetch(
    (async () => new Response(JSON.stringify({ error: { message: "No endpoints found for gone/model.", code: 404 } }), { status: 404 })) as typeof fetch,
    async () => {
      await assert.rejects(streamChat(req(() => {})), (e: unknown) => {
        assert.ok(e instanceof OpenRouterError);
        assert.match(e.message, /found nowhere to run this model.*withdrawn.*model button.*hosts are down/);
        assert.doesNotMatch(e.message, /search/i);
        assert.match(e.message, /No endpoints found for gone\/model/);
        return true;
      });
    },
  );
});

test("streamChat explains HTTP errors in plain words", async () => {
  await withFetch(
    (async () => new Response(JSON.stringify({ error: { message: "No auth credentials found" } }), { status: 401 })) as typeof fetch,
    async () => {
      await assert.rejects(streamChat(req(() => {})), (e: unknown) => {
        assert.ok(e instanceof OpenRouterError);
        assert.match(e.message, /didn't accept the API key/);
        assert.match(e.message, /No auth credentials found/);
        return true;
      });
    },
  );
});

test("streamChat surfaces an error that arrives mid-stream", async () => {
  await withFetch(
    (async () =>
      sseResponse([
        'data: {"id":"gen-42","choices":[{"delta":{"content":"Part"}}]}\n\n',
        'data: {"error":{"code":"server_error","message":"Provider fell over"},"choices":[{"finish_reason":"error"}]}\n\n',
      ])) as typeof fetch,
    async () => {
      let text = "";
      await assert.rejects(streamChat(req((t) => (text += t))), /Provider fell over.*\(code: server_error\) \(request gen-42\)$/);
      assert.equal(text, "Part");
    },
  );
});

test("model list: prices per million, thinking levels, batch and non-text models dropped", async () => {
  const data = {
    data: [
      {
        id: "anthropic/claude-opus-5.5",
        name: "Anthropic: Claude Opus 5.5",
        pricing: { prompt: "0.000004", completion: "0.00002" },
        context_length: 1000000,
        architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
        reasoning: { mandatory: true, supported_efforts: ["max", "xhigh", "high", "medium", "low"], default_effort: "high" },
        supported_parameters: ["reasoning", "tools", "tool_choice"],
      },
      { id: "no/tools", name: "No tools", pricing: {}, architecture: { output_modalities: ["text"] }, supported_parameters: ["temperature"] },
      { id: "anthropic/claude-opus-5.5:batch", name: "batch", pricing: {}, architecture: { output_modalities: ["text"] } },
      { id: "img/gen", name: "Image", pricing: {}, architecture: { output_modalities: ["image"] } },
      { id: "plain/model", name: "Plain", pricing: { prompt: "0.0000002464", completion: "0.0000042" }, architecture: { output_modalities: ["text"] } },
      { id: "~openai/gpt-astra-latest", name: "OpenAI: GPT Astra Latest", alias_target: { name: "OpenAI: GPT-6 Astra", slug: "openai/gpt-6-astra" }, pricing: {}, architecture: { output_modalities: ["text"] } },
    ],
  };
  await withFetch((async () => new Response(JSON.stringify(data))) as typeof fetch, async () => {
    const models = await fetchModels();
    assert.deepEqual(models.map((m) => m.id), ["anthropic/claude-opus-5.5", "no/tools", "~openai/gpt-astra-latest", "plain/model"]);
    assert.deepEqual(models.map((m) => m.tools), [true, false, true, true], "tools unless the list says otherwise");
    assert.deepEqual(models[2]!.aliasOf, { id: "openai/gpt-6-astra", name: "OpenAI: GPT-6 Astra" }, "what a ~latest id stands for now");
    assert.equal(models[0]!.aliasOf, undefined);
    const opus = models[0]!;
    assert.equal(opus.inputPrice, 4);
    assert.equal(opus.outputPrice, 20);
    assert.deepEqual(opus.inputModalities, ["text", "image", "file"]);
    assert.deepEqual(opus.reasoning, { efforts: ["max", "xhigh", "high", "medium", "low"], defaultEffort: "high", mandatory: true, defaultEnabled: undefined });
    assert.equal(models[3]!.reasoning, undefined);
    assert.deepEqual(models[3]!.inputModalities, ["text"], "defaults to text when not listed");
  });
});

test("model list: fetched from OpenRouter itself, past the browser's stored copy; an error is reported", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  await withFetch(
    (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ data: [] }));
    }) as typeof fetch,
    async () => {
      assert.deepEqual(await fetchModels(), []);
    },
  );
  assert.equal(seen?.url, "https://openrouter.ai/api/v1/models");
  assert.equal(seen?.init?.cache, "no-store", "never the browser's copy from an earlier visit");
  await withFetch((async () => new Response("busy", { status: 503 })) as typeof fetch, async () => {
    await assert.rejects(fetchModels(), /^OpenRouterError: OpenRouter answered with an error \(HTTP 503\)\.$/);
  });
});

test("streamChat reports a network failure with a useful hint", async () => {
  await withFetch(
    (async () => {
      throw new TypeError("Load failed");
    }) as typeof fetch,
    async () => {
      await assert.rejects(streamChat(req(() => {})), /Couldn't reach OpenRouter/);
    },
  );
});

test("streamChat passes on the request id and host as soon as they arrive, even if the reply then fails", async () => {
  await withFetch(
    (async () =>
      sseResponse([
        'data: {"id":"gen-7","provider":"Alibaba","choices":[{"delta":{"content":"Part"}}]}\n\n',
        'data: {"id":"gen-7","provider":"Alibaba","choices":[{"delta":{"content":" two"}}]}\n\n',
        'data: {"error":{"code":502,"message":"upstream returned 502"},"choices":[{"finish_reason":"error"}]}\n\n',
      ])) as typeof fetch,
    async () => {
      const metas: unknown[] = [];
      await assert.rejects(streamChat({ ...req(() => {}), onMeta: (m) => metas.push(m) }), /upstream returned 502/);
      assert.deepEqual(metas, [{ requestId: "gen-7", host: "Alibaba" }], "once, not with every piece");
    },
  );
  // Without a host in the stream: just the id.
  await withFetch(
    (async () => sseResponse(['data: {"id":"gen-8","choices":[{"delta":{"content":"Hi"}}]}\n\n', "data: [DONE]\n\n"])) as typeof fetch,
    async () => {
      const metas: unknown[] = [];
      await streamChat({ ...req(() => {}), onMeta: (m) => metas.push(m) });
      assert.deepEqual(metas, [{ requestId: "gen-8", host: undefined }]);
    },
  );
});

test("fetchHost: the host from OpenRouter's record of a request; null when it has none", async () => {
  const asked: { url: string; auth: string }[] = [];
  await withFetch(
    (async (url: string, init?: RequestInit) => {
      asked.push({ url, auth: String((init?.headers as Record<string, string>).Authorization) });
      if (url.endsWith("gen-1")) return new Response(JSON.stringify({ data: { id: "gen-1", provider_name: "DeepInfra" } }));
      return new Response(JSON.stringify({ error: { message: "Generation not found" } }), { status: 404 });
    }) as typeof fetch,
    async () => {
      assert.equal(await fetchHost("sk-test", "gen-1"), "DeepInfra");
      assert.equal(await fetchHost("sk-test", "gen-2"), null);
    },
  );
  assert.deepEqual(asked[0], { url: "https://openrouter.ai/api/v1/generation?id=gen-1", auth: "Bearer sk-test" });
});
