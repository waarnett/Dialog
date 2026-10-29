// Runs the built page (dist/index.html) in a simulated browser (jsdom) against a fake
// OpenRouter, clicking through a whole conversation: public turns, a private exchange,
// Stop, an error, saving as HTML (whole and single turn), copying a seat.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { IDBFactory } from "fake-indexeddb";

const html = readFileSync("dist/index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * A saved page as one line without the pretty-printer's layout, for looking for pieces of it:
 * the space between tags dropped, other runs of spaces and line breaks made one space.
 */
const squash = (html) => html.replace(/>\s+</g, "><").replace(/\s+/g, " ");
/** A saved page without the block of data for resuming it (which the browser neither shows nor runs). */
const readable = (html) => html.replace(/<script type="application\/json" id="dialog-conversation">[^<]*<\/script>/, "");

const MODELS = {
  data: [
    { id: "anthropic/claude-opus-5.5", name: "Anthropic: Claude Opus 5.5", pricing: { prompt: "0.000004", completion: "0.00002" }, context_length: 1000000, architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
      reasoning: { mandatory: true, supported_efforts: ["max", "xhigh", "high", "medium", "low"], default_effort: "high" }, supported_parameters: ["reasoning", "tools"] },
    { id: "x-ai/grok-4.7", name: "SpaceXAI: Grok 4.7", pricing: { prompt: "0.000002", completion: "0.000006" }, context_length: 500000, architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      reasoning: { mandatory: true, supported_efforts: ["xhigh", "high", "medium", "low"], default_effort: "high" }, supported_parameters: ["reasoning"] },
    { id: "x-ai/grok-4.7:batch", name: "batch variant", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["text"] } },
    { id: "some/image-model", name: "Image only", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["image"] } },
  ],
};

/**
 * `savedModels`: Dialog's saved copy of the model list ({ at, models }) to start with.
 * `models`: what the fake OpenRouter lists at first (MODELS unless given).
 * `state.models` is what the fake OpenRouter lists; with `state.modelsStatus` set, it fails instead.
 * `url`: the page's address. `tab`: what the tab's own storage holds to start with (key → value).
 * `idb`: the browser's database (a fake-indexeddb IDBFactory, shared by pages that share one); none if absent.
 */
