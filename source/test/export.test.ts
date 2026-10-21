import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationFileName, conversationHtml, escapeHtml, firstSentence } from "../src/export";
import { defaultSettings } from "../src/engine";
import type { Entry, Seat, Settings } from "../src/types";

// A stand-in for the page's Markdown renderer: escape, wrap in <p>.
const render = (md: string) => `<p>${escapeHtml(md)}</p>`;

function setup(): Settings {
  const s = defaultSettings();
  s.humanName = "Bill";
  s.aboutHuman = "Retired engineer.";
  s.seats = [
    { id: "A", name: "Claude", model: "anthropic/claude-opus-5.5", role: "Be brief.", effort: "default", color: "#c96442" },
    { id: "B", name: "Grok", model: "x-ai/grok-4.7", role: "", effort: "low", color: "#6b7280" },
  ];
  return s;
}
const T = "2026-10-07T22:03:00.000Z";
let n = 0;
const human = (text: string, extra: Partial<Entry> = {}): Entry => ({ id: `h${n++}`, speaker: "human", speakerName: "Bill", text, time: T, ...extra });
const bot = (seat: Seat, text: string, extra: Partial<Entry> = {}): Entry => ({
  id: `b${n++}`, speaker: seat.id, speakerName: seat.name, text, time: T, status: "done", model: seat.model, seatModel: seat.model, ...extra,
});
const opusInfo = {
  id: "anthropic/claude-opus-5.5", name: "Opus", inputPrice: 4, outputPrice: 20, contextLength: 1, inputModalities: ["text", "image", "file"],
  reasoning: { efforts: ["max", "xhigh", "high", "medium", "low"], defaultEffort: "high", mandatory: true },
  tools: true,
};

test("whole conversation: participants, private marks, files, sources, costs; failures left out", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  const entries: Entry[] = [
    human("What is time?", {
      attachments: [
        { id: "f1", name: "notes.md", kind: "text", mime: "text/markdown", size: 20, tokens: 5, data: "<script>x</script> Time is a river." },
        { id: "f2", name: "orbit.png", kind: "image", mime: "image/png", size: 100, data: "data:image/png;base64,AAAA" },
        { id: "f3", name: "paper.pdf", kind: "pdf", mime: "application/pdf", size: 900, data: "data:application/pdf;base64,JVBERi0=" },
        { id: "f4", name: "gone.txt", kind: "text", mime: "text/plain", size: 9 },
      ],
    }),
    bot(A, "Change.", { cost: 0.02, citations: [{ url: "https://example.com", title: "Example" }, { url: "javascript:alert(1)", title: "bad" }] }),
    human("Psst", { privateWith: "B" }),
    bot(B, "Secret.", { privateWith: "B", cost: 0.01 }),
    bot(B, "broken", { status: "error", error: "x" }),
    bot(B, "cut", { status: "stopped", cost: 0.005 }),
    bot(A, "old model", { seatModel: "anthropic/claude-sonnet-5.5" }),
  ];
  const html = conversationHtml({ startedAt: T, entries }, s, { render, models: [opusInfo], savedAt: new Date(2026, 9, 7, 22, 5), logo: "data:image/png;base64,LOGO" });

  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(!/<script/i.test(html), "no scripts at all, including from file contents");
  assert.ok(html.includes('<img class="medallion" src="data:image/png;base64,LOGO"'));
  assert.match(html, /Started 2026 Oct 0\d at \d\d:\d\d\. Saved 2026 Oct 07 at 22:05\./);
  // Participants
  assert.ok(html.includes("<span class=\"name\">Bill</span>, human moderator<blockquote><p>Retired engineer.</p></blockquote>"));
  assert.ok(html.includes("<span class=\"name\">Claude</span>, <code>anthropic/claude-opus-5.5</code>, thinking: high (default)<blockquote><p>Be brief.</p></blockquote>"));
  assert.ok(html.includes("<span class=\"name\">Grok</span>, <code>x-ai/grok-4.7</code>, thinking: low</li>"));
  assert.ok(html.includes("Participants could search the web and read web pages unless noted."));
  // Turns
  assert.ok(html.includes('<span class="direction">(privately, to Grok)</span>'));
  assert.ok(html.includes('<span class="direction">(privately, to Bill)</span>'));
  assert.ok(!html.includes("broken"), "failed replies are left out");
  assert.ok(html.includes("<span>stopped early</span>"));
  assert.ok(!html.includes('class="time"'), "no per-turn times in the whole-conversation file");
  assert.ok(html.includes('<span class="model">anthropic/claude-sonnet-5.5</span>'), "model noted where it differs");
  assert.equal(html.split('class="model"').length - 1, 1);
  // Files
  assert.ok(html.includes("<details class=\"file\"><summary>notes.md (text, 20 bytes, about 5 tokens)</summary><pre>&lt;script&gt;x&lt;/script&gt; Time is a river.</pre></details>"));
  assert.ok(html.includes('<img src="data:image/png;base64,AAAA" alt="orbit.png">'));
  assert.ok(html.includes('<p class="file">paper.pdf (PDF, 900 bytes)</p>'));
  assert.ok(!html.includes("JVBERi0="), "PDF contents not embedded");
  assert.ok(html.includes('gone.txt (text, 9 bytes) <span class="gone">no longer available</span>'));
  // Sources: only web links
  assert.ok(html.includes('<a href="https://example.com">Example</a>'));
  assert.ok(!html.includes("javascript:"));
  // Costs
  assert.ok(html.includes("<span>$0.0200</span>"));
  assert.ok(html.includes("Total reported cost: $0.0350"));
});

