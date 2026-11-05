import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationFileName, conversationHtml, copiedHtml, copiedText, escapeHtml, firstSentence, savedConversationText, type CopiedTurn } from "../src/export";
import { conversationData } from "../src/storage";
import { defaultSettings, formatTime, noteChanges, settleChanges, turnStamp } from "../src/engine";
import type { Entry, Seat, Session, Settings } from "../src/types";

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
  id: "anthropic/claude-opus-5.5", name: "Opus", inputPrice: 4, outputPrice: 20, cacheReadPrice: 0.4, cacheWritePrice: 5, contextLength: 1, inputModalities: ["text", "image", "file"],
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
  assert.ok(html.includes('<summary><span class="name">Bill</span> <span class="gist">human moderator</span></summary><blockquote><p>Retired engineer.</p></blockquote>'));
  assert.ok(html.includes('<summary><span class="name">Claude</span> <span class="gist role-start">Be brief.</span></summary><p class="facts"><code>anthropic/claude-opus-5.5</code>, thinking: high (default)</p><blockquote><p>Be brief.</p></blockquote>'));
  assert.ok(html.includes('<summary><span class="name">Grok</span></summary><p class="facts"><code>x-ai/grok-4.7</code>, thinking: low</p></details>'));
  assert.ok(html.includes("Participants could search the web and read web pages unless noted."));
  // Turns
  assert.ok(html.includes('<span class="direction">(privately, to Grok)</span>'));
  assert.ok(html.includes('<span class="direction">(privately, to Bill)</span>'));
  assert.ok(!html.includes("broken"), "failed replies are left out");
  assert.ok(html.includes('<div class="foot"><span>stopped early</span></div>'), "stopped early stays after the text");
  assert.ok(html.includes(`<span class="time">${turnStamp({ time: T })}</span><span class="name">Bill</span>`), "each turn's time, the first with the date");
  assert.ok(html.includes(`<span class="time">${formatTime(new Date(T))}</span><span class="name">Claude</span>`), "the same day: the time alone");
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
  assert.ok(html.includes('<span class="glance"><span>$0.0200</span></span></div>'), "cost in the margin, under the name");
  assert.ok(html.includes("Total reported cost: $0.0350"));
});

test("each participant is one line: name and the start of the role, the rest under a triangle", () => {
  const s = setup();
  s.aboutHuman = "";
  (s.seats[0] as Seat).role = "**Doubt** <everything>. Then say why.\n\nKeep it short.";
  // A stand-in that handles bold, as the page's Markdown renderer would.
  const bold = (md: string) => render(md).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const html = conversationHtml({ startedAt: T, entries: [] }, s, { render: bold });

  assert.ok(html.includes('<span class="gist role-start">Doubt &lt;everything&gt;.</span></summary>'), "the first sentence, plain and still escaped");
  assert.ok(html.includes("<blockquote><p><strong>Doubt</strong> &lt;everything&gt;. Then say why."), "the whole role under the triangle");
  assert.ok(html.includes('<div class="person"><span class="name">Bill</span> <span class="gist">human moderator</span></div>'), "nothing more to show: no triangle");
  assert.ok(html.includes("A participant’s triangle opens its model, thinking level and role."));
});