function makeHarness({ savedModels, models = MODELS, url = "http://localhost/index.html", tab = {}, idb } = {}) {
  const chatCalls = [];
  const modelCalls = []; // the options of every request for the model list
  const state = { models, modelsStatus: 0, hosts: {} }; // hosts: OpenRouter's records, request id → host
  const replies = []; // queue of { wait, thinking, pieces, pauses, web, cost, status, slow, genId, provider }
  const hostCalls = []; // request ids looked up
  const blobs = [];
  const downloads = []; // file names the page asked the browser to save
  const authByUrl = {}; // which key was sent where
  const errors = [];

  function sse(reply, signal) {
    const enc = new TextEncoder();
    let i = 0;
    let j = 0;
    return new Response(
      new ReadableStream({
        start(controller) {
          signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
        async pull(controller) {
          // wait: ms before anything arrives; slow: never finishes; pause: just takes its time
          await sleep(reply.wait && i === 0 && j === 0 ? reply.wait : reply.slow || reply.pause ? 40 : 2);
          if (signal?.aborted) return;
          // Thinking first, as OpenRouter sends it: the same text in two fields.
          if (j < (reply.thinking?.length ?? 0)) {
            const t = reply.thinking[j++];
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "", reasoning: t, reasoning_details: [{ type: "reasoning.text", text: t }] } }] })}\n\n`));
            return;
          }
          if (i < reply.pieces.length) {
            // pauses: pieces (by index) preceded by a quiet spell, as while a model searches
            if (reply.pauses?.includes(i)) controller.enqueue(enc.encode(": OPENROUTER PROCESSING\n\n: OPENROUTER PROCESSING\n\n"));
            const meta = { ...(reply.genId ? { id: reply.genId } : {}), ...(reply.provider ? { provider: reply.provider } : {}) };
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ ...meta, choices: [{ delta: { content: reply.pieces[i++] } }] })}\n\n`));
            return;
          }
          if (reply.slow) return; // never finishes on its own; waits for Stop
          controller.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ model: "resolved/model", choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 10, reasoning_tokens: 4, cost: reply.cost, ...(reply.web ? { server_tool_use_details: reply.web } : {}) } })}\n\ndata: [DONE]\n\n`,
            ),
          );
          controller.close();
        },
      }),
      { status: 200 },
    );
  }

  async function fakeFetch(url, init = {}) {
    if (url.endsWith("/models")) {
      modelCalls.push(init);
      if (state.modelsStatus) return new Response("busy", { status: state.modelsStatus });
      return new Response(JSON.stringify(state.models));
    }
    if (url.includes("/generation?id=")) {
      const id = decodeURIComponent(url.split("id=")[1]);
      hostCalls.push({ id, auth: init.headers?.Authorization });
      const host = state.hosts[id];
      await sleep(10);
      return host ? new Response(JSON.stringify({ data: { id, provider_name: host } })) : new Response("{}", { status: 404 });
    }
    if (url.endsWith("/key")) {
      authByUrl.key = init.headers?.Authorization;
      return new Response(JSON.stringify({ data: { usage: 1.5, usage_monthly: 1.25, limit: 20, limit_remaining: 18.5, limit_reset: null } }));
    }
    if (url.endsWith("/credits")) {
      authByUrl.credits = init.headers?.Authorization;
      if (init.headers?.Authorization !== "Bearer mk-good") {
        return new Response(JSON.stringify({ error: { message: "Only management keys can perform this operation" } }), { status: 403 });
      }
      return new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 4.24 } }));
    }
    if (url.endsWith("/chat/completions")) {
      chatCalls.push(JSON.parse(init.body));
      const reply = replies.shift();
      if (!reply) throw new Error("test: no reply queued");
      if (reply.status) return new Response(JSON.stringify({ id: reply.id, error: reply.error ?? { message: reply.message } }), { status: reply.status });
      return sse(reply, init.signal);
    }
    throw new Error("unexpected URL " + url);
  }

  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (!/Not implemented/.test(String(e.message))) errors.push(e);
  });
  vc.on("error", (e) => errors.push(e));

  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = fakeFetch;
      window.TextDecoder = TextDecoder;
      if (idb) window.indexedDB = idb;
      window.confirm = () => true;
      window.alert = (m) => errors.push(new Error("unexpected alert: " + m));
      window.URL.createObjectURL = (b) => {
        blobs.push(b);
        return "blob:test";
      };
      window.URL.revokeObjectURL = () => {};
      const click = window.HTMLAnchorElement.prototype.click;
      window.HTMLAnchorElement.prototype.click = function () {
        if (this.download) downloads.push(this.download);
        else click.call(this);
      };
      window.localStorage.setItem(
        "dialog.settings.v1",
        JSON.stringify({
          apiKey: "sk-test",
          humanName: "Bill",
          seats: [
            { id: "A", name: "Claude", model: "anthropic/claude-opus-5.5", role: "Be brief.", effort: "default", color: "#c96442" },
            { id: "B", name: "Grok", model: "x-ai/grok-4.7", role: "", effort: "low", color: "#6b7280" },
          ],
        }),
      );
      if (savedModels) window.localStorage.setItem("dialog.models.v6", JSON.stringify(savedModels));
      for (const [k, v] of Object.entries(tab)) window.sessionStorage.setItem(k, v);
    },
  });
  return { dom, w: dom.window, d: dom.window.document, chatCalls, modelCalls, state, replies, blobs, downloads, authByUrl, errors, hostCalls };
}

async function until(cond, what, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(5);
  }
}

test("a full conversation in the page", async () => {
  const { w, d, chatCalls, replies, blobs, downloads, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const notBusy = () => !$("#transcript .entry.streaming");
  const seatCards = () => $$("#seat-list .seat");
  const speakBtn = (i) => seatCards()[i].querySelector("button.speak");
  const type = (text) => {
    $("#composer-text").value = text;
  };
  const setTo = (value) => {
    $("#composer-to").value = value;
    $("#composer-to").dispatchEvent(new w.Event("change"));
  };

  // Initial state
  assert.equal($("#banner").hidden, true, "no banner when a key is set");
  assert.equal(seatCards().length, 2);
  assert.deepEqual($$("#composer-to option").map((o) => o.textContent), ["Everyone", "Privately: Claude", "Privately: Grok"]);
  assert.ok($("#transcript .empty"), "empty-state help shown");
  assert.equal($$("#transcript .empty li").length, 7, "no 'set your key' step when the key is set");
  assert.match($("#transcript .empty").textContent, /house rules.*edit them in Settings/);
  assert.ok(!$("#transcript .empty").textContent.includes("OpenRouter API key"));
  assert.ok($("#transcript .empty .bust img").src.startsWith("data:image/png;base64,"), "welcome engraving embedded");
  assert.match($("#transcript .empty figcaption").textContent, /W.\u00a0Meyer/);
  assert.ok($(".topbar .medallion").src.startsWith("data:image/png;base64,"), "logo embedded");
  assert.ok(d.querySelector('link[rel="icon"]').href.startsWith("data:image/png;base64,"), "tab icon embedded");

  const info = (i) => seatCards()[i].querySelector(".seat-model-info").textContent;
  const modelButton = (i) => seatCards()[i].querySelector(".model-button");
  const thinking = (i) => seatCards()[i].querySelector('select[aria-label="Thinking level"]');
  await until(() => /\$4 in, \$20 out/.test(info(0)), "model list");
  assert.equal(modelButton(0).querySelector(".model-name").textContent, "Anthropic: Claude Opus 5.5");
  assert.deepEqual([...thinking(0).options].map((o) => o.textContent), ["max", "xhigh", "high (default)", "medium", "low"]);
  assert.equal(thinking(0).value, "default");
  assert.deepEqual([...thinking(1).options].map((o) => o.textContent), ["xhigh", "high (default)", "medium", "low"]);
  assert.equal(thinking(1).value, "low");
  await until(() => $("#key-info").textContent.includes("This month"), "key info");
  assert.equal($("#key-info").textContent, "This month: $1.25");
  assert.match($("#key-info").title, /All time: \$1\.50\. Its limit is \$20\.00, never resetting, with \$18\.50 of it unused\. A limit is a cap, not money/);
  assert.equal($("#credit-info").textContent, "", "no credit shown without a management key");

  // 1. Bill adds a public message; nobody answers yet.
  type("What is time?");
  $("#composer-send").click();
  assert.equal(entries().length, 1);
  assert.equal(chatCalls.length, 0);
  assert.equal($("#composer-text").value, "");

  // 2. Claude speaks.
  replies.push({ thinking: ["Pondering **chronology** ", "at length."], pieces: ["Claude says: ", "Time is ", "change."], cost: 0.01 });
  speakBtn(0).click();
  await until(() => entries().length === 2 && notBusy(), "Claude's reply");
  const c1 = chatCalls[0];
  assert.equal(c1.model, "anthropic/claude-opus-5.5");
  assert.deepEqual(c1.messages.map((m) => m.role), ["system", "user"]);
  assert.equal(c1.messages[1].content, "Bill says:\nWhat is time?");
  assert.match(c1.messages[0].content, /Your role in this conversation:\nBe brief\./);
  assert.equal(c1.tools.length, 2, "Claude can search the web and read pages");
  assert.deepEqual(c1.cache_control, { type: "ephemeral", ttl: "1h" }, "Claude asked to cache");
  assert.equal(c1.session_id, "dialog-A", "per-seat session label");
  assert.equal(c1.reasoning, undefined, "default thinking sends no reasoning setting");
  assert.equal(entries()[1].querySelector(".body").textContent.trim(), "Time is change.", "self-label stripped");
  // The thinking: folded up above the reply until opened.
  const thinkingBox = () => entries()[1].querySelector("details.thinking");
  assert.equal(thinkingBox().nextElementSibling, entries()[1].querySelector(".body"), "just above the reply");
  assert.equal(thinkingBox().querySelector("summary").textContent, "Thinking");
  assert.equal(thinkingBox().open, false, "folded up at first");
  assert.equal(thinkingBox().querySelector(".thought").innerHTML, "");
  thinkingBox().open = true;
  thinkingBox().dispatchEvent(new w.Event("toggle"));
  assert.equal(thinkingBox().querySelector(".thought").innerHTML.trim(), "<p>Pondering <strong>chronology</strong> at length.</p>", "read once, though sent twice");
  assert.equal(entries()[0].querySelector("details.thinking"), null, "none on Bill's turns");
  const head = entries()[1].querySelector("header");
  assert.equal(head.firstElementChild.className, "stamp", "tick box and time come first");
  assert.equal(head.querySelector(".stamp .time").textContent.length, 5);
  assert.equal(head.children[1].textContent, "Claude");
  assert.ok(!head.textContent.includes("anthropic/"), "model name not repeated in the header");
  // Cost and speed are two lines in the margin, under the name; nothing comes after the text.
  const glance = () => entries()[1].querySelector("header .glance");
  assert.equal(head.lastElementChild, glance(), "cost and speed come last in the margin");
  assert.equal(glance().querySelector(".cost").textContent, "$0.0100");
  assert.match(glance().querySelector(".speed").textContent, /^\d[\d,]* tokens\/s$/, "speed shown in the margin");
  assert.equal(entries()[1].querySelector(".foot"), null, "nothing below the text");
  // Tapping them shows the full particulars below the text (no hovering needed); tapping again hides them.
  const foot = () => entries()[1].querySelector(".foot");
  assert.equal(glance().tagName, "BUTTON");
  assert.equal(glance().getAttribute("aria-expanded"), "false");
  assert.equal(glance().querySelector(".cost").title, "", "nothing hidden in a hover");
  glance().click();
  assert.equal(foot().className, "foot open");
  assert.equal(entries()[1].lastElementChild, foot(), "the particulars come after the text");
  assert.equal(glance().getAttribute("aria-expanded"), "true");
  assert.equal(d.activeElement, glance(), "the keyboard stays on it");
  const lines = [...foot().querySelectorAll(".detail")].map((x) => x.textContent);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "Model: resolved/model (for anthropic/claude-opus-5.5); thinking: high (default).");
  // The cost table, priced at the model asked for (the one that answered isn't listed).
  assert.deepEqual(
    [...foot().querySelectorAll(".costs > span")].map((x) => x.textContent),
    ["Reading", "50 tokens", "", "about", "$0.00", "Writing", "10 tokens", "(4 of them thinking)", "about", "$0.00", "Total", "", "", "", "$0.01"],
  );
  assert.equal(foot().children[1].className, "costs", "between the model and the speed");
  assert.match(lines[1], /^Speed: 10 tokens written \(4 of them thinking\) in \d+\.\d s from pressing Speak to the last word: [\d,]+ tokens per second overall\. The first words appeared after \d+\.\d s/);
  assert.equal(glance().querySelector(".cost").textContent, "$0.0100", "the margin keeps its two lines");
  foot().click();
  assert.equal(foot(), null, "tapping the particulars hides them");
  assert.equal(glance().getAttribute("aria-expanded"), "false");
  assert.equal(entries()[0].querySelector(".glance"), null, "no cost or speed on Bill's turns");
  assert.match($("#session-cost").textContent, /\$0\.0100/);

  // 3. Private exchange with Grok.
  setTo("B");
  assert.match($("#composer-send").textContent, /Send privately to Grok/);
  replies.push({ pieces: ["Understood."], cost: 0.002 });
  type("Be contrarian.");
  $("#composer-send").click();
  await until(() => entries().length === 4 && notBusy(), "Grok's private reply");
  const c2 = chatCalls[1];
  assert.equal(c2.tools, undefined, "this Grok can't use tools (in this test's model list)");
  assert.equal(c2.cache_control, undefined, "Grok caches automatically; not asked");
  assert.equal(c2.session_id, "dialog-B");
  assert.deepEqual(c2.reasoning, { effort: "low" });
  assert.match(c2.messages.at(-1).content, /Bill says \(privately, only you can see this\):\nBe contrarian\./);
  assert.ok(entries()[2].classList.contains("private") && entries()[3].classList.contains("private"));
  assert.equal(entries()[2].querySelector(".direction").textContent, "(privately, to Grok)");
  assert.equal(entries()[3].querySelector(".direction").textContent, "(privately, to Bill)");
  assert.equal(entries()[1].querySelector(".direction"), null, "public turns have no stage direction");

  // 4. Back to everyone: typing then pressing Speak adds the text first.
  setTo("");
  type("Grok, your view?");
  replies.push({ pieces: ["Time is an illusion."], cost: 0.003 });
  speakBtn(1).click();
  await until(() => entries().length === 6 && notBusy(), "Grok's public reply");
  const grokView = chatCalls[2].messages.map((m) => m.content).join("\n");
  assert.ok(grokView.includes("Be contrarian."), "Grok remembers its private instruction");
  assert.ok(grokView.includes("Claude says:\nTime is change."));

  // 5. Claude speaks again and must not see the private exchange.
  replies.push({ pieces: ["Illusions take time."], cost: 0.004 });
  speakBtn(0).click();
  await until(() => entries().length === 7 && notBusy(), "Claude's second reply");
  const claudeView = chatCalls[3].messages;
  const claudeText = claudeView.map((m) => m.content).join("\n");
  assert.ok(!claudeText.includes("Be contrarian") && !claudeText.includes("Understood."), "private exchange hidden");
  assert.ok(claudeText.includes("Grok says:\nTime is an illusion."));
  assert.deepEqual(claudeView.map((m) => m.role), ["system", "user", "assistant", "user"]);

  // 6. Stop a slow reply partway. On the way: waiting, then thinking, then the reply.
  replies.push({ wait: 1800, thinking: ["Weighing it."], pieces: ["Partial ", "thought"], slow: true });
  speakBtn(1).click();
  const last = () => entries().at(-1);
  assert.equal(last().querySelector(".waiting").textContent, "waiting for Grok…", "nothing has arrived yet");
  await until(() => last().querySelector(".waiting")?.textContent === "waiting for Grok… 1 s", "the time waited", 2000);
  assert.equal(last().querySelector("details.thinking"), null);
  await until(() => last().querySelector("details.thinking"), "the thinking");
  assert.equal(last().querySelector("summary").textContent, "Thinking…", "still thinking");
  assert.equal(last().querySelector(".waiting"), null, "no longer waiting");
  await until(() => last().textContent.includes("Partial"), "first piece");
  assert.equal(last().querySelector("summary").textContent, "Thinking", "thinking done once the reply begins");
  const stopBtn = seatCards()[1].querySelector("button.danger:not([aria-label])");
  assert.equal(stopBtn.textContent, "Stop");
  assert.equal(speakBtn(0).disabled, true, "others can't speak meanwhile");
  stopBtn.click();
  await until(() => notBusy(), "stop");
  assert.match(entries().at(-1).querySelector(".foot").textContent, /stopped early/);
  assert.equal(speakBtn(0).disabled, false);

  // 7. An error (out of credit) is shown and never fed to anyone.
  replies.push({ status: 402, message: "Insufficient credits" });
  speakBtn(0).click();
  await until(() => entries().at(-1).classList.contains("error"), "error entry");
  assert.match(entries().at(-1).querySelector(".err").textContent, /Not enough OpenRouter credit/);
  entries().at(-1).querySelector("button.del").click();
  assert.ok(!entries().at(-1).classList.contains("error"), "error entry removed");

  // 8. Save All: the whole conversation.
  assert.equal($("#btn-save").textContent, "Save All");
  $("#btn-save").click();
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].type, "text/html;charset=utf-8");
  assert.match(downloads[0], /^Dialog \d{4} \w{3} \d\d \d{4}\.html$/);
  const raw = await blobs[0].text();
  assert.ok(raw.startsWith("<!doctype html>"));
  assert.match(raw, /\n {8}<article class="turn human">\n/, "pretty-printed: one tag per line, indented");
  const html = squash(raw);
  assert.ok(html.includes('<span class="direction">(privately, to Grok)</span>'));
  assert.ok(html.includes('<span class="direction">(privately, to Bill)</span>'));
  assert.ok(html.includes("<p>Time is change.</p>"), "replies rendered from Markdown");
  assert.ok(html.includes("stopped early"));
  assert.ok(html.includes("Total reported cost: $0.0190"));
  assert.ok(html.includes('class="medallion" src="data:image/png;base64,'), "the medallion travels with the file");
  assert.ok(html.includes('<script type="application/json" id="dialog-conversation">'), "the data to resume it");
  assert.ok(!/<script/i.test(readable(html)), "and no other script");
  assert.ok(!raw.includes("chronology"), "thinking is never saved");

  // 8b. Tick turns to save just those.
  assert.equal($$(".entry .foot button").length, 0, "no per-turn save buttons any more");
  const picks = () => $$(".entry input.pick");
  assert.equal(picks().length, entries().length, "a tick box on every turn, Bill's included");
  const tick = (i, on) => {
    const box = entries()[i].querySelector("input.pick");
    box.checked = on;
    box.dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  tick(1, true);
  assert.equal($("#btn-save").textContent, "Save Selected");
  assert.match($("#btn-save").title, /Save the ticked turn as an HTML file/);
  $("#btn-save").click();
  assert.match(downloads[1], /^Dialog \d{4} \w{3} \d\d \d{4} selected\.html$/);
  const one = squash(await blobs[1].text());
  assert.ok(one.includes("<p>Time is change.</p>"));
  assert.ok(!one.includes("What is time?"), "only the ticked turn");
  assert.ok(one.includes('<span class="name">Claude</span>') && !one.includes('<span class="name">Grok</span>'), "only its speaker");
  assert.ok(one.includes("1 turn chosen from a conversation"));
  // Ticks survive the transcript being redrawn (here, by another reply).
  replies.push({ pieces: ["Agreed."], cost: 0.001 });
  speakBtn(1).click();
  await until(() => notBusy() && entries().at(-1).textContent.includes("Agreed."), "Grok agrees");
  assert.equal(entries()[1].querySelector("input.pick").checked, true, "ticks survive a redraw");
  assert.equal($("#btn-save").textContent, "Save Selected");
  tick(1, false);
  assert.equal($("#btn-save").textContent, "Save All");
  // 9. The session is persisted.
  const saved = JSON.parse(w.sessionStorage.getItem("dialog.session.v1"));
  assert.equal(saved.entries.length, entries().length);
  assert.ok(!w.sessionStorage.getItem("dialog.session.v1").includes("chronology"), "nor stored in the browser");
  assert.equal(thinkingBox().open, true, "open thinking stays open when the transcript is redrawn");

  // 10. Copy a seat.
  seatCards()[0].querySelector(".seat-head button").click();
  assert.equal(seatCards().length, 3);
  assert.equal(seatCards()[1].querySelector(".seat-head input").value, "Claude 2");
  assert.ok($$("#composer-to option").some((o) => o.textContent === "Privately: Claude 2"));

  // 11. The model picker: search, choose with Return; thinking menu follows the model.
  const press = (key) => $("#model-search").dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true }));
  const search = (text) => {
    $("#model-search").value = text;
    $("#model-search").dispatchEvent(new w.Event("input"));
  };
  modelButton(0).click();
  assert.ok($("#model-dialog").open, "picker open");
  assert.equal($("#model-title").textContent, "Choose a model for Claude");
  assert.equal($$("#model-results .model-row").length, 2);
  assert.ok($("#model-results .model-row.current").textContent.includes("Claude Opus 5.5"));
  search("grok");
  assert.equal($$("#model-results .model-row").length, 1);
  press("Enter");
  assert.ok(!$("#model-dialog").open, "picker closed after choosing");
  assert.equal(modelButton(0).querySelector(".model-name").textContent, "SpaceXAI: Grok 4.7");
  assert.deepEqual([...thinking(0).options].map((o) => o.textContent), ["xhigh", "high (default)", "medium", "low"]);

  // A level the new model lacks falls back to its default.
  modelButton(0).click();
  search("opus");
  press("Enter");
  thinking(0).value = "max";
  thinking(0).dispatchEvent(new w.Event("change"));
  modelButton(0).click();
  search("grok 4.7");
  press("Enter");
  assert.equal(thinking(0).value, "default", "max isn't a Grok level");

  // An id typed in full can be used even if it isn't listed.
  modelButton(0).click();
  search("brand-new/model-x");
  assert.match($("#model-results .model-row").textContent, /Use “brand-new\/model-x” as typed/);
  press("Enter");
  assert.match(info(0), /brand-new\/model-x is not in OpenRouter’s current list/);
  assert.equal(thinking(0).disabled, true);

  // Arrow keys move the highlight.
  modelButton(0).click();
  search("");
  assert.ok($$("#model-results .model-row")[0].classList.contains("active"));
  press("ArrowDown");
  assert.ok($$("#model-results .model-row")[1].classList.contains("active"));
  $("#model-cancel").click();
  assert.ok(!$("#model-dialog").open);

  // 12. Settings dialog opens and closes without trouble.
  $("#btn-settings").click();
  assert.equal($("#set-key").value, "sk-test");
  $("#settings-dialog").close?.();

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("first run: no key, no seats; adding seats names them after their models", async () => {
  const { chatCalls } = makeHarness();
  const fresh = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/first-run.html",
    beforeParse(win) {
      win.fetch = async (url) => (url.endsWith("/models") ? new Response(JSON.stringify(MODELS)) : new Response("{}", { status: 500 }));
      win.TextDecoder = TextDecoder;
      win.localStorage.clear();
    },
  });
  const fw = fresh.window;
  const fd = fw.document;
  const $ = (sel) => fd.querySelector(sel);
  const $$ = (sel) => [...fd.querySelectorAll(sel)];
  const seats = () => $$("#seat-list .seat");

  // Nothing set up yet.
  assert.equal($("#banner").hidden, false);
  assert.match($("#banner").textContent, /Add your OpenRouter API key/);
  assert.equal(seats().length, 0, "no seats on first run");
  assert.match($("#seat-list .seats-empty").textContent, /No participants yet\. Press \+ Add a seat/);
  assert.ok($("#btn-add-seat").classList.contains("primary"), "Add a seat stands out while there are none");
  const steps = $$("#transcript .empty li").map((li) => li.textContent);
  assert.match(steps[0], /paste your OpenRouter API key/);
  assert.match(steps[1], /^Add participants: press \+ Add a seat/);
  assert.deepEqual($$("#composer-to option").map((o) => o.textContent), ["Everyone"]);
  await new Promise((r) => setTimeout(r, 20)); // model list arrives

  // + Add a seat opens the model picker; the seat takes the model's name and color.
  const pick = (query) => {
    $("#model-search").value = query;
    $("#model-search").dispatchEvent(new fw.Event("input"));
    $("#model-search").dispatchEvent(new fw.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  };
  $("#btn-add-seat").click();
  assert.ok($("#model-dialog").open, "picker opens straight away");
  assert.equal($("#model-title").textContent, "Choose a model for New seat");
  pick("opus");
  assert.equal(seats().length, 1);
  assert.equal(seats()[0].querySelector(".seat-head input").value, "Claude");
  assert.match(seats()[0].getAttribute("style"), /#c96442/);
  assert.ok(!$("#btn-add-seat").classList.contains("primary"));
  assert.equal($("#seat-list .seats-empty"), null);
  assert.ok(!$$("#transcript .empty li").some((li) => /Add participants/.test(li.textContent)), "welcome note goes once a seat exists");

  $("#btn-add-seat").click();
  pick("opus");
  $("#btn-add-seat").click();
  pick("grok");
  assert.deepEqual(seats().map((c) => c.querySelector(".seat-head input").value), ["Claude", "Claude 2", "Grok"]);
  assert.deepEqual($$("#composer-to option").map((o) => o.textContent), ["Everyone", "Privately: Claude", "Privately: Claude 2", "Privately: Grok"]);

  // A seat you've already named keeps its name when you change its model.
  seats()[1].querySelector(".seat-head input").value = "Skeptic";
  seats()[1].querySelector(".seat-head input").dispatchEvent(new fw.Event("input"));
  seats()[1].querySelector(".model-button").click();
  pick("grok");
  assert.equal(seats()[1].querySelector(".seat-head input").value, "Skeptic");
  assert.equal(seats()[1].querySelector(".seat-head .name-fit").dataset.text, "Skeptic", "the name box fits the new name");

  // Cancelling the picker leaves an unnamed seat to finish later.
  $("#btn-add-seat").click();
  $("#model-cancel").click();
  assert.equal(seats()[3].querySelector(".seat-head input").value, "New seat");

  // Without a key, Speak asks for one instead of calling OpenRouter; the name starts as John Doe.
  seats()[0].querySelector("button.speak").click();
  assert.equal(chatCalls.length, 0);
  assert.ok($("#settings-dialog").open, "settings opened to ask for the key");
  assert.equal($("#set-name").value, "John Doe");
});

test("About you, and attaching files by drag and drop", async () => {
  const { w, d, chatCalls, replies, blobs, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const notBusy = () => !$("#transcript .entry.streaming");
  const speakBtn = (i) => $$("#seat-list .seat")[i].querySelector("button.speak");
  await until(() => $$("#seat-list .seat .seat-model-info .id").length === 2, "model list");

  // About you: typed in Settings, reaches every seat's instructions.
  $("#btn-settings").click();
  $("#set-about").value = "Retired engineer; fond of astronomy.";
  $("#set-about").dispatchEvent(new w.Event("input"));
  $("#settings-dialog").close?.();

  // Drop two files (text and PDF) plus one we can't read onto the conversation.
  const drop = (files) => {
    const zone = $("#conversation");
    const dt = { types: ["Files"], files, dropEffect: "none" };
    for (const type of ["dragenter", "dragover"]) {
      const ev = new w.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: dt });
      zone.dispatchEvent(ev);
    }
    assert.ok(zone.classList.contains("dropping"), "drop overlay shown while dragging");
    const ev = new w.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: dt });
    zone.dispatchEvent(ev);
    assert.ok(!zone.classList.contains("dropping"));
  };
  const notes = new w.File(["# Orbits\nKepler was right."], "orbits.md", { type: "text/markdown" });
  const paper = new w.File(["%PDF-1.4 fake"], "paper.pdf", { type: "application/pdf" });
  const word = new w.File(["PK..."], "draft.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  drop([notes, paper, word]);
  await until(() => $$("#attach-tray .chip").length === 2, "two files waiting in the tray");
  assert.match($("#attach-tray").textContent, /orbits\.md \(text, 26 bytes, about 7 tokens\)/);
  assert.match($("#attach-tray").textContent, /paper\.pdf \(PDF, 13 bytes\)/);
  assert.match($("#attach-status").textContent, /can't read \.docx files\. Export draft\.docx as a PDF/);

  // Remove the PDF from the tray, then send the rest with a message.
  $$("#attach-tray .chip")[1].querySelector(".chip-x").click();
  assert.equal($$("#attach-tray .chip").length, 1);
  drop([paper]);
  await until(() => $$("#attach-tray .chip").length === 2, "PDF back in the tray");
  $("#composer-text").value = "Here are my notes and the paper.";
  $("#composer-send").click();
  assert.equal($("#attach-tray").hidden, true, "tray emptied once sent");
  assert.equal(entries().length, 1);
  assert.equal(entries()[0].querySelectorAll(".files .file").length, 2);

  // Storage: file contents in their own slots, not in the saved conversation.
  const saved = w.sessionStorage.getItem("dialog.session.v1");
  assert.ok(!saved.includes("Kepler was right"), "contents not in the conversation record");
  const fileKeys = Object.keys(w.sessionStorage).filter((k) => k.startsWith("dialog.file."));
  assert.equal(fileKeys.length, 2);

  // Claude (reads PDFs natively): parts include the text file inline and the PDF as a file; About-you in instructions.
  replies.push({ pieces: ["Read them."], cost: 0.01 });
  speakBtn(0).click();
  await until(() => entries().length === 2 && notBusy(), "Claude's reply");
  const c1 = chatCalls[0];
  assert.match(c1.messages[0].content, /About Bill, in Bill's own words:\nRetired engineer; fond of astronomy\./);
  const parts = c1.messages[1].content;
  assert.deepEqual(parts.map((p) => p.type), ["text", "file"]);
  assert.ok(parts[0].text.includes('<file name="orbits.md">\n# Orbits\nKepler was right.\n</file>'));
  assert.equal(parts[1].file.filename, "paper.pdf");
  assert.ok(parts[1].file.file_data.startsWith("data:application/pdf;base64,"));
  assert.equal(c1.plugins, undefined, "Claude reads PDFs itself: no converter");

  // Grok (text only in this test's list): the free PDF converter is requested.
  replies.push({ pieces: ["Kepler, indeed."], cost: 0.002 });
  speakBtn(1).click();
  await until(() => entries().length === 3 && notBusy(), "Grok's reply");
  assert.deepEqual(chatCalls[1].plugins, [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]);

  // A file sent on its own (no text) via the Speak button.
  drop([new w.File(["a,b\n1,2"], "data.csv", { type: "text/csv" })]);
  await until(() => $$("#attach-tray .chip").length === 1, "csv waiting");
  replies.push({ pieces: ["A tiny table."], cost: 0.001 });
  speakBtn(1).click();
  await until(() => entries().length === 5 && notBusy(), "file-only entry then Grok's reply");
  assert.equal(entries()[3].querySelector(".body").hidden, true, "no empty text box for a file-only entry");
  assert.match(JSON.stringify(chatCalls[2].messages), /Bill shares a file:/);

  // Saved HTML: thinking levels, About-you, attached files.
  $("#btn-save").click();
  const exported = squash(await blobs[0].text());
  assert.ok(exported.includes("<blockquote><p>Retired engineer; fond of astronomy.</p>"));
  assert.ok(exported.includes("thinking: high (default)"));
  assert.ok(exported.includes("<summary>orbits.md (text, 26 bytes, about 7 tokens)</summary><pre># Orbits Kepler was right.</pre>"));
  assert.ok(exported.includes('<p class="file">paper.pdf (PDF, 13 bytes)</p>'));

  // A failed reply shows the host's details and can be tried again in place.
  replies.push({ status: 500, id: "gen-77", error: { code: 500, message: "Internal Server Error", metadata: { provider_name: "Google AI Studio", raw: "image decode failed" } } });
  speakBtn(0).click();
  await until(() => entries().at(-1).classList.contains("error"), "error entry");
  const errText = entries().at(-1).querySelector(".err").textContent;
  assert.match(errText, /host: Google AI Studio; code: 500; host said: image decode failed; request gen-77/);
  const before = entries().length;
  $("#composer-text").value = "draft not to be sent";
  replies.push({ pieces: ["Second time lucky."], cost: 0.001 });
  entries().at(-1).querySelector("button.retry").click();
  await until(() => notBusy() && !entries().at(-1).classList.contains("error"), "retry succeeded");
  assert.equal(entries().length, before, "the failed reply was replaced, not added to");
  assert.equal(entries().at(-1).querySelector(".body").textContent.trim(), "Second time lucky.");
  assert.equal($("#composer-text").value, "draft not to be sent", "Try again leaves the input box alone");

  // Removing the entry frees its stored files.
  w.confirm = () => true;
  entries()[0].querySelector("button.del").click();
  assert.equal(Object.keys(w.sessionStorage).filter((k) => k.startsWith("dialog.file.")).length, 1, "only data.csv remains");

  await sleep(20);
  assert.deepEqual(errors.map(String), []);
});

test("a management key shows the account's remaining credit, and is sent nowhere else", async () => {
  const { w, d, authByUrl, chatCalls, replies } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  await until(() => $("#key-info").textContent.includes("This month"), "key info");

  $("#btn-settings").click();
  $("#set-mkey").value = "mk-good";
  $("#set-mkey").dispatchEvent(new w.Event("input"));
  $("#settings-dialog").close?.();
  $("#settings-dialog").dispatchEvent(new w.Event("close"));
  await until(() => $("#credit-info").textContent.startsWith("Credit left"), "credit shown");
  assert.equal($("#credit-info").textContent, "Credit left: $5.76");
  assert.equal(
    $("#credit-info").title,
    "Your OpenRouter account: $10.00 of credit bought, $4.24 used (by all your keys), $5.76 left. Click to add credit on OpenRouter's Credits page.",
  );
  const link = $("#credit-info a");
  assert.equal(link.href, "https://openrouter.ai/settings/credits", "a link to OpenRouter's Credits page");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  assert.equal(authByUrl.credits, "Bearer mk-good");
  assert.equal(authByUrl.key, "Bearer sk-test", "the ordinary key is still used for its own spending");

  replies.push({ pieces: ["Hi."], cost: 0.001 });
  d.querySelector("#seat-list .seat button.speak").click();
  await until(() => chatCalls.length === 1, "a reply requested");
  assert.ok(!JSON.stringify(chatCalls[0]).includes("mk-good"), "management key never goes to the models");

  // A wrong or expired management key is reported plainly.
  $("#btn-settings").click();
  $("#set-mkey").value = "mk-bad";
  $("#set-mkey").dispatchEvent(new w.Event("input"));
  $("#settings-dialog").close?.();
  $("#settings-dialog").dispatchEvent(new w.Event("close"));
  await until(() => $("#credit-info").textContent === "Credit: couldn't check", "error shown");
  assert.match($("#credit-info").title, /didn't accept the management key/);
});

test("the send keys hand the turn to the previous speaker; tools; a withdrawn model; Settings closes from outside", async () => {
  const { w, d, chatCalls, replies, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const notBusy = () => $$(".seat .speak").every((b) => !b.disabled && !b.hidden);
  const speakBtn = (i) => $$(".seat .speak")[i];
  const hint = () => $("#composer-hint").textContent;
  const type = (t) => ($("#composer-text").value = t);
  const sendKeys = () => $("#composer-text").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const sendTo = (id) => {
    $("#composer-to").value = id;
    $("#composer-to").dispatchEvent(new w.Event("change"));
  };
  await until(() => $$(".seat").length === 2, "seats");

  // Nobody has spoken yet: Return just adds. (Not a Mac here, so the note says Enter.)
  assert.equal(hint(), "Enter adds");
  type("Opening remark.");
  sendKeys();
  assert.equal(entries().length, 1);
  assert.equal(chatCalls.length, 0, "no one asked");

  // Grok speaks; from then on the keys add what you typed and ask Grok again.
  replies.push({ pieces: ["Grok here."], cost: 0.001 });
  speakBtn(1).click();
  await until(() => notBusy() && entries().length === 2, "Grok");
  assert.equal(hint(), "Enter adds, then Grok replies · Ctrl+Enter just adds");
  assert.equal($("#composer-hint b").getAttribute("style"), "--seat-color: #6b7280");
  type("Say more.");
  replies.push({ pieces: ["More from Grok."], cost: 0.001 });
  sendKeys();
  await until(() => notBusy() && entries().length === 4, "Bill, then Grok");
  assert.equal(entries()[2].querySelector(".body").textContent.trim(), "Say more.");
  assert.equal(chatCalls.at(-1).session_id, "dialog-B", "Grok was asked");
  assert.equal($("#composer-text").value, "");

  // An empty box: nothing happens (no surprise replies).
  sendKeys();
  await sleep(20);
  assert.equal(entries().length, 4);
  assert.equal(chatCalls.length, 2);

  // Privately: the keys send and that participant replies. A private aside doesn't change
  // who is next in the open conversation.
  sendTo("A");
  assert.equal(hint(), "Enter sends; Claude replies");
  type("Just between us.");
  replies.push({ pieces: ["Noted."], cost: 0.001 });
  sendKeys();
  await until(() => notBusy() && entries().length === 6, "private exchange");
  sendTo("");
  assert.equal(hint(), "Enter adds, then Grok replies · Ctrl+Enter just adds");
  // Renaming the seat renames it in the note.
  const grokName = $$(".seat .seat-head input")[1];
  grokName.value = "Grok the Skeptic";
  grokName.dispatchEvent(new w.Event("input"));
  assert.equal(hint(), "Enter adds, then Grok the Skeptic replies · Ctrl+Enter just adds");

  // Web search and page reading: no settings; offered to every model that can use tools.
  assert.ok(!$("#set-searches") && !$(".seat input.searches"), "no web-search settings anywhere");
  assert.deepEqual(
    chatCalls[2].tools,
    [{ type: "openrouter:web_search", parameters: { max_uses: 10 } }, { type: "openrouter:web_fetch" }],
    "Claude can search (up to 10 times) and read pages",
  );
  assert.equal(chatCalls[1].tools, undefined, "Grok's model can't use tools");
  const modelInfoText = (i) => $$(".seat .seat-model-info")[i].textContent;
  assert.match(modelInfoText(1), /Can't use tools, so no web search or page reading/);
  assert.doesNotMatch(modelInfoText(0), /Can't use tools/);

  // Hovering over a participant's name shows the model and the thinking level.
  assert.equal(entries()[1].querySelector(".who").title, "resolved/model, thinking: low");

  // A model OpenRouter no longer lists: the failure says so, and what to do.
  $$(".seat .model-button")[1].click();
  $("#model-search").value = "gone/model";
  $("#model-search").dispatchEvent(new w.Event("input"));
  $("#model-search").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.match(modelInfoText(1), /gone\/model is not in OpenRouter’s current list/);
  replies.push({ status: 404, message: "No endpoints found for gone/model." });
  speakBtn(1).click();
  await until(() => notBusy() && entries().at(-1).classList.contains("error"), "failed reply");
  assert.match(
    entries().at(-1).querySelector(".err").textContent,
    /^gone\/model is no longer in OpenRouter's list of models; choose another with Grok the Skeptic's model button\. OpenRouter found nowhere to run this model/,
  );
  assert.doesNotMatch(entries().at(-1).querySelector(".err").textContent, /web search/);

  // Settings closes on a click outside it, but not after a drag that ends outside it.
  const dialog = $("#settings-dialog");
  const mouse = (type, target) => target.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: 5, clientY: 5 }));
  $("#btn-settings").click();
  assert.ok(dialog.open);
  mouse("mousedown", $("#set-rules"));
  mouse("click", dialog);
  assert.ok(dialog.open, "a drag from inside doesn't close it");
  mouse("mousedown", dialog);
  mouse("click", dialog);
  assert.ok(!dialog.open, "a click outside closes it");

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("settings can be saved to a file and restored from one", async () => {
  const { w, d, blobs, downloads, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  await until(() => $$(".seat").length === 2, "seats");
  $("#btn-settings").click();
  const status = () => $("#set-file-status");

  // Saved without the keys…
  assert.equal($("#set-include-keys").checked, false, "keys are left out unless asked");
  $("#set-save-file").click();
  assert.match(downloads.at(-1), /^Dialog settings \d{4} \w{3} \d\d \d{4}\.json$/);
  assert.equal(blobs.at(-1).type, "application/json");
  const saved = JSON.parse(await blobs.at(-1).text());
  assert.equal(saved.format, "dialog-settings");
  assert.equal(saved.humanName, "Bill");
  assert.deepEqual(saved.seats.map((s) => [s.name, s.model, s.effort, s.role]), [
    ["Claude", "anthropic/claude-opus-5.5", "default", "Be brief."],
    ["Grok", "x-ai/grok-4.7", "low", ""],
  ]);
  assert.ok(!("apiKey" in saved));
  await until(() => /without your keys/.test(status().textContent), "saved status");
  // …or with them, when ticked.
  $("#set-include-keys").checked = true;
  $("#set-save-file").click();
  assert.equal(JSON.parse(await blobs.at(-1).text()).apiKey, "sk-test");
  await until(() => /with your keys\. Keep it private/.test(status().textContent), "saved-with-keys status");

  // Restore from a file: name, participants and rules replaced; the key kept.
  const choose = (file) => {
    const input = $("#set-restore-input");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new w.Event("change"));
  };
  const file = {
    format: "dialog-settings",
    savedAt: "2026-10-09T17:22:00.000Z",
    humanName: "William",
    aboutHuman: "Astronomer.",
    houseRules: "Be civil, {name}.",
    seats: [{ id: "G", name: "Gemini", model: "~google/gemini-pro-latest", effort: "default", role: "Fact-check.", color: "#4285f4" }],
  };
  choose(new w.File([JSON.stringify(file)], "backup.json", { type: "application/json" }));
  await until(() => $$(".seat").length === 1, "restored participants");
  assert.equal($(".seat .seat-head input").value, "Gemini");
  assert.equal($("#set-name").value, "William");
  assert.equal($("#set-about").value, "Astronomer.");
  assert.equal($("#set-rules").value, "Be civil, {name}.");
  assert.equal($("#set-key").value, "sk-test", "the key stays");
  assert.deepEqual([...$("#composer-to").options].map((o) => o.textContent), ["Everyone", "Privately: Gemini"]);
  assert.match(status().textContent, /Restored the settings from “backup\.json”/);
  const stored = JSON.parse(w.localStorage.getItem("dialog.settings.v1"));
  assert.equal(stored.humanName, "William");
  assert.equal(stored.apiKey, "sk-test");

  // Something else entirely: refused, nothing changed.
  choose(new w.File(["hello"], "notes.txt", { type: "text/plain" }));
  await until(() => !status().hidden && status().classList.contains("error"), "refusal");
  assert.match(status().textContent, /isn't a Dialog settings file/);
  assert.equal($$(".seat").length, 1);

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("a saved conversation can be resumed with Resume… (top bar, only before it starts), whole or just the ticked turns", async () => {
  const { w, d, blobs, replies, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const notBusy = () => !$("#transcript .entry.streaming");
  await until(() => $$(".seat").length === 2, "seats");
  const confirms = [];
  w.confirm = (m) => (confirms.push(m), true);
  const alerts = [];
  w.alert = (m) => alerts.push(m);
  const resume = (file) => {
    const input = $("#resume-input");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new w.Event("change"));
  };
  const resumeButton = () => $("#btn-resume");
  assert.equal(resumeButton().textContent, "Resume…");
  assert.equal(resumeButton().hidden, false, "in the top bar while the conversation is empty");
  assert.ok(!$("#transcript .empty").textContent.includes("Resume a saved"), "not on the welcome screen itself");

  // A short conversation: a public turn with an attached PDF, a reply, a private exchange.
  const input = $("#attach-input");
  const pdf = new w.File(["%PDF-1.4 hello"], "paper.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [pdf], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  await until(() => $$("#attach-tray .chip").length === 1, "the PDF in the tray");
  $("#composer-text").value = "What is time? </script> <!--";
  $("#composer-send").click();
  assert.equal(resumeButton().hidden, true, "gone once the conversation starts");
  replies.push({ pieces: ["Change."], cost: 0.01 });
  $$("#seat-list .seat")[0].querySelector("button.speak").click();
  await until(() => entries().length === 2 && notBusy(), "Claude's reply");
  $("#composer-to").value = "B";
  $("#composer-to").dispatchEvent(new w.Event("change"));
  $("#composer-text").value = "Psst";
  replies.push({ pieces: ["Secret."], cost: 0.002 });
  $("#composer-send").click();
  await until(() => entries().length === 4 && notBusy(), "Grok's private reply");
  const before = JSON.parse(w.sessionStorage.getItem("dialog.session.v1"));

  // Save All, then start again and change the settings.
  $("#btn-save").click();
  await until(() => blobs.length === 1, "saved");
  const all = await blobs[0].text();
  assert.ok(!all.includes("sk-test"), "never the key");
  $("#btn-new").click();
  assert.equal(entries().length, 0);
  assert.equal(resumeButton().hidden, false, "back after New conversation");
  $("#btn-settings").click();
  $("#set-name").value = "Someone";
  $("#set-name").dispatchEvent(new w.Event("input"));
  $$("#seat-list .seat")[1].querySelector('button[aria-label="Remove seat"]').click();
  assert.equal($$("#seat-list .seat").length, 1);

  // Resume it: the same turns, participants and name; the key stays.
  resumeButton().click();
  resume(new w.File([all], "Dialog 2026 Oct 23 1405.html", { type: "text/html" }));
  await until(() => entries().length === 4, "resumed turns");
  assert.equal(resumeButton().hidden, true);
  assert.match(confirms.at(-1), /^Resume the conversation in “Dialog 2026 Oct 23 1405\.html”, saved \d{4} \w{3} \d\d at \d\d:\d\d\? It has 4 turns, with Claude, Grok\./);
  assert.match(confirms.at(-1), /Your keys stay as they are\./);
  assert.deepEqual($$("#seat-list .seat .seat-head input").map((i) => i.value), ["Claude", "Grok"]);
  assert.equal($("#set-name").value, "Bill");
  assert.equal($("#set-key").value, "sk-test");
  assert.ok(entries()[0].textContent.includes("paper.pdf"));
  assert.ok(entries()[2].classList.contains("private") && entries()[3].classList.contains("private"));
  const after = JSON.parse(w.sessionStorage.getItem("dialog.session.v1"));
  assert.deepEqual(after, before, "stored exactly as before it was saved");
  assert.equal(after.entries[0].text, "What is time? </script> <!--", "text that looks like the end of the data block survives");
  const pdfId = after.entries[0].attachments[0].id;
  assert.ok(w.sessionStorage.getItem("dialog.file." + pdfId).startsWith("data:application/pdf;base64,"), "the PDF stored again");
  assert.match($("#session-cost").textContent, /0\.0120/);
  // The conversation carries on with the same participants.
  replies.push({ pieces: ["Still change."], cost: 0.001 });
  $$("#seat-list .seat")[0].querySelector("button.speak").click();
  await until(() => entries().length === 5 && notBusy(), "Claude carries on");

  // Save Selected: just the ticked turn, but every participant, so it can carry on with them all.
  const box = entries()[1].querySelector("input.pick");
  box.checked = true;
  box.dispatchEvent(new w.Event("change", { bubbles: true }));
  $("#btn-save").click();
  await until(() => blobs.length === 2, "saved selected");
  const one = await blobs[1].text();
  $("#btn-new").click();
  // A participant speaking first hides it too, from the moment the reply begins.
  replies.push({ pieces: ["Hello."], cost: 0.001, pause: true });
  $$("#seat-list .seat")[0].querySelector("button.speak").click();
  assert.equal(resumeButton().hidden, true, "hidden while the first reply arrives");
  await until(() => notBusy(), "the first reply");
  $("#btn-new").click();
  resumeButton().click();
  resume(new w.File([one], "Dialog selected.html", { type: "text/html" }));
  await until(() => entries().length === 1, "resumed selection");
  assert.match(confirms.at(-1), /It has 1 turn, with Claude, Grok\./);
  assert.equal(entries()[0].querySelector(".body").textContent.trim(), "Change.");
  assert.equal($$("#seat-list .seat").length, 2);

  // A page saved before conversations could be resumed, and something else entirely: refused.
  $("#btn-new").click();
  resume(new w.File([readable(one)], "Dialog old.html", { type: "text/html" }));
  await until(() => alerts.length === 1, "refusal of an old file");
  assert.match(alerts[0], /saved by an earlier version of Dialog.*It can still be read by a browser\./);
  resume(new w.File(["<p>hello</p>"], "notes.html", { type: "text/html" }));
  await until(() => alerts.length === 2, "refusal of another file");
  assert.match(alerts[1], /isn't a conversation saved by Dialog/);
  assert.equal(entries().length, 0, "nothing changed");

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("recent conversations: kept in the browser's database after New conversation or a closed tab, and brought back with Recent…", async () => {
  const idb = new IDBFactory();
  const { w, d, replies, errors } = makeHarness({ idb });
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const notBusy = () => !$("#transcript .entry.streaming");
  const confirms = [];
  w.confirm = (m) => (confirms.push(m), true);
  await until(() => $$(".seat").length === 2, "seats");
  await sleep(50); // the database has been looked at
  assert.equal($("#btn-recent").hidden, true, "nothing kept yet");

  // A conversation with a PDF, then New conversation: the one cleared is kept.
  const input = $("#attach-input");
  Object.defineProperty(input, "files", { value: [new w.File(["%PDF-1.4 hello"], "paper.pdf", { type: "application/pdf" })], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  await until(() => $$("#attach-tray .chip").length === 1, "the PDF in the tray");
  $("#composer-text").value = "What is time? Discuss.";
  $("#composer-send").click();
  replies.push({ pieces: ["Change."], cost: 0.01 });
  $$("#seat-list .seat")[0].querySelector("button.speak").click();
  await until(() => entries().length === 2 && notBusy(), "Claude's reply");
  assert.equal($("#btn-recent").hidden, true, "not while a conversation is under way");
  $("#btn-new").click();
  await until(() => !$("#btn-recent").hidden, "Recent… once a conversation is kept");

  // Recent… lists it; choosing it brings it back, file and all.
  $("#btn-recent").click();
  await until(() => $$("#recent-list .recent-row").length === 1, "the list");
  assert.equal($("#recent-dialog").open, true);
  const row = $("#recent-list .recent-row");
  assert.equal(row.querySelector(".r-title").textContent, "What is time?");
  assert.match(row.querySelector(".r-meta").textContent, /^\d\d:\d\d today · Claude, Grok · 2 turns$/);
  row.click();
  await until(() => entries().length === 2, "brought back");
  assert.equal($("#recent-dialog").open, false);
  assert.match(confirms.at(-1), /^Resume the conversation “What is time\?”, last kept \d\d:\d\d today\? It has 2 turns, with Claude, Grok\./);
  assert.ok(entries()[0].textContent.includes("paper.pdf"));
  const stored = JSON.parse(w.sessionStorage.getItem("dialog.session.v1"));
  assert.ok(w.sessionStorage.getItem("dialog.file." + stored.entries[0].attachments[0].id).startsWith("data:application/pdf;base64,"), "the PDF with it");

  // It carries on, and the tab closes: a new tab finds it, kept once, with the latest turn.
  replies.push({ pieces: ["Still change."], cost: 0.001 });
  $$("#seat-list .seat")[1].querySelector("button.speak").click();
  await until(() => entries().length === 3 && notBusy(), "Grok's reply");
  w.dispatchEvent(new w.Event("pagehide"));
  const second = makeHarness({ idb });
  const $2 = (sel) => second.d.querySelector(sel);
  await until(() => !$2("#btn-recent").hidden, "Recent… in the new tab");
  $2("#btn-recent").click();
  await until(() => second.d.querySelectorAll("#recent-list .recent-row").length === 1, "the new tab's list");
  assert.match($2("#recent-list .r-meta").textContent, /· 3 turns$/, "the same conversation, not a second copy");
  $2("#recent-cancel").click();
  assert.equal($2("#recent-dialog").open, false);

  await sleep(20);
  assert.deepEqual([...errors, ...second.errors].map(String), [], "no script errors");
});

test("a reply's host: shown in its particulars, from the reply itself or looked up when they're first opened", async () => {
  const { w, d, replies, state, hostCalls, blobs, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const notBusy = () => !$("#transcript .entry.streaming");
  const speak = (i) => $$("#seat-list .seat")[i].querySelector("button.speak").click();
  const lines = (i) => [...entries()[i].querySelectorAll(".detail")].map((x) => x.textContent);
  const toggle = (i) => entries()[i].querySelector("button.glance").click();
  await until(() => $$(".seat").length === 2, "seats");
  $("#composer-text").value = "Hello";
  $("#composer-send").click();

  // The reply names its host: shown at once, nothing looked up.
  replies.push({ pieces: ["Hi."], cost: 0.001, genId: "gen-1", provider: "Alibaba" });
  speak(0);
  await until(() => entries().length === 2 && notBusy(), "first reply");
  const scrolled = []; // what was scrolled into view, and how
  w.Element.prototype.scrollIntoView = function (opts) {
    scrolled.push({ el: this, opts });
  };
  const focusOptions = [];
  const focus = w.HTMLElement.prototype.focus;
  w.HTMLElement.prototype.focus = function (opts) {
    focusOptions.push(opts?.preventScroll === true);
    return focus.call(this, opts);
  };
  toggle(1);
  assert.equal(lines(1)[1], "Host: Alibaba.");
  assert.equal(hostCalls.length, 0);
  // Opening scrolls just far enough to show the particulars (below a long reply, they'd be
  // out of sight); the focus doesn't scroll, so it can't undo that.
  assert.deepEqual(focusOptions, [true]);
  assert.equal(scrolled.length, 1);
  assert.ok(scrolled[0].el.matches("button.foot.open") && entries()[1].contains(scrolled[0].el));
  assert.equal(scrolled[0].opts.block, "nearest");
  toggle(1);
  assert.equal(scrolled.length, 1, "closing them doesn't scroll");
  assert.deepEqual(focusOptions, [true, false], "and the focus may scroll as before");
  toggle(1);

  // It doesn't: nothing asked until the particulars are opened; then looked up once and kept.
  replies.push({ pieces: ["Hey."], cost: 0.001, genId: "gen-2" });
  speak(1);
  await until(() => entries().length === 3 && notBusy(), "second reply");
  await sleep(20);
  assert.equal(hostCalls.length, 0, "not looked up unasked");
  toggle(2);
  assert.equal(lines(2)[1], "Host: looking up…");
  await sleep(40);
  assert.ok(!lines(2).some((l) => l.startsWith("Host")), "OpenRouter had no record yet: left out");
  assert.deepEqual(hostCalls, [{ id: "gen-2", auth: "Bearer sk-test" }]);
  toggle(2); // closed
  state.hosts["gen-2"] = "DeepInfra";
  toggle(2); // opened again: asked again
  await until(() => lines(2)[1] === "Host: DeepInfra.", "the host looked up");
  assert.equal(hostCalls.length, 2);
  assert.equal(JSON.parse(w.sessionStorage.getItem("dialog.session.v1")).entries[2].host, "DeepInfra", "kept with the reply");
  toggle(2);
  toggle(2);
  await sleep(20);
  assert.equal(hostCalls.length, 2, "never asked again once known");

  // Not in the margin, only in the particulars; and in a saved file only where they're open.
  assert.ok(!entries()[2].querySelector("header").textContent.includes("DeepInfra"));
  toggle(1); // closed
  $("#btn-save").click();
  await until(() => blobs.length === 1, "saved");
  const saved = (await blobs[0].text()).replace(/<script type="application\/json"[^]*?<\/script>/, "");
  assert.ok(saved.includes("Host: DeepInfra.") && !saved.includes("Host: Alibaba."));

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("LaTeX math is drawn as math once a reply is complete, survives the safety filter, and goes into saved files", async () => {
  const { w, d, replies, blobs, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const notBusy = () => !$("#transcript .entry.streaming");
  await until(() => $$(".seat").length === 2, "seats");
  assert.ok([...d.head.querySelectorAll("style")].some((s) => s.textContent.includes("math.tml-display")), "Temml's stylesheet");

  // A saved conversation without math doesn't carry the math stylesheet.
  $("#composer-text").value = "It costs $5 and $10, and `$x$` is code.";
  $("#composer-send").click();
  assert.equal(entries()[0].querySelectorAll("math").length, 0, "money stays money");
  $("#btn-save").click();
  await until(() => blobs.length === 1, "saved without math");
  assert.ok(!(await blobs[0].text()).includes("math.tml-display"));

  // While arriving, the math shows as written; once complete, as math.
  replies.push({ pieces: ["Since $\\sqrt{2}$ is irrational", ", $$\\sqrt{2} = 1 + \\cfrac{1}{2 + \\cfrac{1}{2 + \\cdots}}$$", " <script>bad()</script>"], cost: 0.001, pause: true });
  $$("#seat-list .seat")[0].querySelector("button.speak").click();
  await until(() => entries().length === 2 && entries()[1].querySelector(".math-source"), "math arriving");
  assert.equal(entries()[1].querySelectorAll("math").length, 0, "not drawn while arriving");
  assert.equal(entries()[1].querySelector(".math-source").textContent, "$\\sqrt{2}$");
  await until(() => notBusy(), "the reply");
  const body = entries()[1].querySelector(".body");
  const maths = [...body.querySelectorAll("math")];
  assert.equal(maths.length, 2);
  assert.equal(maths[0].namespaceURI, "http://www.w3.org/1998/Math/MathML", "real MathML, kept by the safety filter");
  assert.ok(maths[0].querySelector("msqrt"));
  assert.equal(maths[1].getAttribute("display"), "block");
  assert.equal(maths[1].querySelectorAll("mfrac").length, 2);
  assert.ok(!body.querySelector("script") && !body.innerHTML.includes("bad()"), "scripts still removed");

  // Saved: the math as math, with its stylesheet.
  $("#btn-save").click();
  await until(() => blobs.length === 2, "saved with math");
  const saved = (await blobs[1].text()).replace(/<script type="application\/json"[^]*?<\/script>/, "");
  assert.ok(saved.includes("<msqrt>") && saved.includes('display="block"'));
  assert.ok(saved.includes("math.tml-display"), "the stylesheet travels with the math");
  assert.ok(!/<script/i.test(saved));

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("Escape closes the model picker; the Save dialog is used where the browser has one; the welcome note", async () => {
  const { w, d, blobs, downloads, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  await until(() => $$(".seat").length === 2, "seats");

  // The welcome screen explains that the participants lack their apps' hidden instructions.
  assert.match($("#transcript .empty .how-note").textContent, /don’t get those apps’ hidden instructions/);

  // Escape in the picker's search field closes it, even with text typed.
  const modelBefore = $$(".seat .model-button")[0].querySelector(".model-name").textContent;
  $$(".seat .model-button")[0].click();
  assert.ok($("#model-dialog").open);
  $("#model-search").value = "gro";
  $("#model-search").dispatchEvent(new w.Event("input"));
  $("#model-search").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.ok(!$("#model-dialog").open, "closed by Escape");
  assert.equal($$(".seat .model-button")[0].querySelector(".model-name").textContent, modelBefore, "model unchanged");

  // A browser with a Save dialog (Chrome, Edge): you pick the place and name; nothing is downloaded.
  const written = [];
  let answer = "save";
  w.showSaveFilePicker = async (opts) => {
    if (answer === "cancel") throw new w.DOMException("The user aborted a request.", "AbortError");
    if (answer === "refuse") throw new w.DOMException("Not allowed here.", "SecurityError");
    written.push({ suggested: opts.suggestedName, types: opts.types });
    return {
      name: "My settings.json",
      createWritable: async () => ({ write: async (b) => written.push(await b.text()), close: async () => {} }),
    };
  };
  $("#btn-settings").click();
  const before = downloads.length;
  $("#set-save-file").click();
  await until(() => /Saved “My settings\.json”, without your keys/.test($("#set-file-status").textContent), "saved via the dialog");
  assert.match(written[0].suggested, /^Dialog settings \d{4} \w{3} \d\d \d{4}\.json$/);
  assert.equal(JSON.stringify(written[0].types), JSON.stringify([{ description: "Dialog settings", accept: { "application/json": [".json"] } }]));
  assert.equal(JSON.parse(written[1]).format, "dialog-settings");
  assert.equal(downloads.length, before, "no download as well");

  // Cancel in the Save dialog: nothing saved, nothing downloaded, no message.
  answer = "cancel";
  $("#set-file-status").hidden = true;
  $("#set-save-file").click();
  await sleep(20);
  assert.equal(downloads.length, before);
  assert.equal($("#set-file-status").hidden, true);

  // A browser that refuses the dialog (e.g. for a page opened from a file): an ordinary download instead.
  answer = "refuse";
  $("#set-save-file").click();
  await until(() => downloads.length === before + 1, "fallback download");
  assert.equal(blobs.at(-1).type, "application/json");

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("participants can be reordered by dragging the handle, or with the arrow keys", async () => {
  const { w, d, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  await until(() => $$(".seat").length === 2, "seats");
  const names = () => $$(".seat .seat-head input").map((i) => i.value);
  const toMenu = () => [...$("#composer-to").options].slice(1).map((o) => o.textContent.replace("Privately: ", ""));
  const stored = () => JSON.parse(w.localStorage.getItem("dialog.settings.v1")).seats.map((s) => s.name);
  const grip = (i) => $$(".seat .grip")[i];

  $$(".seat .seat-head button")[0].click(); // + copy Claude
  assert.deepEqual(names(), ["Claude", "Claude 2", "Grok"]);
  assert.equal(grip(0).getAttribute("draggable"), "true");

  // Keyboard: Grok's handle, ↑ moves it up one; focus stays on the handle.
  $$(".seat details")[0].open = true; // an open Role box survives the move
  grip(2).focus();
  grip(2).dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  assert.deepEqual(names(), ["Claude", "Grok", "Claude 2"]);
  assert.deepEqual(toMenu(), ["Claude", "Grok", "Claude 2"], "the To menu follows");
  assert.deepEqual(stored(), ["Claude", "Grok", "Claude 2"], "and the saved order");
  assert.equal(d.activeElement, grip(1), "focus stays on Grok's handle");
  assert.equal($$(".seat details")[0].open, true, "cards are moved, not redrawn");
  grip(0).dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  assert.deepEqual(names(), ["Claude", "Grok", "Claude 2"], "the first can't go higher");

  // Dragging: Claude's handle dropped on the lower half of Claude 2's card puts it last.
  const fire = (type, target, clientY = 5) => {
    const ev = new w.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clientY", { value: clientY });
    Object.defineProperty(ev, "clientX", { value: 5 });
    target.dispatchEvent(ev);
    return ev;
  };
  const cards = () => $$(".seat");
  fire("dragstart", grip(0));
  assert.ok(cards()[0].classList.contains("dragging"));
  const over = fire("dragover", cards()[2]);
  assert.ok(over.defaultPrevented, "the list accepts the drop");
  assert.ok(cards()[2].classList.contains("drop-after"), "a line shows where it will land");
  fire("drop", cards()[2]);
  fire("dragend", grip(2));
  assert.deepEqual(names(), ["Grok", "Claude 2", "Claude"]);
  assert.ok(!$(".seat.dragging") && !$(".seat.drop-after"), "marks cleared");

  // …and the upper half of the first card puts it first.
  fire("dragstart", grip(2));
  fire("dragover", cards()[0], -1);
  assert.ok(cards()[0].classList.contains("drop-before"));
  fire("drop", cards()[0], -1);
  fire("dragend", grip(0));
  assert.deepEqual(names(), ["Claude", "Grok", "Claude 2"]);

  // Something else dragged over the list (a file, say) is ignored: no landing line.
  fire("dragover", cards()[1]);
  assert.ok(!$(".seat.drop-before") && !$(".seat.drop-after"));

  // + copy still inserts right after the card's current place.
  cards()[1].querySelector(".seat-head button").click(); // Grok's + copy
  assert.deepEqual(names(), ["Claude", "Grok", "Grok 2", "Claude 2"]);

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("the send keys ask the participant named at the end of the message", async () => {
  const { w, d, chatCalls, replies, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const notBusy = () => $$(".seat .speak").every((b) => !b.disabled && !b.hidden);
  const hint = () => $("#composer-hint").textContent;
  const type = (t) => {
    $("#composer-text").value = t;
    $("#composer-text").dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const sendKeys = () => $("#composer-text").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await until(() => $$(".seat").length === 2, "seats");

  // Nobody has spoken, but the message names Grok: the note says so as you type.
  type("What's the best telescope for a beginner");
  assert.equal(hint(), "Enter adds");
  type("What's the best telescope for a beginner, Grok?");
  assert.equal(hint(), "Enter adds, then Grok replies · Ctrl+Enter just adds");
  assert.match($("#composer-hint").title, /named at the end of your message/);
  replies.push({ pieces: ["A small Dobsonian."], cost: 0.001 });
  sendKeys();
  await until(() => notBusy() && entries().length === 2, "Grok replies");
  assert.equal(chatCalls.at(-1).session_id, "dialog-B");
  assert.equal(hint(), "Enter adds, then Grok replies · Ctrl+Enter just adds", "now Grok is the last speaker");

  // Naming another participant overrides the last speaker.
  type("Do you agree, claude.");
  assert.equal(hint(), "Enter adds, then Claude replies · Ctrl+Enter just adds");
  replies.push({ pieces: ["Mostly."], cost: 0.001 });
  sendKeys();
  await until(() => notBusy() && entries().length === 4, "Claude replies");
  assert.equal(chatCalls.at(-1).session_id, "dialog-A");
  assert.equal(entries()[2].querySelector(".body").textContent.trim(), "Do you agree.", "the name is for Dialog, not part of the message");
  assert.equal(entries()[2].querySelector(".direction").textContent, "(to Claude)");
  assert.match(JSON.stringify(chatCalls.at(-1).messages), /Bill says \(to Claude\):\\nDo you agree\./);

  // ⌘↩ (Ctrl+Enter here) just adds, even with a name at the end.
  type("Interesting, Grok");
  $("#composer-text").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(entries().length, 5);
  assert.equal(entries().at(-1).querySelector(".body").textContent.trim(), "Interesting, Grok");
  await sleep(20);
  assert.equal(chatCalls.length, 2, "nobody asked");

  // Shift-Return is left to the box (a new line); nothing is sent.
  type("First line");
  const shift = new w.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
  $("#composer-text").dispatchEvent(shift);
  assert.equal(shift.defaultPrevented, false);
  assert.equal(entries().length, 5);
  assert.match($("#composer-text").placeholder, /Shift\+Enter or Alt\+Enter for a new line/);

  // Option-Return (Alt+Enter) puts a line break at the caret; nothing is sent.
  $("#composer-text").setSelectionRange(10, 10);
  const opt = new w.KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true, cancelable: true });
  $("#composer-text").dispatchEvent(opt);
  assert.equal(opt.defaultPrevented, true);
  assert.equal($("#composer-text").value, "First line\n");
  assert.equal(entries().length, 5);

  // Add to conversation still just adds, and the note goes back to the last speaker.
  type("Noted, Grok");
  $("#composer-send").click();
  assert.equal(entries().length, 6);
  assert.equal(chatCalls.length, 2, "nobody asked");
  assert.equal(hint(), "Enter adds, then Claude replies · Ctrl+Enter just adds");

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("“…, team”: everyone replies once, around the table; “independently”: none sees the others' replies", async () => {
  const { w, d, chatCalls, replies, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const speakers = () => entries().map((e) => e.querySelector(".who").textContent);
  const notBusy = () => $$(".seat .speak").every((b) => !b.disabled && !b.hidden);
  const hint = () => $("#composer-hint").textContent;
  const type = (t) => {
    $("#composer-text").value = t;
    $("#composer-text").dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const enter = () => $("#composer-text").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await until(() => $$(".seat").length === 2, "seats");
  $$(".seat .seat-head button")[0].click(); // + copy: Claude, Claude 2, Grok
  assert.deepEqual($$(".seat .seat-head input").map((i) => i.value), ["Claude", "Claude 2", "Grok"]);

  // Grok speaks; a round then continues around the table from Claude.
  replies.push({ pieces: ["Grok opens."], cost: 0.001 });
  $$(".seat .speak")[2].click();
  await until(() => notBusy() && entries().length === 1, "Grok");
  type("What do you all think, tema?"); // a slip of "team"
  assert.equal(hint(), "Enter adds, then all 3 reply in turn, Claude first · Ctrl+Enter just adds");
  assert.match($("#composer-hint").title, /in this order: Claude, Claude 2, Grok/);
  replies.push({ pieces: ["ROUND-ONE"], cost: 0.001 }, { pieces: ["ROUND-TWO"], cost: 0.001 }, { pieces: ["ROUND-THREE"], cost: 0.001 });
  enter();
  await until(() => notBusy() && entries().length === 5, "a full round");
  assert.deepEqual(speakers(), ["Grok", "Bill", "Claude", "Claude 2", "Grok"]);
  assert.equal(entries()[1].querySelector(".body").textContent.trim(), "What do you all think?", "your message goes in once, without “tema”");
  assert.equal(entries()[1].querySelector(".direction").textContent, "(to everyone, in turn)");
  assert.match(JSON.stringify(chatCalls.at(-3).messages), /Bill says \(to everyone, each replying in turn\):\\nWhat do you all think\?/);
  assert.doesNotMatch(JSON.stringify(chatCalls.at(-3).messages), /tema/);
  assert.match(JSON.stringify(chatCalls.at(-1).messages), /ROUND-ONE.*ROUND-TWO/s, "in turn: later speakers see earlier replies");
  assert.equal($$("#transcript .direction").length, 1, "only your message's");

  // Not a round: "…long term."
  type("Think about the long term.");
  assert.equal(hint(), "Enter adds, then Grok replies · Ctrl+Enter just adds");

  // Independently: each answers without the others' replies from this round.
  type("Now your own views, independantly, team");
  assert.equal(hint(), "Enter adds, then all 3 reply independently, at once · Ctrl+Enter just adds", "all at once: nobody goes first");
  const before = chatCalls.length;
  replies.push({ pieces: ["IND-ONE"], cost: 0.001 }, { pieces: ["IND-TWO"], cost: 0.001 }, { pieces: ["IND-THREE"], cost: 0.001 });
  enter();
  await until(() => notBusy() && entries().length === 9, "an independent round");
  const seen = chatCalls.slice(before).map((c) => JSON.stringify(c.messages));
  assert.match(seen[0], /Bill says \(to everyone, each replying without seeing the others' replies\):\\nNow your own views"/);
  assert.doesNotMatch(seen[0], /independantly/);
  assert.doesNotMatch(seen[1], /IND-ONE/, "the second doesn't see the first");
  assert.doesNotMatch(seen[2], /IND-ONE|IND-TWO/, "the third sees neither");
  assert.match(seen[2], /ROUND-TWO/, "earlier rounds stay visible");
  assert.deepEqual($$("#transcript .direction").map((x) => x.textContent).slice(1), [
    "(to everyone, independently)",
    ...Array(3).fill("(answering independently)"),
  ]);
  // Afterwards everyone sees everything again.
  replies.push({ pieces: ["Seen them all."], cost: 0.001 });
  $$(".seat .speak")[0].click();
  await until(() => notBusy() && entries().length === 10, "Claude after the round");
  assert.match(JSON.stringify(chatCalls.at(-1).messages), /IND-TWO.*IND-THREE/s);

  // Stop ends the round: the reply under way stops, the rest are not asked.
  type("Once more, team");
  const calls = chatCalls.length;
  replies.push({ pieces: ["slow", " reply"], slow: true });
  enter();
  await until(() => $$(".seat").some((c) => c.classList.contains("speaking")), "first reply under way");
  assert.ok($$(".seat .speak").every((b) => b.disabled || b.hidden), "Speak buttons wait during a round");
  $$(".seat").find((c) => c.classList.contains("speaking")).querySelector(".seat-actions button.danger").click(); // Stop
  await until(() => notBusy(), "stopped");
  await sleep(30);
  assert.equal(chatCalls.length, calls + 1, "nobody else asked");

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("an independent round runs all at once: the replies fill in together; “in parallel” means the same; a card's Stop stops only its own", async () => {
  const { w, d, chatCalls, replies, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const speakers = () => entries().map((e) => e.querySelector(".who").textContent);
  const arriving = () => $$("#transcript .entry.streaming");
  const notBusy = () => $$(".seat .speak").every((b) => !b.disabled && !b.hidden);
  const hint = () => $("#composer-hint").textContent;
  const card = (name) => $$(".seat").find((c) => c.querySelector(".seat-head input[type=text]").value === name);
  const type = (t) => {
    $("#composer-text").value = t;
    $("#composer-text").dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const enter = () => $("#composer-text").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await until(() => $$(".seat").length === 2, "seats");
  $$(".seat .seat-head button")[0].click(); // + copy: Claude, Claude 2, Grok

  // “in parallel” is a synonym for “independently”; nobody goes first.
  type("Your own views, in parallel, team");
  assert.equal(hint(), "Enter adds, then all 3 reply independently, at once · Ctrl+Enter just adds");
  assert.match($("#composer-hint").title, /all at the same time, each without seeing the others’ replies: Claude, Claude 2, Grok\./);
  assert.match($("#composer-hint").title, /Stop on a card stops only that participant/);
  replies.push(
    { pieces: ["P-ONE ", "a ", "b"], pause: true, cost: 0.001 },
    { pieces: ["P-TWO ", "a ", "b"], pause: true, cost: 0.002 },
    { pieces: ["P-THREE ", "a ", "b"], pause: true, cost: 0.003 },
  );
  enter();

  // Every request goes out straight away, before any reply has come in; the replies take
  // their places in round order at once, each “waiting for …” until its words arrive.
  assert.equal(chatCalls.length, 3, "all three asked at once");
  assert.deepEqual(speakers(), ["Bill", "Claude", "Claude 2", "Grok"]);
  assert.equal(arriving().length, 3, "all three arriving together");
  assert.equal($$(".seat.speaking").length, 3, "every card outlined");
  assert.equal($$(".seat .seat-actions button.danger").filter((b) => !b.hidden).length, 3, "every card has its own Stop");
  assert.deepEqual(
    arriving().map((e) => e.querySelector(".waiting")?.textContent),
    ["waiting for Claude…", "waiting for Claude 2…", "waiting for Grok…"],
    "“waiting for …” until the words come",
  );
  await until(() => arriving().length === 3 && arriving().every((e) => /P-\w+ a/.test(e.textContent)), "all three filling in at once");

  await until(() => notBusy() && arriving().length === 0, "the round");
  assert.deepEqual(entries().slice(1).map((e) => e.querySelector(".body").textContent.trim()), ["P-ONE a b", "P-TWO a b", "P-THREE a b"]);
  assert.equal(entries()[0].querySelector(".body").textContent.trim(), "Your own views", "“in parallel, team” is for Dialog, not part of the message");
  assert.equal(entries()[0].querySelector(".direction").textContent, "(to everyone, independently)");
  assert.deepEqual(entries().slice(1).map((e) => e.querySelector(".direction").textContent), Array(3).fill("(answering independently)"));
  const asked = chatCalls.map((c) => JSON.stringify(c.messages.slice(1)));
  assert.ok(asked.every((m) => m.includes("Bill says (to everyone, each replying without seeing the others' replies):\\nYour own views")));
  assert.ok(asked.every((m) => !/P-|parallel/.test(m)), "none saw another's reply");
  assert.match($("#session-cost").textContent, /\$0\.0060/, "each reply's cost counted");

  // Afterwards everyone sees them all, in that order.
  replies.push({ pieces: ["Seen."], cost: 0.001 });
  card("Grok").querySelector(".speak").click();
  await until(() => notBusy() && entries().length === 5, "Grok after the round");
  assert.match(JSON.stringify(chatCalls.at(-1).messages), /P-ONE.*P-TWO.*P-THREE/s);

  // Stop on one card ends only that reply; the others go on, and the round ends when they do.
  type("Once more, Claude and Claude 2, independently");
  assert.equal(hint(), "Enter adds, then Claude and Claude 2 reply independently, at once · Ctrl+Enter just adds");
  replies.push({ pieces: ["never ", "finishes"], slow: true }, { pieces: ["S-ONE ", "S-TWO ", "S-THREE ", "S-FOUR"], pause: true, cost: 0.001 });
  enter();
  assert.equal(chatCalls.length, 6, "both asked at once");
  await until(() => /never/.test(entries().at(-2).textContent), "Claude under way");
  card("Claude").querySelector(".seat-actions button.danger").click();
  await until(() => !card("Claude").classList.contains("speaking"), "Claude stopped");
  assert.ok(card("Claude 2").classList.contains("speaking"), "Claude 2 still replying");
  assert.equal(card("Claude").querySelector(".speak").disabled, true, "Speak waits until the round is over");
  await until(() => notBusy(), "the rest of the round");
  assert.deepEqual(speakers().slice(-3), ["Bill", "Claude", "Claude 2"]);
  assert.match(entries().at(-2).querySelector(".foot").textContent, /stopped early/);
  assert.equal(entries().at(-1).querySelector(".body").textContent.trim(), "S-ONE S-TWO S-THREE S-FOUR", "the other reply finished");
  assert.equal(chatCalls.length, 6, "nobody else asked");

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("Sleep: the card folds to the end and sits out “team” rounds; names at the end ask just those", async () => {
  const { w, d, chatCalls, replies, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const speakers = () => entries().map((e) => e.querySelector(".who").textContent);
  const notBusy = () => $$(".seat .speak").every((b) => !b.disabled && !b.hidden);
  const hint = () => $("#composer-hint").textContent;
  const type = (t) => {
    $("#composer-text").value = t;
    $("#composer-text").dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const enter = () => $("#composer-text").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const card = (name) => $$(".seat").find((c) => (c.querySelector(".seat-head input[type=text]")?.value ?? c.querySelector(".seat-name")?.textContent) === name);
  const cards = () => $$(".seat").map((c) => (c.classList.contains("asleep") ? `(${c.querySelector(".seat-name").textContent})` : c.querySelector(".seat-head input[type=text]").value));
  const sleepBox = (name) => card(name).querySelector("label.sleep input");
  const stored = () => JSON.parse(w.localStorage.getItem("dialog.settings.v1")).seats.map((s) => (s.asleep ? `(${s.name})` : s.name));
  await until(() => $$(".seat").length === 2, "seats");
  $$(".seat .seat-head button")[0].click(); // + copy: Claude, Claude 2, Grok
  assert.deepEqual(cards(), ["Claude", "Claude 2", "Grok"]);
  assert.equal(sleepBox("Claude").checked, false);

  // Tick Sleep on Claude: its card folds to just its name and the box, at the end of the list.
  sleepBox("Claude").click();
  assert.deepEqual(cards(), ["Claude 2", "Grok", "(Claude)"]);
  const folded = card("Claude");
  assert.ok(!folded.querySelector(".speak, .model-button, details, .grip, .seat-opts"), "nothing but the name and the box");
  assert.equal(sleepBox("Claude").checked, true);
  assert.equal(d.activeElement, sleepBox("Claude"), "the keyboard stays on the box");
  assert.deepEqual(stored(), ["(Claude)", "Claude 2", "Grok"], "saved asleep, in its old place");
  assert.ok([...$("#composer-to").options].some((o) => o.textContent === "Privately: Claude"), "still in the To menu");

  // A team round leaves it out.
  type("Thoughts, team?");
  assert.equal(hint(), "Enter adds, then the 2 awake reply in turn, Claude 2 first · Ctrl+Enter just adds");
  assert.match($("#composer-hint").title, /Claude 2, Grok .*Sleeping participants sit it out\./);
  replies.push({ pieces: ["T-ONE"], cost: 0.001 }, { pieces: ["T-TWO"], cost: 0.001 });
  enter();
  await until(() => notBusy() && entries().length === 3, "the round");
  assert.deepEqual(speakers(), ["Bill", "Claude 2", "Grok"]);
  assert.ok(!chatCalls.some((c) => c.session_id === "dialog-A"), "Claude not asked");

  // Named, it still replies; its folded card shows Stop while it does, and the box waits.
  type("And you, Claude?");
  assert.equal(hint(), "Enter adds, then Claude replies · Ctrl+Enter just adds");
  replies.push({ pieces: ["Half"], slow: true });
  enter();
  await until(() => card("Claude").classList.contains("speaking"), "Claude replying");
  assert.equal(chatCalls.at(-1).session_id, "dialog-A");
  const stopBtn = card("Claude").querySelector("button.danger");
  assert.equal(stopBtn.hidden, false);
  assert.equal(sleepBox("Claude").disabled, true, "can't fold or unfold mid-reply");
  stopBtn.click();
  await until(() => notBusy() && !card("Claude").classList.contains("speaking"), "stopped");
  assert.equal(stopBtn.hidden, true);
  assert.equal(sleepBox("Claude").disabled, false);

  // With no name at the end, Return asks the last awake speaker, not the sleeping one.
  type("Go on");
  assert.equal(hint(), "Enter adds, then Grok replies · Ctrl+Enter just adds");

  // A list of names: just those, once each, in the order named.
  type("Compare those, Grok and Claude 2.");
  assert.equal(hint(), "Enter adds, then Grok and Claude 2 reply in turn · Ctrl+Enter just adds");
  replies.push({ pieces: ["L-ONE"], cost: 0.001 }, { pieces: ["L-TWO"], cost: 0.001 });
  enter();
  await until(() => notBusy() && entries().length === 8, "the listed pair");
  assert.deepEqual(speakers().slice(-3), ["Bill", "Grok", "Claude 2"]);
  assert.equal(entries().at(-3).querySelector(".body").textContent.trim(), "Compare those.");
  assert.equal(entries().at(-3).querySelector(".direction").textContent, "(to Grok and Claude 2, in turn)");
  assert.match(JSON.stringify(chatCalls.at(-2).messages), /Bill says \(to Grok and Claude 2, each replying in turn\):\\nCompare those\./);
  assert.match(JSON.stringify(chatCalls.at(-1).messages), /L-ONE/, "in turn: the second sees the first");

  // A list may name a sleeping participant, and may be “independently”.
  type("Your own views, Claude and Grok, independently");
  assert.equal(hint(), "Enter adds, then Claude and Grok reply independently, at once · Ctrl+Enter just adds");
  const before = chatCalls.length;
  replies.push({ pieces: ["I-ONE"], cost: 0.001 }, { pieces: ["I-TWO"], cost: 0.001 });
  enter();
  await until(() => notBusy() && entries().length === 11, "the independent pair");
  assert.deepEqual(chatCalls.slice(before).map((c) => c.session_id), ["dialog-A", "dialog-B"]);
  assert.doesNotMatch(JSON.stringify(chatCalls.at(-1).messages), /I-ONE/, "Grok doesn't see Claude's reply");
  assert.equal(entries().at(-3).querySelector(".direction").textContent, "(to Claude and Grok, independently)");

  // ↑/↓ moves among the awake cards only.
  const grip = (name) => card(name).querySelector(".grip");
  grip("Grok").dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  assert.deepEqual(cards(), ["Claude 2", "Grok", "(Claude)"], "Grok is the last awake card");
  grip("Claude 2").dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  assert.deepEqual(cards(), ["Grok", "Claude 2", "(Claude)"]);
  assert.deepEqual(stored(), ["(Claude)", "Grok", "Claude 2"]);

  // Everyone asleep: “team” is taken off, the message goes in, and no one is asked.
  sleepBox("Grok").click();
  sleepBox("Claude 2").click();
  assert.deepEqual(cards(), ["(Claude)", "(Grok)", "(Claude 2)"], "folded cards keep the list's order");
  type("Anyone there, team?");
  assert.equal(hint(), "Enter adds (everyone’s asleep)");
  const calls = chatCalls.length;
  enter();
  await sleep(30);
  assert.equal(chatCalls.length, calls);
  assert.equal(entries().at(-1).querySelector(".body").textContent.trim(), "Anyone there?");

  // Unticking unfolds a card and puts it back in its place.
  sleepBox("Claude").click();
  assert.deepEqual(cards(), ["Claude", "(Grok)", "(Claude 2)"]);
  assert.ok(card("Claude").querySelector(".speak"), "the full card again");
  sleepBox("Claude 2").click();
  sleepBox("Grok").click();
  assert.deepEqual(cards(), ["Claude", "Grok", "Claude 2"]);
  assert.deepEqual(stored(), ["Claude", "Grok", "Claude 2"]);
  assert.ok(!("asleep" in JSON.parse(w.localStorage.getItem("dialog.settings.v1")).seats[0]));

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("participants make files: cards to open, save or remove; the others see them; web pages open walled off", async () => {
  const { w, d, chatCalls, replies, blobs, downloads, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const notBusy = () => $$(".seat .speak").every((b) => !b.disabled && !b.hidden);
  const speak = (i) => $$(".seat .speak")[i].click();
  await until(() => $$(".seat").length === 2, "seats");

  // The welcome screen links to the README, beside this page.
  const readme = $("#transcript .empty .how-readme a");
  assert.equal(readme.getAttribute("href"), "README.html");
  assert.equal(readme.target, "_blank");

  // Claude writes two files; while they arrive, the reply says which it is writing.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
  const page = "<html><body><script>document.body.textContent = 1 + 1</script></body></html>";
  replies.push({
    pause: true,
    cost: 0.01,
    pieces: ["Here you go.\n\n", `<file name="orbit.svg">\n${svg}\n</file>\n`, '<file name="calc.html">\n<html><body>', page.slice(12) + "\n</file>\n", "Enjoy."],
  });
  speak(0);
  await until(() => /Writing calc\.html/.test(entries().at(-1)?.textContent ?? ""), "the file being written");
  assert.match(entries().at(-1).querySelector(".writing").textContent, /^Made orbit\.svg\. Writing calc\.html \(\d+ bytes so far\)…$/);
  assert.ok(!entries().at(-1).querySelector(".body").textContent.includes("<html>"), "the file's text isn't shown as it arrives");
  await until(() => notBusy() && entries().at(-1).querySelectorAll(".made-file").length === 2, "the reply and its files");

  const reply = entries().at(-1);
  assert.equal(reply.querySelector(".body").textContent.trim(), "Here you go.\nEnjoy.");
  const cards = () => [...entries()[0].querySelectorAll(".made-file")];
  assert.deepEqual(cards().map((c) => c.querySelector(".made-name").textContent), ["orbit.svg (drawing, 95 bytes)", "calc.html (web page, 76 bytes)"]);
  assert.ok(cards()[0].querySelector("img.made-preview").src.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg"), "the drawing shown small");
  assert.deepEqual([...cards()[1].querySelectorAll("button")].map((b) => b.textContent), ["Open", "Save…", "×"]);

  // Kept apart from the conversation record, like attachments.
  const record = w.sessionStorage.getItem("dialog.session.v1");
  assert.ok(!record.includes("textContent"), "contents not in the conversation record");
  assert.equal(Object.keys(w.sessionStorage).filter((k) => k.startsWith("dialog.file.")).length, 2);

  // Open: a new tab holding the file in a walled-off frame; only a web page may run scripts.
  const tabs = [];
  w.open = () => {
    const tab = { written: "", opener: w, document: { open() {}, write: (h) => (tab.written += h), close() {} } };
    tabs.push(tab);
    return tab;
  };
  const frameIn = (tab) => new w.DOMParser().parseFromString(tab.written, "text/html").querySelector("iframe");
  cards()[1].querySelector("button").click();
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].opener, null, "the tab keeps no handle on Dialog");
  assert.equal(frameIn(tabs[0]).getAttribute("sandbox"), "allow-scripts allow-forms allow-modals allow-downloads allow-popups allow-popups-to-escape-sandbox");
  assert.equal(frameIn(tabs[0]).getAttribute("srcdoc"), page, "the page exactly as written");
  assert.ok(!/<script/i.test(tabs[0].written.replace(/srcdoc="[^"]*"/, "")), "nothing runs outside the frame");
  cards()[0].querySelector(".made-preview").click();
  assert.equal(frameIn(tabs[1]).getAttribute("sandbox"), "allow-popups allow-popups-to-escape-sandbox", "a drawing: no scripts");
  assert.match(frameIn(tabs[1]).getAttribute("srcdoc"), /<img src="data:image\/svg\+xml;charset=utf-8,%3Csvg/);

  // Save…: the web page goes through the pretty-printer.
  cards()[1].querySelectorAll("button")[1].click();
  await until(() => downloads.includes("calc.html"), "saved");
  assert.equal(blobs.at(-1).type, "text/html;charset=utf-8");
  assert.equal(await blobs.at(-1).text(), "<html>\n\n  <body>\n    <script>\n      document.body.textContent = 1 + 1\n    </script>\n  </body>\n\n</html>\n");
  cards()[0].querySelectorAll("button")[1].click();
  await until(() => downloads.includes("orbit.svg"), "drawing saved");
  assert.equal(await blobs.at(-1).text(), svg, "other files are saved exactly as written");

  // Grok sees Claude's reply with both files after its text.
  replies.push({ pieces: ["Nice."], cost: 0.001 });
  speak(1);
  await until(() => notBusy() && entries().length === 2, "Grok");
  const grokSaw = chatCalls.at(-1).messages.at(-1).content;
  assert.ok(grokSaw.startsWith(`Claude says:\nHere you go.\n\nEnjoy.\n\n<file name="orbit.svg">\n${svg}\n</file>\n\n<file name="calc.html">\n${page}\n</file>`));

  // Remove the web page: it stays listed, struck out, and no one sees it from now on.
  cards()[1].querySelector("button.danger").click();
  assert.ok(cards()[1].classList.contains("gone"));
  assert.equal(cards()[1].querySelector(".made-note").textContent, "Removed; no participant sees it now.");
  assert.equal(cards()[1].querySelectorAll("button").length, 0);
  assert.equal(Object.keys(w.sessionStorage).filter((k) => k.startsWith("dialog.file.")).length, 1, "its storage is freed");

  // Claude revises the drawing: the earlier one is marked, and only the new one is sent.
  replies.push({ pieces: [`Bigger:\n<file name="orbit.svg">\n${svg.replace('r="4"', 'r="5"')}\n</file>`], cost: 0.01 });
  speak(0);
  await until(() => notBusy() && entries().length === 3, "Claude's revision");
  assert.ok(cards()[0].classList.contains("replaced"));
  assert.equal(cards()[0].querySelector(".made-note").textContent, "A later version replaces this one.");
  replies.push({ pieces: ["Bigger indeed."], cost: 0.001 });
  speak(1);
  await until(() => notBusy() && entries().length === 4, "Grok again");
  const seen = JSON.stringify(chatCalls.at(-1).messages);
  assert.ok(seen.includes("(Claude's file orbit.svg was here; a later version of it comes further on.)"));
  assert.ok(seen.includes("(Claude's file calc.html was here; Bill has since removed it.)"));
  assert.ok(seen.includes('r=\\"5\\"') && !seen.includes('r=\\"4\\"') && !seen.includes("textContent"));

  // Save All includes the files.
  $("#btn-save").click();
  await until(() => blobs.at(-1).type === "text/html;charset=utf-8" && downloads.at(-1).startsWith("Dialog "), "saved conversation");
  const saved = squash(await blobs.at(-1).text());
  assert.ok(saved.includes('<p class="files-label">Files made</p>'));
  assert.ok(saved.includes('calc.html (web page, 76 bytes) <span class="gone">removed</span>'));
  assert.ok(!/<script/i.test(readable(saved)), "no script but the data block, whatever the files hold");

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("the model list: fetched past the browser's copy; Refresh list; a list over 12 hours old is replaced when the picker opens", async () => {
  const HOUR = 60 * 60 * 1000;
  const ARGON = {
    id: "google/gemini-4-argon", name: "Google: Gemini 4 Argon", pricing: { prompt: "0.000002", completion: "0.00001" }, context_length: 1048576,
    architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
    reasoning: { mandatory: true, supported_efforts: ["high", "medium", "low"], default_effort: "medium" }, supported_parameters: ["reasoning", "tools"],
  };
  const LATER = { id: "some/later-model", name: "Some: Later Model", pricing: { prompt: "0.000001", completion: "0.000001" }, architecture: { output_modalities: ["text"] } };
  // Dialog's saved copy of the list: an hour old, from before Argon was listed.
  const savedModels = {
    at: Date.now() - HOUR,
    models: [
      { id: "anthropic/claude-opus-5.5", name: "Anthropic: Claude Opus 5.5", inputPrice: 4, outputPrice: 20, contextLength: 1000000, inputModalities: ["text", "image", "file"],
        reasoning: { efforts: ["max", "xhigh", "high", "medium", "low"], defaultEffort: "high", mandatory: true }, tools: true },
      { id: "x-ai/grok-4.7", name: "SpaceXAI: Grok 4.7", inputPrice: 2, outputPrice: 6, contextLength: 500000, inputModalities: ["text"],
        reasoning: { efforts: ["xhigh", "high", "medium", "low"], defaultEffort: "high", mandatory: true }, tools: false },
    ],
  };
  const { w, d, modelCalls, state, errors } = makeHarness({ savedModels });
  state.models = { data: [...MODELS.data, ARGON] }; // what OpenRouter lists now
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const count = () => $("#model-count").textContent;
  const ids = () => $$("#model-results .model-row .m-id").map((e) => e.textContent);
  const search = (text) => {
    $("#model-search").value = text;
    $("#model-search").dispatchEvent(new w.Event("input"));
  };
  const asOf = /as of (\d\d:\d\d today|\d{4} \w{3} \d\d at \d\d:\d\d)\./; // (a test run just after midnight sees yesterday's date)
  await until(() => $$(".seat").length === 2, "seats");
  await sleep(30);
  assert.equal(modelCalls.length, 0, "a saved copy under 12 hours old is used as it is");

  // The picker: Argon isn't in the saved copy, and the picker says how old that copy is.
  $$(".seat .model-button")[1].click();
  search("argon");
  assert.match($("#model-results .model-empty").textContent, /^No models match\. For a model that has only just appeared, press Refresh list\./);
  assert.match(count(), /^0 of 2 models, from OpenRouter’s list as of /);
  assert.match(count(), asOf);
  assert.equal($("#model-refresh").textContent, "Refresh list");
  assert.equal(modelCalls.length, 0, "a fresh enough copy isn't fetched again just for opening the picker");

  // Refresh list: a new list at once, past the browser's copy; the open picker shows it, the search kept.
  $("#model-refresh").click();
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0]?.cache, "no-store", "never the browser's copy from an earlier visit");
  assert.equal($("#model-refresh").textContent, "Refreshing…");
  assert.equal($("#model-refresh").disabled, true);
  assert.match(count(), /Getting a newer one…/);
  assert.equal(d.activeElement, $("#model-search"), "the keyboard stays in the search box");
  await until(() => !$("#model-refresh").disabled, "the new list");
  assert.equal($("#model-search").value, "argon", "the search is kept");
  assert.deepEqual(ids(), ["google/gemini-4-argon"]);
  assert.match(count(), /^1 of 3 models, from OpenRouter’s list as of \d\d:\d\d today\. Prices are dollars per million tokens, in \/ out\.$/);
  assert.ok(!$("#model-count").classList.contains("problem"));
  const stored = JSON.parse(w.localStorage.getItem("dialog.models.v6"));
  assert.equal(stored.models.length, 3, "the new list is saved");
  assert.ok(Math.abs(Date.now() - stored.at) < 5000, "with the time it was fetched");

  // Return chooses Argon; the card shows its price and its own thinking levels.
  $("#model-search").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const card = $$(".seat")[1];
  assert.equal(card.querySelector(".model-name").textContent, "Google: Gemini 4 Argon");
  assert.match(card.querySelector(".seat-model-info").textContent, /\$2 in, \$10 out per million tokens/);
  assert.deepEqual([...card.querySelector('select[aria-label="Thinking level"]').options].map((o) => o.textContent), ["high", "medium (default)", "low"]);

  // A refresh that fails keeps the list Dialog has, and says why.
  state.modelsStatus = 503;
  $$(".seat .model-button")[1].click();
  $("#model-refresh").click();
  await until(() => !$("#model-refresh").disabled, "the failed refresh");
  assert.match(count(), /^3 of 3 models, from OpenRouter’s list as of \d\d:\d\d today\. A newer list couldn’t be fetched\. OpenRouter answered with an error \(HTTP 503\)\./);
  assert.ok($("#model-count").classList.contains("problem"));
  assert.equal(ids().length, 3, "the list is kept");
  $("#model-cancel").click();

  // Twelve hours later, the page still open: opening the picker gets a new list by itself,
  // and the seat's own model stays highlighted when it arrives.
  state.modelsStatus = 0;
  state.models = { data: [...MODELS.data, ARGON, LATER] };
  const realNow = w.Date.now;
  w.Date.now = () => realNow.call(w.Date) + 13 * HOUR;
  try {
    $$(".seat .model-button")[1].click(); // Argon's seat: not the first row
    assert.equal($("#model-results .model-row.active .m-id").textContent, "google/gemini-4-argon");
    assert.equal(modelCalls.length, 3, "fetched as the picker opened");
    assert.equal($("#model-refresh").disabled, true);
    await until(() => !$("#model-refresh").disabled, "the list fetched on opening");
    assert.ok(ids().includes("some/later-model"));
    assert.equal($("#model-results .model-row.active .m-id").textContent, "google/gemini-4-argon", "the highlight stays on the seat's model");
    assert.ok(!$("#model-count").classList.contains("problem"), "the earlier trouble is forgotten");
    $("#model-cancel").click();
    $$(".seat .model-button")[0].click();
    assert.equal(modelCalls.length, 3, "and not again while the new list is fresh");
    $("#model-cancel").click();
  } finally {
    w.Date.now = realNow;
  }

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("a saved list over 12 hours old is shown at once and replaced when the page opens", async () => {
  const savedModels = {
    at: Date.now() - 13 * 60 * 60 * 1000,
    models: [{ id: "old/model", name: "Old: Model", inputPrice: 1, outputPrice: 1, contextLength: 1, inputModalities: ["text"], tools: true }],
  };
  const { d, modelCalls, errors } = makeHarness({ savedModels });
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  assert.equal(modelCalls.length, 1, "a new list asked for as the page opens");
  assert.equal(modelCalls[0]?.cache, "no-store");
  await until(() => $$(".seat .seat-model-info .id").length === 2, "the new list");
  d.querySelector(".seat .model-button").click();
  assert.deepEqual($$("#model-results .model-row .m-id").map((e) => e.textContent), ["anthropic/claude-opus-5.5", "x-ai/grok-4.7"]);
  assert.equal(modelCalls.length, 1, "opening the picker then needs no other");
  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("seat cards show the maker's logo and what a ~latest id stands for now; the picker sorts by price", async () => {
  const extra = [
    { id: "~openai/gpt-astra-latest", name: "OpenAI: GPT Astra Latest", alias_target: { name: "OpenAI: GPT-6 Astra", slug: "openai/gpt-6-astra" },
      pricing: { prompt: "0.00001", completion: "0.00005" }, architecture: { output_modalities: ["text"] }, supported_parameters: ["tools"] },
    { id: "inception/mercury-2.5", name: "Inception: Mercury 2.5", pricing: { prompt: "0.00000004", completion: "0.00000015" }, architecture: { output_modalities: ["text"] } },
    { id: "typesafe/jev-router", name: "TypeSafe: Jev Router", pricing: { prompt: "-1", completion: "-1" }, architecture: { output_modalities: ["text"] } },
  ];
  const { w, d, errors } = makeHarness({ models: { data: [...MODELS.data, ...extra] } });
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const card = (i) => $$(".seat")[i];
  const logo = (i) => card(i).querySelector(".seat-head .maker-logo");
  const info = (i) => card(i).querySelector(".seat-model-info").textContent;
  const search = (text) => {
    $("#model-search").value = text;
    $("#model-search").dispatchEvent(new w.Event("input"));
  };
  const choose = (i, text) => {
    card(i).querySelector(".model-button").click();
    search(text);
    $("#model-search").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  };
  const ids = () => $$("#model-results .model-row .m-id").map((e) => e.textContent);
  await until(() => $$(".seat .seat-model-info .id").length === 2, "model list");

  // The maker's logo, on the top line right of the seat's name, from where OpenRouter's own
  // pages get it; the maker's initial if it doesn't load.
  assert.equal(logo(0).tagName, "IMG");
  assert.equal(logo(0).parentElement.previousElementSibling.querySelector("input").getAttribute("aria-label"), "Seat name", "right after the name");
  assert.equal(card(0).querySelector(".model-button .maker-logo"), null, "not in the model button");
  assert.equal(logo(0).getAttribute("src"), "https://openrouter.ai/images/icons/Anthropic.svg");
  assert.equal(logo(0).getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(logo(1).getAttribute("src"), "https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://x.ai/&size=64");
  logo(1).dispatchEvent(new w.Event("error"));
  assert.equal(logo(1).tagName, "SPAN");
  assert.equal(logo(1).textContent, "S", "SpaceXAI, as OpenRouter names Grok's maker");

  // A ~latest id: under its name, just the id of the model it stands for now.
  choose(0, "astra latest");
  assert.equal(card(0).querySelector(".model-name").textContent, "OpenAI: GPT Astra Latest");
  assert.equal(card(0).querySelector(".seat-model-info .alias").textContent, "openai/gpt-6-astra");
  assert.match(card(0).querySelector(".seat-model-info .alias").title, /^~openai\/gpt-astra-latest stands for this model now/);
  assert.equal(logo(0).getAttribute("src"), "https://openrouter.ai/images/icons/OpenAI.svg");
  assert.equal(info(0), "openai/gpt-6-astra$10 in, $50 out per million tokens");
  // Other models have no such line.
  choose(1, "mercury");
  assert.equal(card(1).querySelector(".seat-model-info .alias"), null);
  // A maker Dialog has no logo for: its initial.
  assert.equal(logo(1).tagName, "SPAN");
  assert.equal(logo(1).textContent, "I");
  // A router's price varies.
  choose(1, "jev");
  assert.match(info(1), /Price varies: it passes each request to a model it chooses$/);

  // The picker sorts by name, or by price either way; routers last; the choice is remembered.
  card(1).querySelector(".model-button").click();
  assert.equal($("#model-sort").value, "name");
  assert.deepEqual(ids(), ["anthropic/claude-opus-5.5", "inception/mercury-2.5", "~openai/gpt-astra-latest", "x-ai/grok-4.7", "typesafe/jev-router"]);
  assert.equal($$("#model-results .model-row .m-price").at(-1).textContent, "varies / varies");
  const sortBy = (value) => {
    $("#model-sort").value = value;
    $("#model-sort").dispatchEvent(new w.Event("change"));
  };
  sortBy("in-asc");
  assert.deepEqual(ids(), ["inception/mercury-2.5", "x-ai/grok-4.7", "anthropic/claude-opus-5.5", "~openai/gpt-astra-latest", "typesafe/jev-router"]);
  assert.ok($$("#model-results .model-row")[0].classList.contains("active"), "from the top");
  assert.equal(d.activeElement, $("#model-search"), "the keyboard goes back to the search box");
  sortBy("in-desc");
  assert.deepEqual(ids(), ["~openai/gpt-astra-latest", "anthropic/claude-opus-5.5", "x-ai/grok-4.7", "inception/mercury-2.5", "typesafe/jev-router"]);
  sortBy("out-asc");
  search("o"); // the search still narrows the list, in the chosen order
  assert.deepEqual(ids(), ["inception/mercury-2.5", "x-ai/grok-4.7", "anthropic/claude-opus-5.5", "~openai/gpt-astra-latest", "typesafe/jev-router"]);
  search("gro");
  assert.deepEqual(ids(), ["x-ai/grok-4.7"]);
  assert.equal(w.localStorage.getItem("dialog.modelSort.v1"), JSON.stringify("out-asc"));
  $("#model-cancel").click();
  card(0).querySelector(".model-button").click();
  assert.equal($("#model-sort").value, "out-asc", "still sorted that way next time");
  assert.equal(ids()[0], "inception/mercury-2.5");
  $("#model-cancel").click();

  // A folded (sleeping) card keeps the logo beside its name.
  card(0).querySelector("label.sleep input").click();
  const folded = $(".seat.asleep");
  assert.equal(folded.querySelector(".seat-head .maker-logo").getAttribute("src"), "https://openrouter.ai/images/icons/OpenAI.svg");

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("a message ending with “privately” is private to whom it's for, by Return, ⌘↩ or Speak, and never added for everyone; open particulars are saved", async () => {
  const { w, d, chatCalls, replies, blobs, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const entries = () => $$("#transcript .entry");
  const notBusy = () => $$(".seat .speak").every((b) => !b.disabled && !b.hidden);
  const hint = () => $("#composer-hint").textContent;
  const dir = (i) => entries()[i].querySelector(".direction")?.textContent;
  const body = (i) => entries()[i].querySelector(".body").textContent.trim();
  const type = (t) => {
    $("#composer-text").value = t;
    $("#composer-text").dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const enter = (extra = {}) => $("#composer-text").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...extra }));
  const speakOn = (name) => $$(".seat").find((c) => c.querySelector(".seat-head input[type=text]").value === name).querySelector(".speak").click();
  await until(() => $$(".seat").length === 2, "seats");
  $$(".seat .seat-head button")[0].click(); // + copy: Claude, Claude 2, Grok

  // No one named, and no one has spoken: nothing can be sent, and nothing is.
  type("Just between us, privately");
  assert.equal(hint(), "Say whom it’s for: “…, Grok, privately”");
  assert.ok($("#composer").classList.contains("private-mode"), "the box turns parchment");
  assert.equal($("#composer-send").disabled, true);
  enter();
  enter({ ctrlKey: true });
  await sleep(20);
  assert.equal(entries().length, 0, "not added for everyone");
  assert.equal($("#composer-text").value, "Just between us, privately", "it stays in the box");
  type("Just between us");
  assert.ok(!$("#composer").classList.contains("private-mode"));

  // Named: as if To: had named Grok.
  type("Be contrarian, Grok, privately.");
  assert.equal(hint(), "Enter sends privately; Grok replies · Ctrl+Enter just adds it privately");
  assert.equal($("#composer-send").textContent, "Add privately");
  replies.push({ pieces: ["Understood."], cost: 0.001 });
  enter();
  await until(() => notBusy() && entries().length === 2, "Grok's private reply");
  assert.equal(body(0), "Be contrarian.");
  assert.deepEqual([dir(0), dir(1)], ["(privately, to Grok)", "(privately, to Bill)"]);
  assert.ok(entries().every((e) => e.classList.contains("private")));
  assert.equal(chatCalls[0].session_id, "dialog-B");
  assert.match(JSON.stringify(chatCalls[0].messages), /Bill says \(privately, only you can see this\):\\nBe contrarian\./);

  // Several: a private exchange of their own, in turn; Claude 2 sees none of it.
  type("Compare notes, Claude and Grok, privately");
  assert.equal(hint(), "Enter sends privately; Claude and Grok reply in turn · Ctrl+Enter just adds it privately");
  replies.push({ pieces: ["P-ONE"], cost: 0.001 }, { pieces: ["P-TWO"], cost: 0.001 });
  enter();
  await until(() => notBusy() && entries().length === 5, "the private pair");
  assert.deepEqual([dir(2), dir(3), dir(4)], ["(privately, to Claude and Grok, in turn)", "(privately, to Bill and Grok)", "(privately, to Bill and Claude)"]);
  assert.match(JSON.stringify(chatCalls[1].messages), /Bill says \(privately, only you and Grok can see this; to Claude and Grok, each replying in turn\):\\nCompare notes/);
  assert.match(JSON.stringify(chatCalls[2].messages), /Claude says \(privately; only Bill and you can see this\):\\nP-ONE/);
  replies.push({ pieces: ["Public view."], cost: 0.002 });
  speakOn("Claude 2");
  await until(() => notBusy() && entries().length === 6, "Claude 2");
  assert.doesNotMatch(JSON.stringify(chatCalls[3].messages), /contrarian|Compare notes|P-ONE|P-TWO|Understood/, "an outsider sees nothing private");

  // Naming no one now: whoever spoke last in the open conversation (Claude 2). ⌘↩ just adds it privately.
  type("And you, privately");
  assert.equal(hint(), "Enter sends privately; Claude 2 replies · Ctrl+Enter just adds it privately");
  enter({ ctrlKey: true });
  await sleep(20);
  assert.equal(entries().length, 7);
  assert.equal(dir(6), "(privately, to Claude 2)");
  assert.equal(body(6), "And you");
  assert.equal(chatCalls.length, 4, "no one asked");

  // Speak with a private message in the box: privately to that card's participant.
  type("Only for you, privately");
  replies.push({ pieces: ["Got it."], cost: 0.001 });
  speakOn("Grok");
  await until(() => notBusy() && entries().length === 9, "Grok, privately");
  assert.deepEqual([dir(7), dir(8)], ["(privately, to Grok)", "(privately, to Bill)"]);

  // While a reply is arriving, a private message waits in the box.
  replies.push({ pieces: ["slow"], slow: true });
  speakOn("Claude");
  await until(() => $$(".seat.speaking").length === 1, "Claude under way");
  type("Hold on, Grok, privately");
  assert.equal(hint(), "Wait until the replies have finished to send this privately");
  enter();
  enter({ ctrlKey: true });
  await sleep(20);
  assert.equal($("#composer-text").value, "Hold on, Grok, privately");
  $(".seat.speaking .seat-actions button.danger").click();
  await until(() => notBusy(), "stopped");
  assert.equal(entries().length, 10, "nothing else added");

  // Saved: the private pair marked, and the particulars of the reply that's open on screen.
  const publicReply = entries()[5];
  publicReply.querySelector("button.glance").click();
  $("#btn-save").click();
  const saved = squash(await blobs.at(-1).text());
  assert.ok(saved.includes('<span class="direction">(privately, to Claude and Grok, in turn)</span>'));
  assert.ok(saved.includes('<span class="direction">(privately, to Bill and Grok)</span>'));
  assert.equal((saved.match(/class="foot details"/g) ?? []).length, 1, "only the one that's open");
  const details = saved.match(/<div class="foot details">.*?<\/div>/)?.[0] ?? "";
  assert.match(
    details,
    /<div class="foot details"><p>Model: resolved\/model \(for anthropic\/claude-opus-5\.5\); thinking: high \(default\)\. ?<\/p><table class="costs"><tr><th>Reading<\/th><td class="tokens">50 tokens<\/td><td><\/td><td class="about">about<\/td><td class="amount">\$0\.00<\/td><\/tr><tr><th>Writing<\/th><td class="tokens">10 tokens<\/td><td>\(4 of them thinking\)<\/td><td class="about">about<\/td><td class="amount">\$0\.00<\/td><\/tr><tr class="total"><th>Total<\/th><td class="tokens"><\/td><td><\/td><td class="about"><\/td><td class="amount">\$0\.00<\/td><\/tr><\/table><p>Speed: /,
  );

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("LM Studio: a dialog with only local models needs no OpenRouter key; the picker lists LM Studio's models first", async () => {
  const LOCAL = {
    data: [
      { id: "google/gemma-4-31b-qat", type: "vlm", state: "loaded", max_context_length: 262144, loaded_context_length: 8192 },
      { id: "qwen/qwen3.8-27b", type: "vlm", state: "not-loaded", max_context_length: 262144 },
      { id: "text-embedding-nomic-embed-text-v1.5", type: "embeddings", state: "not-loaded", max_context_length: 2048 },
    ],
  };
  const chats = []; // { url, headers, body } of every chat request
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (!/Not implemented/.test(String(e.message))) errors.push(e);
  });
  const page = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/local.html",
    virtualConsole: vc,
    beforeParse(win) {
      win.fetch = async (url, init = {}) => {
        if (url === "http://localhost:1234/api/v0/models") return new Response(JSON.stringify(LOCAL));
        if (url.startsWith("https://openrouter.ai/") && url.endsWith("/models")) return new Response(JSON.stringify(MODELS));
        if (url === "http://localhost:1234/v1/chat/completions") {
          chats.push({ url, headers: init.headers, body: JSON.parse(init.body) });
          const lines = [
            { model: "google/gemma-4-31b-qat", choices: [{ delta: { reasoning_content: "Hmm." } }] },
            { model: "google/gemma-4-31b-qat", choices: [{ delta: { content: "Hello, Bill." } }] },
            { choices: [], usage: { prompt_tokens: 22, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 25 } } },
          ];
          return new Response(lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200 });
        }
        throw new Error("unexpected URL " + url);
      };
      win.TextDecoder = TextDecoder;
      win.alert = (m) => errors.push(new Error("unexpected alert: " + m));
      win.localStorage.clear();
      win.localStorage.setItem(
        "dialog.settings.v1",
        JSON.stringify({
          humanName: "Bill",
          localServer: "http://localhost:1234",
          seats: [{ id: "G", name: "Gemma 4 31B QAT", model: "lmstudio/google/gemma-4-31b-qat", role: "", effort: "default", color: "#8e44ad" }],
        }),
      );
    },
  });
  const pw = page.window;
  const pd = pw.document;
  const $ = (sel) => pd.querySelector(sel);
  const $$ = (sel) => [...pd.querySelectorAll(sel)];
  const seats = () => $$("#seat-list .seat");
  const info = (i) => seats()[i].querySelector(".seat-model-info").textContent;

  // No key, but an LM Studio address: nothing asks for a key.
  assert.equal($("#banner").hidden, true);
  assert.ok(!$("#transcript .empty").textContent.includes("OpenRouter API key"));
  await until(() => /In LM Studio on this computer, loaded/.test(info(0)), "LM Studio's list");
  assert.match(info(0), /^lmstudio\/google\/gemma-4-31b-qat/);
  assert.match(info(0), /No web search or page reading/);
  assert.equal(seats()[0].querySelector(".model-button .model-name").textContent, "Gemma 4 31B QAT (LM Studio)");
  assert.equal(seats()[0].querySelector('select[aria-label="Thinking level"]').disabled, true);

  // Gemma replies, from LM Studio, without the OpenRouter key or OpenRouter's extras.
  $("#composer-text").value = "Hello, Gemma.";
  seats()[0].querySelector("button.speak").click();
  await until(() => $("#transcript .entry.bot") && !$("#transcript .entry.streaming"), "Gemma's reply");
  assert.equal(chats.length, 1);
  assert.equal(chats[0].headers.Authorization, undefined);
  assert.equal(chats[0].body.model, "google/gemma-4-31b-qat");
  assert.equal(chats[0].body.tools, undefined);
  const reply = $("#transcript .entry.bot");
  assert.equal(reply.querySelector(".body").textContent.trim(), "Hello, Bill.");
  assert.equal(reply.querySelector(".err"), null);
  assert.equal(reply.querySelector(".cost"), null, "no cost for a local model");
  assert.equal($("#session-cost").textContent, "This conversation: $0.00");

  // The picker: LM Studio's chat models first (not its embedding model), then OpenRouter's.
  $("#btn-add-seat").click();
  await until(() => /from LM Studio, listed first/.test($("#model-count").textContent), "both lists in the picker");
  const rows = $$("#model-results .model-row");
  assert.deepEqual(rows.slice(0, 2).map((r) => r.querySelector(".m-name").textContent), ["Gemma 4 31B QAT (LM Studio)", "Qwen3.8 27B (LM Studio)"]);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.querySelector(".m-price").textContent), ["loaded", "this computer"]);
  assert.equal(rows.length, 4, "two of LM Studio's, two of OpenRouter's");
  assert.match($("#model-count").textContent, /2 of 2 from LM Studio, listed first\./);
  rows[1].click();
  assert.equal(seats()[1].querySelector(".seat-head input").value, "Qwen3.8 27B", "named after the model itself");

  await sleep(20);
  assert.deepEqual(errors.map(String), [], "no script errors");
});

test("LM Studio: clicking into the empty Settings box fills in the usual address; one typed in is left alone", async () => {
  const page = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/local-field.html",
    beforeParse(win) {
      win.fetch = async (url) => (url.endsWith("/models") ? new Response(JSON.stringify(MODELS)) : new Response("{}", { status: 500 }));
      win.TextDecoder = TextDecoder;
      win.localStorage.clear();
    },
  });
  const pw = page.window;
  const field = pw.document.querySelector("#set-local");
  pw.document.querySelector("#btn-settings").click();
  assert.equal(field.value, "");
  assert.equal(field.placeholder, "http://localhost:1234");
  field.focus();
  assert.equal(field.value, "http://localhost:1234");
  assert.equal(field.selectionStart, 0);
  assert.equal(field.selectionEnd, field.value.length, "selected, so typing replaces it");
  field.blur();
  field.value = "http://localhost:4321";
  field.dispatchEvent(new pw.Event("input"));
  field.focus();
  assert.equal(field.value, "http://localhost:4321");
  pw.document.querySelector("#settings-dialog").close?.();
  await sleep(450);
  assert.equal(JSON.parse(pw.localStorage.getItem("dialog.settings.v1")).localServer, "http://localhost:4321");
});

test("arriving text is followed only while you're at the bottom; scrolled back, the conversation stays put", async () => {
  const { w, d, replies, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const notBusy = () => !$("#transcript .entry.streaming");
  const seatCards = () => $$("#seat-list .seat");
  const speakBtn = (i) => seatCards()[i].querySelector("button.speak");
  await until(() => seatCards().length === 2, "seats");
  // jsdom lays nothing out, so give the conversation a size: 2,000 px of it in a 500 px window.
  const t = $("#transcript");
  let top = 0;
  Object.defineProperty(t, "scrollHeight", { get: () => 2000, configurable: true });
  Object.defineProperty(t, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(t, "scrollTop", { get: () => top, set: (v) => (top = Math.min(v, 1500)), configurable: true });
  const scrollTo = (v) => {
    top = v;
    t.dispatchEvent(new w.Event("scroll"));
  };

  // At the bottom: the reply is followed as it grows (growing fires no scroll event).
  scrollTo(1500);
  replies.push({ pieces: ["One ", "two."], cost: 0.001 });
  speakBtn(0).click();
  top = 1200;
  await until(() => notBusy(), "the first reply");
  assert.equal(top, 1500, "followed to the bottom");

  // Scrolled back a little, to read: the next reply comes in below, and the view stays put throughout.
  scrollTo(1450);
  replies.push({ thinking: ["Hmm."], pieces: ["Three ", "four."], cost: 0.001, pause: true });
  speakBtn(1).click();
  assert.equal(top, 1450, "not moved when the reply begins");
  await until(() => notBusy(), "the second reply");
  assert.equal(top, 1450, "nor while it arrives or when it ends");

  // Your own message brings you back to the bottom, and the replies are followed again.
  $("#composer-text").value = "Go on.";
  $("#composer-text").dispatchEvent(new w.Event("input", { bubbles: true }));
  $("#composer-send").click();
  assert.equal(top, 1500, "your message shown");
  replies.push({ pieces: ["Five."], cost: 0.001 });
  speakBtn(0).click();
  top = 1000;
  await until(() => notBusy(), "the third reply");
  assert.equal(top, 1500, "followed again");
  assert.deepEqual(errors, []);
});

test("a reply that used the web: a new paragraph after each pause, and its searches in the particulars", async () => {
  const { d, replies, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const notBusy = () => !$("#transcript .entry.streaming");
  const seatCards = () => $$("#seat-list .seat");
  await until(() => seatCards().length === 2, "seats");
  replies.push({
    pieces: ["Opening the release page as requested.", "**Version:** 26.12.1", " is the latest."],
    pauses: [1, 2], // the second pause is mid-sentence: no break there
    web: { web_search_requests: 2 },
    cost: 0.28,
  });
  seatCards()[0].querySelector("button.speak").click();
  await until(() => notBusy(), "the reply");
  const reply = $$("#transcript .entry").at(-1);
  assert.deepEqual(
    [...reply.querySelectorAll(".body p")].map((p) => p.innerHTML),
    ["Opening the release page as requested.", "<strong>Version:</strong> 26.12.1 is the latest."],
  );
  reply.querySelector("header .glance").click();
  const cells = [...$$("#transcript .entry").at(-1).querySelectorAll(".foot .costs > span")].map((x) => x.textContent);
  assert.equal(cells[cells.indexOf("Web") + 2], "2 searches");
  assert.deepEqual(errors, []);
});

test("copying turns: just the turns as on screen, with the model and no cost; a piece of one turn's text is left to the browser", async () => {
  const { w, d, replies, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const notBusy = () => !$("#transcript .entry.streaming");
  const seatCards = () => $$("#seat-list .seat");
  await until(() => seatCards().length === 2, "seats");
  $("#composer-text").value = "What is time?";
  $("#composer-text").dispatchEvent(new w.Event("input", { bubbles: true }));
  $("#composer-send").click();
  replies.push({ pieces: ["Change, ", "mostly.\n\nAnd memory."], cost: 0.0213 });
  seatCards()[0].querySelector("button.speak").click();
  await until(() => notBusy(), "the reply");
  const [q, r] = $$("#transcript .entry");

  /** Copy with this range selected: what went on the clipboard, or null if left to the browser. */
  const copy = (range) => {
    const sel = w.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const data = {};
    const ev = new w.Event("copy", { bubbles: true, cancelable: true });
    ev.clipboardData = { setData: (type, value) => (data[type] = value) };
    $("#transcript").dispatchEvent(ev);
    return ev.defaultPrevented ? data : null;
  };
  const text = (el) => el.querySelector(".body p").firstChild;

  // From the middle of the question to the middle of the reply's first paragraph.
  const across = d.createRange();
  across.setStart(text(q), 8);
  across.setEnd(text(r), 6);
  const got = copy(across);
  assert.ok(got, "taken over");
  const html = got["text/html"];
  assert.ok(html.startsWith("<table"));
  assert.ok(!/class=|<button|<input|\$0\.0213|tok\/s/.test(html), "no controls, no cost or speed");
  assert.ok(html.includes(">Bill</div>") && html.includes(">Claude</div>"));
  assert.ok(html.includes('>resolved/<wbr><span style="white-space: nowrap;">model</span></div>'), "the model under the name");
  assert.ok(html.includes(">time?</p>"), "the question from where the selection starts");
  assert.ok(html.includes(">Change</p>") && !html.includes("memory"), "the reply up to where it ends");
  assert.match(got["text/plain"], /Bill\ntime\?\n\n\d\d:\d\d Claude\n[^\n]+\nChange$/);

  // A piece of one turn's text: the browser's own copy.
  const piece = d.createRange();
  piece.setStart(text(r), 0);
  piece.setEnd(text(r), 6);
  assert.equal(copy(piece), null);

  // One whole turn, name and all: taken over.
  const whole = d.createRange();
  whole.selectNode(r);
  assert.ok(copy(whole)["text/html"].includes("memory."));

  // Everything (Select All): just the conversation.
  const all = d.createRange();
  all.selectNodeContents(d.body);
  const everything = copy(all);
  assert.equal((everything["text/html"].match(/<tr/g) ?? []).length, 2);
  assert.ok(!everything["text/plain"].includes("Participants") && !everything["text/plain"].includes("Save All"));
  assert.deepEqual(errors, []);
});

test("clicking the medallion or the name shows the version under the name; clicking again hides it", async () => {
  const { d, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  await until(() => $("#brand"), "the top bar");
  const version = $("#brand-version");
  assert.equal(version.hidden, true, "hidden at first");
  assert.match(version.textContent, /^Version \d+\.\d+(\.\d+)?$/);
  assert.equal(version.textContent, $("#set-version").textContent, "the same as in Settings");
  $(".topbar .medallion").click();
  assert.equal(version.hidden, false, "shown by the medallion");
  assert.equal($("#brand").getAttribute("aria-expanded"), "true");
  $(".topbar .wordmark").click();
  assert.equal(version.hidden, true, "hidden again by the name");
  assert.equal($("#brand").getAttribute("aria-expanded"), "false");
  assert.deepEqual(errors, []);
});

test("tabs: leaving or reloading never asks, and the tab's conversation is kept; ⌘-click on New conversation opens an empty tab", async () => {
  const { w, d, errors } = makeHarness();
  const $ = (sel) => d.querySelector(sel);
  for (const text of ["What is time?", "And space?"]) {
    $("#composer-text").value = text;
    $("#composer-send").click();
  }
  const ev = new w.Event("beforeunload", { cancelable: true });
  w.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false, "the browser doesn't ask");
  assert.equal(JSON.parse(w.sessionStorage.getItem("dialog.session.v1")).entries.length, 2, "kept for a reload");

  const opened = [];
  w.HTMLAnchorElement.prototype.click = function () {
    opened.push([this.getAttribute("href"), this.target, this.rel]);
  };
  assert.match($("#btn-new").title, /⌘-click/);
  $("#btn-new").dispatchEvent(new w.MouseEvent("click", { metaKey: true, bubbles: true }));
  assert.deepEqual(opened, [["/index.html#new", "_blank", "noopener"]], "opened as a link, which Safari puts in a tab");
  assert.equal(d.querySelectorAll("#transcript .entry").length, 2, "this tab's conversation stays");

  // The new tab, even with this tab's storage copied into it: empty, with the latest settings.
  const copied = Object.fromEntries(Object.keys(w.sessionStorage).map((k) => [k, w.sessionStorage.getItem(k)]));
  const fresh = makeHarness({ url: "http://localhost/index.html#new", tab: copied });
  assert.equal(fresh.d.querySelectorAll("#transcript .entry").length, 0);
  assert.ok(fresh.d.querySelector("#transcript .empty"), "the welcome shown");
  assert.equal(fresh.w.location.href, "http://localhost/index.html", "the marker taken off");
  const seatNames = [...fresh.d.querySelectorAll("#seat-list .seat .seat-head input[type=text]")].map((i) => i.value);
  assert.deepEqual(seatNames, ["Claude", "Grok"], "the latest participants");
  assert.deepEqual(errors, []);
  assert.deepEqual(fresh.errors, []);
});