test("a reply is marked with its model and thinking level when either differs from the seat's now", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  const entries: Entry[] = [
    bot(A, "same as now", { seatEffort: "default" }),
    bot(A, "thought less", { seatEffort: "low" }),
    bot(A, "other model", { seatModel: "anthropic/claude-sonnet-5.5", seatEffort: "default" }),
    bot(B, "older reply, level not recorded"),
    { ...bot(B, "seat since removed", { seatEffort: "high" }), speaker: "Z", speakerName: "Gone" },
  ];
  const html = conversationHtml({ startedAt: T, entries }, s, { render, models: [opusInfo] });
  const notes = [...html.matchAll(/<span class="model">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(notes, [
    "anthropic/claude-opus-5.5, thinking: low",
    "anthropic/claude-sonnet-5.5, thinking: model’s default",
    "x-ai/grok-4.7, thinking: high",
  ]);
});

test("names and roles are escaped", () => {
  const s = setup();
  s.humanName = "<b>Bill</b>";
  (s.seats[0] as Seat).name = 'Claude "<i>"';
  const html = conversationHtml({ startedAt: T, entries: [human("hi", { speakerName: s.humanName })] }, s, { render });
  assert.ok(!html.includes("<b>Bill</b>") && html.includes("&lt;b&gt;Bill&lt;/b&gt;"));
  assert.ok(html.includes("Claude &quot;&lt;i&gt;&quot;"));
});

test("only the ticked turns, and only the participants who speak in them", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  const q = human("What is time?");
  const a = bot(A, "Change.", { cost: 0.02 });
  const b = bot(B, "A river.", { cost: 0.01 });
  const broken = bot(B, "broken", { status: "error", error: "x" });
  const session = { startedAt: T, entries: [q, a, b, broken] };
  const html = conversationHtml(session, s, { render, savedAt: new Date(2026, 9, 7, 22, 5), only: new Set([a.id, broken.id]) });

  assert.ok(html.includes("<p>Change.</p>"));
  assert.ok(!html.includes("What is time?") && !html.includes("A river.") && !html.includes("broken"));
  assert.ok(html.includes('<span class="name">Claude</span>'));
  assert.ok(!html.includes('<span class="name">Grok</span>'), "Grok has no ticked turn");
  assert.ok(!html.includes("human moderator"), "nor has Bill");
  assert.ok(!html.includes("Quoted under Bill"));
  assert.match(html, /1 turn chosen from a conversation started 2026 Oct 0\d at \d\d:\d\d\. Saved 2026 Oct 07 at 22:05\./);
  assert.ok(html.includes("Reported cost of these turns: $0.0200"));
  assert.ok(html.includes("<title>Dialog, 2026 Oct 0"));

  const two = conversationHtml(session, s, { render, only: new Set([q.id, b.id]) });
  assert.ok(two.includes("human moderator") && two.includes('<span class="name">Grok</span>'));
  assert.ok(!two.includes('<span class="name">Claude</span>'));
  assert.ok(two.includes("2 turns chosen"));

  const all = conversationHtml(session, s, { render, only: new Set() });
  assert.ok(all.includes("Started ") && all.includes("Total reported cost: $0.0300"), "an empty selection means everything");
});