test("the participants are listed as they were at the start; stage directions and marks on replies tell the rest", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  B.asleep = true;
  const session: Session = { startedAt: T, entries: [] };
  const list = (html: string) => html.slice(html.indexOf('class="participants"'), html.indexOf('class="conversation"'));

  // The first turn fixes the record.
  settleChanges(session, s);
  session.entries.push(human("Hello"), bot(A, "First.", { seatEffort: "default" }));

  // Then everything changes: you, a role, a model, a thinking level, a name; one leaves, one comes.
  s.humanName = "William";
  s.aboutHuman = "Now a beekeeper.";
  A.role = "Be long-winded.";
  A.model = "anthropic/claude-sonnet-5.5";
  A.effort = "low";
  A.name = "Claudia";
  s.seats = [A, { id: "C", name: "Gemini", model: "google/gemini-3", role: "Sum up.", effort: "default", color: "#111111" }];
  settleChanges(session, s);
  session.entries.push(bot(A, "Second.", { seatEffort: "low" }), bot(s.seats[1] as Seat, "Third.", { seatEffort: "default" }));

  const html = conversationHtml(session, s, { render, models: [opusInfo] });
  const people = list(html);
  assert.ok(people.includes('<span class="name">Bill</span>') && people.includes("<blockquote><p>Retired engineer.</p></blockquote>"), "you, as you were");
  assert.ok(!people.includes("William") && !people.includes("beekeeper"));
  assert.ok(people.includes('<span class="name">Claude</span> <span class="gist role-start">Be brief.</span>'), "the first name and role");
  assert.ok(people.includes("<code>anthropic/claude-opus-5.5</code>, thinking: high (default)"), "the first model and level");
  assert.ok(!people.includes("Claudia") && !people.includes("long-winded") && !people.includes("sonnet"));
  assert.ok(people.includes('<span class="name">Grok</span>') && people.includes("asleep at the start"), "removed since, still listed");
  assert.ok(people.includes("<code>google/gemini-3</code>, thinking: model’s default, joined later"), "a later arrival, as it joined");
  assert.ok(people.includes("as of the start of the conversation, or of joining for anyone who came later"));
  assert.ok(!html.includes("as of the time of saving"));

  // Replies are marked against the list: not the first, which matches it, but the second.
  const notes = [...html.matchAll(/<span class="model">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(notes, ["anthropic/claude-sonnet-5.5, thinking: low"]);

  // A later change to an arrival doesn't touch its entry in the record.
  (s.seats[1] as Seat).role = "Say nothing.";
  settleChanges(session, s);
  assert.ok(list(conversationHtml(session, s, { render })).includes("Sum up."));

  // Save Selected: only those who speak in the ticked turns, still as they were.
  const picked = list(conversationHtml(session, s, { render, only: new Set([session.entries[1]!.id]) }));
  assert.ok(picked.includes('<span class="name">Claude</span>') && !picked.includes("Grok") && !picked.includes("Gemini") && !picked.includes("human moderator"));

  // Someone added since the last turn is listed too, since the direction says they joined.
  s.seats.push({ id: "D", name: "Late", model: "x-ai/grok-4.7", role: "", effort: "default", color: "#222222", asleep: true });
  noteChanges(session, s);
  const late = list(conversationHtml(session, s, { render }));
  assert.ok(late.includes('<span class="name">Late</span>') && late.includes("joined later, asleep on joining"));
});

test("a conversation with no record of its start lists everyone as of saving, and says so", () => {
  const s = setup();
  (s.seats[1] as Seat).asleep = true;
  const session: Session = { startedAt: T, entries: [human("Hello")] };
  settleChanges(session, s);
  assert.equal(session.opening, undefined, "too late to record the start");
  (s.seats[0] as Seat).role = "Be long-winded.";
  const html = conversationHtml(session, s, { render });
  assert.ok(html.includes("as of the time of saving"));
  assert.ok(html.includes("long-winded"));
  assert.ok(!html.includes("asleep at the start"));
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
        '<table class="costs"><tr><th>Reading</th><td class="tokens">12,345 tokens</td><td>(10,000 at the re-read discount, 2,000 stored for re-reading)</td><td class="about">about</td><td class="amount">$0.02</td></tr>' +
        '<tr><th>Writing</th><td class="tokens">1,480 tokens</td><td>(1,310 of them thinking)</td><td class="about">about</td><td class="amount">$0.03</td></tr>' +
        '<tr class="total"><th>Total</th><td class="tokens"></td><td></td><td class="about"></td><td class="amount">$0.02</td></tr></table>' +
        "<p>Speed:</p>" +
        '<table class="speeds"><tr><th>Total time</th><td class="value">21.3</td><td>secs</td></tr>' +
        '<tr><th>Time to 1st word</th><td class="value">15.8</td><td>secs</td></tr>' +
        '<tr><th>Overall</th><td class="value">69</td><td>tokens/sec</td></tr>' +
        '<tr><th>Since 1st word</th><td class="value">31</td><td>tokens/sec</td></tr></table>',
    ),
  );
  assert.ok(html.includes('<span class="glance"><span>$0.0213</span>'), "the open one keeps its margin lines too");
  assert.ok(
    html.includes('<span title="Speed:\nTotal time: 21.3 secs\nTime to 1st word: 15.8 secs\nOverall: 69 tokens/sec\nSince 1st word: 31 tokens/sec">69 tokens/s</span>'),
    "pointing at the speed: its breakdown, a line for each row",
  );
  assert.ok(html.includes('<span class="glance"><span>$0.0010</span></span></div>'), "the others: just the margin lines");
  assert.equal((html.match(/class="foot/g) ?? []).length, 1, "only the open one has anything after its text");
  assert.ok(html.includes('<span class="direction">(privately, to Claude and Grok, independently)</span>'));
  assert.ok(html.includes('<span class="direction">(privately, to Bill and Claude)</span>'));
  assert.ok(html.includes('<article class="turn bot private"'));
  const none = conversationHtml({ startedAt: T, entries: [r] }, s, { render, models: [opusInfo] });
  assert.ok(!none.includes("foot details"), "none open: none saved");
});

test("copied turns: name, direction and model in the margin, the selected text beside; no cost, no controls", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  const turn = (entry: Entry, html: string, text: string, extra: Partial<CopiedTurn> = {}): CopiedTurn => ({
    entry, html, text, sources: false, files: false, made: false, ...extra,
  });
  const q = human("What is time?", { attachments: [{ id: "f", name: "orbit.png", kind: "image", mime: "image/png", size: 100, data: "data:image/png;base64,AAAA" }] });
  const r = bot(A, "Change.", { cost: 0.02, citations: [{ url: "https://example.com", title: "Example" }] });
  const p = bot(B, "Secret.", { privateWith: "B", cost: 0.01, seatModel: "x-ai/grok-4.7", model: undefined });
  const turns = [
    turn(q, "<p>What is time?</p>", "What is time?", { files: true }),
    turn(r, "<p>Change.</p><pre><code>x</code></pre>", "Change.\n\n\n\nx", { sources: true, thinking: "<p>Hmm.</p>" }),
    turn(p, "<p>Sec</p>", "Sec"),
  ];
  const html = copiedHtml(turns, s);

  assert.ok(html.startsWith('<table style="border-collapse: collapse; color: #1e1d1b;">'));
  assert.ok(!/class=|<button|<input|\$0\.0/.test(html), "no classes, no controls, no costs");
  assert.ok(html.includes('<div style="font-weight: 600; color: #a35439;">Claude</div>'), "the name in its seat's color, as on screen");
  assert.ok(html.includes('>anthropic/<wbr><span style="white-space: nowrap;">claude-opus-5.5</span></div>'), "the model under the name");
  assert.ok(html.includes('>x-ai/<wbr><span style="white-space: nowrap;">grok-4.7</span></div>'), "the seat's model when the reply didn't say");
  assert.ok(html.includes(">(privately, to Bill)</div>"));
  assert.ok(html.includes('<tr style="background: #f2e8cb;">'), "a private exchange tinted");
  assert.equal((html.match(/<tr/g) ?? []).length, 3);
  assert.ok(html.includes('<p style="margin: 0 0 0.8em;">Change.</p><pre style="background: #f8f8f5;'), "the text's tags styled in place");
  assert.ok(html.includes('<code style="font-family: ui-monospace'));
  assert.ok(html.includes("<div>Thinking</div>"), "open thinking that was selected");
  assert.ok(html.includes('<a href="https://example.com" style="color: inherit;">Example</a>'));
  assert.ok(html.includes('<img src="data:image/png;base64,AAAA" alt="orbit.png"'), "a picture attached");

  const unselected = copiedHtml([turn(r, "<p>Change.</p>", "Change.")], s);
  assert.ok(!unselected.includes("Sources:") && !unselected.includes("Thinking"), "parts not selected left out");

  assert.equal(
    copiedText(turns, s),
    "00:00 Bill\nWhat is time?\n\n00:00 Claude\nanthropic/claude-opus-5.5\nChange.\n\nx\n\n00:00 Grok (privately, to Bill)\nx-ai/grok-4.7\nSec".replace(/00:00/g, formatTime(new Date(T))),
  );
});

test("a saved conversation as plain text: private turns marked, files named, failures left out", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  const entries: Entry[] = [
    human("Look at these.", {
      attachments: [
        { id: "f1", name: "notes.md", kind: "text", mime: "text/markdown", size: 20, tokens: 5, data: "SECRET NOTES" },
        { id: "f2", name: "orbit.png", kind: "image", mime: "image/png", size: 100, data: "data:image/png;base64,AAAA" },
      ],
    }),
    bot(A, "Here is a plan.", { made: [{ id: "m1", name: "plan.md", kind: "md", size: 9, data: "PLAN BODY" }, { id: "m2", name: "old.md", kind: "md", size: 3, removed: true }] }),
    bot(B, "", { status: "error", error: "Timed out" }),
    human("Just between us.", { privateWith: "B", addressedTo: { seatId: "B", name: "Grok" } }),
    bot(B, "Agreed.", { privateWith: "B" }),
  ];
  const data = conversationData({ startedAt: T, entries }, s);
  const t = formatTime(new Date(T));
  assert.equal(
    savedConversationText(data),
    [
      `${turnStamp({ time: T })} Bill\nLook at these.\n\n(attached: notes.md, orbit.png)`,
      `${t} Claude\nanthropic/claude-opus-5.5\nHere is a plan.\n\n(made: plan.md)`,
      `${t} Bill (privately, to Grok)\nJust between us.`,
      `${t} Grok (privately, to Bill)\nx-ai/grok-4.7\nAgreed.`,
    ].join("\n\n"),
  );
});

test("an aside to the readers: marked and in its own style in the saved page and in copies; left out of the text for other conversations", () => {
  const s = setup();
  const [A] = s.seats as [Seat];
  const q = human("What is time?");
  const note = human("Claude tends to hedge here.", { aside: true });
  const r = bot(A, "Change.");
  const html = conversationHtml({ startedAt: T, entries: [q, note, r] }, s, { render });
  assert.ok(html.includes('<article class="turn human for-readers">'));
  assert.ok(html.includes('<span class="direction">(aside, to the readers)</span>'));
  assert.ok(html.includes(".for-readers .body { font-style: italic;"));

  const copied = copiedHtml([{ entry: note, html: "<p>Claude tends</p>", text: "Claude tends", sources: false, files: false, made: false }], s);
  assert.ok(copied.includes(">(aside, to the readers)</div>"));
  assert.ok(copied.includes("border-left: 2px dotted #6a6c67; font-style: italic;"));

  const text = savedConversationText(conversationData({ startedAt: T, entries: [q, note, r] }, s));
  assert.ok(!text.includes("hedge"));
  assert.ok(text.includes("What is time?") && text.includes("Change."));
});
