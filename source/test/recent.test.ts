import "fake-indexeddb/auto"; // a stand-in for the browser's database
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "../src/engine";
import { beyondKept, keepRecent, KEEP_RECENT, listRecent, loadRecent, recentSummary, type RecentSummary } from "../src/recent";
import { conversationData, conversationFromData } from "../src/storage";
import type { Entry, Session, Settings } from "../src/types";

const settings: Settings = {
  ...defaultSettings(),
  apiKey: "sk-secret",
  humanName: "Bill",
  seats: [
    { id: "A", name: "Claude", model: "anthropic/claude-opus-5.5", role: "", effort: "default", color: "#c96442" },
    { id: "B", name: "Grok", model: "x-ai/grok-4.7", role: "", effort: "low", color: "#6b7280" },
  ],
};

function entry(speaker: string, text: string, more: Partial<Entry> = {}): Entry {
  return { id: Math.random().toString(36).slice(2), speaker, speakerName: speaker === "human" ? "Bill" : "Claude", text, time: "2026-10-29T10:00:00Z", ...more };
}

const at = (minute: number) => new Date(Date.UTC(2026, 9, 29, 10, minute));

test("a kept conversation's summary: the first sentence of your first message, the participants, the number of turns", () => {
  const session: Session = { startedAt: "2026-10-29T10:00:00Z", entries: [entry("A", "Welcome."), entry("human", "What is time? Discuss it, team."), entry("A", "Change.")] };
  const s = recentSummary("id1", conversationData(session, settings, undefined, at(5)));
  assert.deepEqual(s, { id: "id1", savedAt: at(5).toISOString(), title: "What is time?", seats: ["Claude", "Grok"], turns: 3 });
  const none = recentSummary("id2", conversationData({ startedAt: "", entries: [entry("A", "Hello.")] }, settings));
  assert.equal(none.title, "", "nothing from you yet");
  const long = recentSummary("id3", conversationData({ startedAt: "", entries: [entry("human", "x".repeat(300))] }, settings));
  assert.equal(long.title, "x".repeat(200) + "…");
});

test("only the newest 25 are kept", () => {
  const list: RecentSummary[] = Array.from({ length: 27 }, (_, i) => ({ id: `c${i}`, savedAt: at(i).toISOString(), title: "", seats: [], turns: 1 }));
  assert.equal(KEEP_RECENT, 25);
  assert.deepEqual(beyondKept(list).sort(), ["c0", "c1"], "the two kept longest ago");
  assert.deepEqual(beyondKept(list.slice(0, 25)), []);
});

test("conversations are kept in the database with their files, never the thinking or the keys, and the oldest forgotten", async () => {
  const pdf = { id: "f1", name: "paper.pdf", kind: "pdf" as const, mime: "application/pdf", size: 10, data: "data:application/pdf;base64,AAAA", unsaved: true };
  const session: Session = {
    startedAt: "2026-10-29T10:00:00Z",
    entries: [entry("human", "Read this. Then tell me.", { attachments: [pdf] }), entry("A", "Done.", { thinking: "hmm", status: "done" })],
  };
  assert.equal(await keepRecent("first", conversationData(session, settings, undefined, at(0))), true);
  const kept = await loadRecent("first");
  assert.ok(kept);
  assert.equal(kept.entries[0].attachments?.[0].data, pdf.data, "the file's contents too");
  assert.equal(kept.entries[0].attachments?.[0].unsaved, undefined);
  assert.equal(kept.entries[1].thinking, undefined, "never the thinking");
  assert.ok(!JSON.stringify(kept).includes("sk-secret"), "never the key");
  // Brought back as Resume does from a file: the participants with it, the current keys kept.
  const resumed = conversationFromData(kept, { ...settings, apiKey: "sk-now", seats: [] });
  assert.equal(resumed.settings.apiKey, "sk-now");
  assert.deepEqual(resumed.settings.seats.map((s) => s.name), ["Claude", "Grok"]);
  assert.equal(resumed.session.entries.length, 2);

  // Keeping it again replaces it rather than adding another.
  session.entries.push(entry("human", "Thanks."));
  await keepRecent("first", conversationData(session, settings, undefined, at(1)));
  let list = await listRecent();
  assert.deepEqual(list.map((s) => [s.id, s.turns]), [["first", 3]]);

  // 26 more: the first, kept longest ago, is forgotten along with its data.
  for (let i = 0; i < 26; i++) await keepRecent(`c${i}`, conversationData(session, settings, undefined, at(10 + i)));
  list = await listRecent();
  assert.equal(list.length, 25);
  assert.equal(list[0].id, "c25", "newest first");
  assert.ok(!list.some((s) => s.id === "first" || s.id === "c0"));
  assert.equal(await loadRecent("first"), null);
  assert.equal(await loadRecent("missing"), null);
});