test("only the first sentence of About you is shown", () => {
  const s = setup();
  s.aboutHuman = "Retired engineer, Ph.D. in physics, e.g. Kepler's orbits. Lives in California. Likes J. S. Bach.";
  const html = conversationHtml({ startedAt: T, entries: [human("hi")] }, s, { render });
  assert.ok(html.includes("<blockquote><p>Retired engineer, Ph.D. in physics, e.g. Kepler&#39;s orbits.</p></blockquote>"));
  assert.ok(!html.includes("California"));
  assert.ok(html.includes("Quoted under Bill: the first sentence of what every participant was told about Bill."));

  assert.deepEqual(firstSentence("One sentence only."), { sentence: "One sentence only.", more: false });
  assert.deepEqual(firstSentence("  Is it? Yes!  "), { sentence: "Is it?", more: true });
  assert.deepEqual(firstSentence("A first line\nthen more."), { sentence: "A first line", more: true });
  assert.deepEqual(firstSentence("Dr. Smith said so. Then left."), { sentence: "Dr. Smith said so.", more: true });
  assert.deepEqual(firstSentence("Pi is 3.14 or so. Roughly."), { sentence: "Pi is 3.14 or so.", more: true });
  assert.deepEqual(firstSentence(""), { sentence: "", more: false });
});

test("file names", () => {
  assert.equal(conversationFileName(new Date(2026, 9, 7, 22, 5)), "Dialog 2026 Oct 07 2205.html");
  assert.equal(conversationFileName(new Date(2026, 9, 7, 22, 5), true), "Dialog 2026 Oct 07 2205 selected.html");
});

test("files the participants made: drawings shown, contents in a section to open, no live code", () => {
  const s = setup();
  const [A] = s.seats as [Seat];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>';
  const page = "<html><body><script>steal()</script></body></html>";
  const html = conversationHtml(
    {
      startedAt: T,
      entries: [
        bot(A, "Two files.", {
          made: [
            { id: "m1", name: "orbit.svg", kind: "svg", size: svg.length, data: svg },
            { id: "m2", name: "tool.html", kind: "html", size: page.length, data: page, incomplete: true },
            { id: "m3", name: "old.md", kind: "md", size: 9, removed: true },
            { id: "m4", name: "lost.txt", kind: "txt", size: 9 },
          ],
        }),
      ],
    },
    s,
    { render },
  );
  assert.ok(!/<script/i.test(html), "no scripts, from the files or anywhere");
  assert.ok(html.includes('<p class="files-label">Files made</p>'));
  assert.ok(html.includes('<figure class="file"><img src="data:image/svg+xml;charset=utf-8,%3Csvg%20'), "the drawing shown as an image");
  assert.ok(html.includes("<summary>orbit.svg (drawing, 86 bytes)</summary><pre>&lt;svg xmlns="));
  assert.ok(html.includes("<summary>tool.html (web page, 50 bytes) (may be incomplete)</summary><pre>&lt;html&gt;&lt;body&gt;&lt;script&gt;steal()"));
  assert.ok(html.includes('<p class="file">old.md (Markdown, 9 bytes) <span class="gone">removed</span></p>'));
  assert.ok(html.includes('<p class="file">lost.txt (text, 9 bytes) <span class="gone">no longer available</span></p>'));
});

test("a reply whose particulars are open on screen is saved with them; a private exchange with several is marked", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  const usage = { promptTokens: 12345, completionTokens: 1480, reasoningTokens: 1310, cachedTokens: 10000, cacheWriteTokens: 2000 };
  const r = bot(A, "Change.", { cost: 0.0213, usage, seatEffort: "default", timing: { totalMs: 21300, firstTextMs: 15800 } });
  const pair = [{ id: "A", name: "Claude" }, { id: "B", name: "Grok" }];
  const q = human("Psst", { privateWith: ["A", "B"], addressedTo: { seats: pair, how: "independently" } });
  const g = bot(B, "Mine.", { privateWith: ["A", "B"], cost: 0.001 });
  const html = conversationHtml({ startedAt: T, entries: [r, q, g] }, s, { render, models: [opusInfo], details: new Set([r.id]) });
  assert.ok(
    html.includes(
      '<div class="foot details"><p>Model: anthropic/claude-opus-5.5; thinking: high (default).</p>' +
        "<p>Cost: $0.0213, for 12,345 tokens read (10,000 at the re-read discount, 2,000 stored for re-reading); 1,480 written (1,310 of them thinking).</p>" +
        "<p>Speed: 1,480 tokens written (1,310 of them thinking) in 21.3 s from pressing Speak to the last word: 69 tokens per second overall.",
    ),
  );
  assert.ok(html.includes('<div class="foot"><span>$0.0010</span></div>'), "the others keep the short version");
  assert.ok(html.includes('<span class="direction">(privately, to Claude and Grok, independently)</span>'));
  assert.ok(html.includes('<span class="direction">(privately, to Bill and Claude)</span>'));
  assert.ok(html.includes('<article class="turn bot private"'));
  const none = conversationHtml({ startedAt: T, entries: [r] }, s, { render, models: [opusInfo] });
  assert.ok(!none.includes("foot details"), "none open: none saved");
});
