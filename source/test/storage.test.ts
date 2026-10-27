import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "../src/engine";
import {
  conversationFromFile,
  loadCachedModels,
  loadModelSort,
  saveModelSort,
  loadSession,
  loadSettings,
  MODELS_MAX_AGE_MS,
  modelsAreStale,
  conversationMark,
  forgetTab,
  hasUnsavedTurns,
  markSaved,
  saveCachedModels,
  saveSession,
  saveSettings,
  settingsFileText,
  settingsFromFile,
  withConversationData,
} from "../src/storage";
import type { Entry, Session } from "../src/types";

// Stand-ins for the browser's storage: shared by all tabs (local) and this tab's own (session).
const storageOver = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => void m.set(k, String(v)),
  removeItem: (k: string) => void m.delete(k),
  key: (i: number) => [...m.keys()][i] ?? null,
  get length() {
    return m.size;
  },
});
const mem = new Map<string, string>();
const tabMem = new Map<string, string>();
Object.assign(globalThis, { localStorage: storageOver(mem), sessionStorage: storageOver(tabMem) });

test("older web-search settings are dropped: every seat now searches and reads pages", () => {
  mem.set(
    "dialog.settings.v1",
    JSON.stringify({
      humanName: "Bill",
      maxSearches: 5,
      seats: [
        { id: "A", name: "Claude", model: "a", webSearch: true, effort: "high" },
        { id: "B", name: "Grok", model: "b", webSearch: false, maxSearches: 0 },
      ],
    }),
  );
  const s = loadSettings();
  assert.equal(s.humanName, "Bill");
  assert.deepEqual(s.seats.map((x) => [x.name, x.model, x.effort]), [["Claude", "a", "high"], ["Grok", "b", "default"]]);
  assert.ok(!("maxSearches" in s));
  for (const seat of s.seats) assert.deepEqual(Object.keys(seat).sort(), ["color", "effort", "id", "model", "name", "role"]);
});

test("settings file: written without keys unless asked; read back, keeping current keys when the file has none", () => {
  const s = defaultSettings();
  s.apiKey = "sk-mine";
  s.managementKey = "mk-mine";
  s.humanName = "Bill";
  s.aboutHuman = "Retired engineer.";
  s.houseRules = "Be civil.";
  s.seats = [{ id: "A", name: "Claude", model: "anthropic/claude-opus-5.5", effort: "high", role: "Be brief.", color: "#c96442" }];
  const at = new Date("2026-10-09T17:22:00Z");

  const plain = settingsFileText(s, false, at);
  const json = JSON.parse(plain);
  assert.equal(json.format, "dialog-settings");
  assert.equal(json.savedAt, "2026-10-09T17:22:00.000Z");
  assert.ok(!("apiKey" in json) && !("managementKey" in json), "no keys unless asked");
  assert.ok(!plain.includes("sk-mine") && !plain.includes("mk-mine"));
  assert.deepEqual(json.seats, [{ id: "A", name: "Claude", model: "anthropic/claude-opus-5.5", effort: "high", role: "Be brief.", color: "#c96442" }]);

  const withKeys = JSON.parse(settingsFileText(s, true, at));
  assert.equal(withKeys.apiKey, "sk-mine");
  assert.equal(withKeys.managementKey, "mk-mine");

  // Read into a browser that has other keys and other settings.
  const other = defaultSettings();
  other.apiKey = "sk-other";
  const r1 = settingsFromFile(plain, other);
  assert.equal(r1.hasKeys, false);
  assert.equal(r1.settings.apiKey, "sk-other", "keys kept when the file has none");
  assert.equal(r1.settings.humanName, "Bill");
  assert.equal(r1.settings.aboutHuman, "Retired engineer.");
  assert.equal(r1.settings.houseRules, "Be civil.");
  assert.deepEqual(r1.settings.seats, s.seats);
  assert.equal(r1.savedAt?.toISOString(), "2026-10-09T17:22:00.000Z");
  const r2 = settingsFromFile(settingsFileText(s, true, at), other);
  assert.equal(r2.hasKeys, true);
  assert.equal(r2.settings.apiKey, "sk-mine");
  assert.equal(r2.settings.managementKey, "mk-mine");
});

test("settings file: the LM Studio address goes in; a file without one keeps the current address", () => {
  const s = defaultSettings();
  s.localServer = "http://localhost:1234";
  const at = new Date("2026-10-21T17:22:00Z");
  const text = settingsFileText(s, false, at);
  assert.equal(JSON.parse(text).localServer, "http://localhost:1234");
  const other = defaultSettings();
  other.localServer = "http://localhost:4321";
  assert.equal(settingsFromFile(text, other).settings.localServer, "http://localhost:1234");
  const older = JSON.parse(text);
  delete older.localServer;
  assert.equal(settingsFromFile(JSON.stringify(older), other).settings.localServer, "http://localhost:4321");
});

test("settings file: other files are refused in plain words; hand-edited ones are tolerated", () => {
  const cur = defaultSettings();
  for (const text of ["not json at all", "{}", '{"format":"something-else"}', "[1,2]"]) {
    assert.throws(() => settingsFromFile(text, cur), /isn't a Dialog settings file/, text);
  }
  const r = settingsFromFile(JSON.stringify({ format: "dialog-settings", seats: [{ name: "Grok", model: "x-ai/grok-4.7" }] }), cur);
  assert.equal(r.settings.seats.length, 1);
  assert.ok(r.settings.seats[0]!.id.length > 0, "a seat without an id gets one");
  assert.equal(r.settings.seats[0]!.effort, "default");
  assert.equal(r.settings.humanName, "John Doe", "missing fields get their defaults");
});

test("a sleeping seat stays asleep in the settings file; awake seats carry no mark", () => {
  const s = defaultSettings();
  s.seats = [
    { id: "A", name: "Claude", model: "a", effort: "default", role: "", color: "#000", asleep: true },
    { id: "B", name: "Grok", model: "b", effort: "default", role: "", color: "#111", asleep: false },
  ];
  const back = settingsFromFile(settingsFileText(s, false, new Date()), defaultSettings()).settings.seats;
  assert.equal(back[0]!.asleep, true);
  assert.ok(!("asleep" in back[1]!));
});

test("files the participants made are stored like attachments; a reply cut off mid-file keeps what arrived", () => {
  mem.clear();
  tabMem.clear();
  tabMem.set(
    "dialog.session.v1",
    JSON.stringify({
      startedAt: "2026-10-11T20:00:00.000Z",
      entries: [
        { id: "e1", speaker: "A", speakerName: "Claude", text: "Here.", time: "t", status: "done", made: [{ id: "m1", name: "a.md", kind: "md", size: 2 }, { id: "m2", name: "b.md", kind: "md", size: 2, removed: true }] },
        { id: "e2", speaker: "B", speakerName: "Grok", text: 'Writing.\n<file name="page.html">\n<p>Half', time: "t", status: "streaming" },
      ],
    }),
  );
  tabMem.set("dialog.file.m1", "# A");
  tabMem.set("dialog.file.m2", "left over");
  tabMem.set("dialog.file.zzz", "orphan");
  const s = loadSession();
  assert.equal(s.entries[0]!.made![0]!.data, "# A", "contents come back from their slot");
  assert.equal(s.entries[0]!.made![1]!.data, undefined);
  assert.ok(!tabMem.has("dialog.file.m2") && !tabMem.has("dialog.file.zzz"), "removed and orphaned files' slots freed");
  const cut = s.entries[1]!;
  assert.equal(cut.status, "stopped");
  assert.equal(cut.text, "Writing.");
  assert.equal(cut.made![0]!.name, "page.html");
  assert.equal(cut.made![0]!.data, "<p>Half");
  assert.equal(cut.made![0]!.incomplete, true);

  cut.thinking = "Mulling it over.";
  assert.ok(saveSession(s));
  assert.ok(!tabMem.get("dialog.session.v1")!.includes("Mulling"), "thinking is never stored");
  assert.equal(tabMem.get(`dialog.file.${cut.made![0]!.id}`), "<p>Half", "the recovered file gets its own slot");
  assert.ok(!tabMem.get("dialog.session.v1")!.includes("<p>Half"), "and is not in the conversation record");
});

test("tabs: a new tab starts with the latest settings; its own are kept, and become the latest only when changed", () => {
  mem.clear();
  tabMem.clear();
  const latest = defaultSettings();
  latest.humanName = "Bill";
  mem.set("dialog.settings.v1", JSON.stringify(latest));
  const s = loadSettings();
  assert.equal(s.humanName, "Bill", "a new tab starts from the latest settings");
  assert.ok(saveSettings(s));
  assert.equal(JSON.parse(tabMem.get("dialog.settings.v1")!).humanName, "Bill", "and keeps them as its own");

  // Another tab changes the latest; saving this tab's unchanged settings leaves that alone.
  mem.set("dialog.settings.v1", JSON.stringify({ ...latest, humanName: "Other" }));
  assert.ok(saveSettings(s));
  assert.equal(JSON.parse(mem.get("dialog.settings.v1")!).humanName, "Other");
  assert.equal(loadSettings().humanName, "Bill", "reloading this tab keeps its own");

  s.humanName = "William";
  assert.ok(saveSettings(s));
  assert.equal(JSON.parse(mem.get("dialog.settings.v1")!).humanName, "William", "a change here becomes the latest");
  assert.equal(JSON.parse(tabMem.get("dialog.settings.v1")!).humanName, "William");
});

test("tabs: the conversation all tabs used to share moves into the first tab opened; the next starts empty", () => {
  mem.clear();
  tabMem.clear();
  const entry = { id: "t1", speaker: "human", speakerName: "Bill", text: "Hello", time: "t", attachments: [{ id: "f-moved", name: "a.txt", kind: "text", mime: "text/plain", size: 2 }] };
  mem.set("dialog.session.v1", JSON.stringify({ startedAt: "2026-10-11T20:00:00.000Z", entries: [entry] }));
  mem.set("dialog.file.f-moved", "hi");
  mem.set("dialog.file.f-orphan", "old");
  const first = loadSession();
  assert.equal(first.entries[0]!.attachments![0]!.data, "hi");
  assert.ok(tabMem.has("dialog.session.v1") && tabMem.get("dialog.file.f-moved") === "hi", "now in the tab's own storage");
  assert.deepEqual([...mem.keys()].filter((k) => k.startsWith("dialog.session") || k.startsWith("dialog.file")), [], "and gone from shared storage");
  assert.equal(loadSession().entries[0]!.text, "Hello", "reloading the tab keeps it");

  tabMem.clear(); // another tab
  assert.equal(loadSession().entries.length, 0);
});

test("tabs: forgetting a tab's storage leaves other pages' data in it alone", () => {
  tabMem.clear();
  tabMem.set("dialog.session.v1", "{}");
  tabMem.set("dialog.file.x", "x");
  tabMem.set("other-app", "keep");
  forgetTab();
  assert.deepEqual([...tabMem.keys()], ["other-app"]);
});

test("unsaved turns: none in an empty conversation; saved until it changes", () => {
  tabMem.clear();
  const s: Session = { startedAt: "2026-10-11T20:00:00.000Z", entries: [] };
  assert.equal(hasUnsavedTurns(s), false);
  s.entries.push({ id: "u1", speaker: "human", speakerName: "Bill", text: "Hello", time: "t" } as Entry);
  assert.equal(hasUnsavedTurns(s), true);
  markSaved(conversationMark(s));
  assert.equal(hasUnsavedTurns(s), false);
  s.entries[0]!.thinking = "Hmm.";
  assert.equal(hasUnsavedTurns(s), false, "thinking isn't saved in a file, so doesn't count");
  s.entries[0]!.text = "Hello there";
  assert.equal(hasUnsavedTurns(s), true);
});

test("the saved model list comes back with the time it was fetched, however old; over 12 hours old, it is stale", () => {
  mem.clear();
  assert.equal(loadCachedModels(), null, "none saved yet");
  const models = [{ id: "a/b", name: "A: B", inputPrice: 1, outputPrice: 2, contextLength: 10, inputModalities: ["text"], tools: true }];
  const at = Date.UTC(2026, 9, 14, 16, 0);
  saveCachedModels(models, at);
  assert.deepEqual(loadCachedModels(), { models, at }, "an old copy is still there, to show while a new one is fetched");
  const hour = 60 * 60 * 1000;
  assert.equal(MODELS_MAX_AGE_MS, 12 * hour);
  assert.equal(modelsAreStale(at, at + 11 * hour), false);
  assert.equal(modelsAreStale(at, at + 13 * hour), true);
  assert.equal(modelsAreStale(0), true, "no list at all");
  assert.equal(modelsAreStale(at, at - 60 * 1000), false, "a minute's difference between clocks doesn't matter");
  assert.equal(modelsAreStale(at, at - 2 * hour), true, "dated in the future: the clock was wrong when it was saved");
  mem.set("dialog.models.v5", "{not json");
  assert.equal(loadCachedModels(), null, "a damaged copy is ignored");
});

test("the model picker's sort is remembered; anything else stored reads as by name", () => {
  mem.clear();
  assert.equal(loadModelSort(), "name");
  saveModelSort("out-desc");
  assert.equal(loadModelSort(), "out-desc");
  mem.set("dialog.modelSort.v1", JSON.stringify("by-vibes"));
  assert.equal(loadModelSort(), "name");
});

test("saved conversation: the page carries everything needed to resume it, but no keys or LM Studio address", () => {
  const s = defaultSettings();
  s.apiKey = "sk-mine";
  s.managementKey = "mk-mine";
  s.localServer = "http://localhost:1234";
  s.humanName = "Bill";
  s.aboutHuman = "Retired engineer.";
  s.houseRules = "Be civil.";
  s.seats = [
    { id: "A", name: "Claude", model: "anthropic/claude-opus-5.5", effort: "high", role: "Be brief.", color: "#c96442" },
    { id: "B", name: "Grok", model: "x-ai/grok-4.7", effort: "default", role: "", color: "#6b7280", asleep: true },
  ];
  const T = "2026-10-23T14:05:00.000Z";
  const entries: Entry[] = [
    {
      id: "h1", speaker: "human", speakerName: "Bill", text: "Look </script><!-- here", time: T,
      attachments: [
        { id: "f1", name: "paper.pdf", kind: "pdf", mime: "application/pdf", size: 9, data: "data:application/pdf;base64,JVBERi0=", unsaved: true },
        { id: "f2", name: "gone.txt", kind: "text", mime: "text/plain", size: 3 },
      ],
    },
    {
      id: "b1", speaker: "A", speakerName: "Claude", text: "Here.", time: T, status: "done", cost: 0.01, model: "m", thinking: "Mulling it over.",
      made: [
        { id: "m1", name: "plan.md", kind: "md", size: 5, data: "# Plan" },
        { id: "m2", name: "old.md", kind: "md", size: 5, removed: true },
      ],
    },
    { id: "h2", speaker: "human", speakerName: "Bill", text: "Psst", time: T, privateWith: "B" },
    { id: "b2", speaker: "B", speakerName: "Grok", text: "broken", time: T, status: "error", error: "x" },
    { id: "b3", speaker: "B", speakerName: "Grok", text: "Half.\n<file name=\"a.txt\">\nabc", time: T, status: "streaming" },
  ];
  const session: Session = { startedAt: T, entries };
  const page = "<!doctype html>\n<html><body><main>…</main></body></html>\n";
  const saved = withConversationData(page, session, s, undefined, new Date(T));

  assert.ok(saved.startsWith("<!doctype html>\n<html><body><main>…</main><script type=\"application/json\" id=\"dialog-conversation\">"));
  assert.ok(saved.endsWith("</script>\n</body></html>\n"), "the data goes just before the end of the page");
  assert.equal(saved.split("</script>").length - 1, 1, "nothing inside can end the block early");
  assert.ok(!saved.includes("<!--"));
  for (const secret of ["sk-mine", "mk-mine", "localhost:1234", "unsaved", "Mulling"]) assert.ok(!saved.includes(secret), secret);

  // Resumed into a browser with other settings: those from the file, but this browser's keys and address.
  const here = defaultSettings();
  here.apiKey = "sk-here";
  here.localServer = "http://127.0.0.1:5678";
  here.humanName = "Someone";
  const r = conversationFromFile(saved, here);
  assert.equal(r.savedAt?.toISOString(), T);
  assert.equal(r.session.startedAt, T);
  assert.equal(r.settings.apiKey, "sk-here");
  assert.equal(r.settings.localServer, "http://127.0.0.1:5678");
  assert.equal(r.settings.humanName, "Bill");
  assert.equal(r.settings.aboutHuman, "Retired engineer.");
  assert.equal(r.settings.houseRules, "Be civil.");
  assert.deepEqual(r.settings.seats, s.seats, "every participant, asleep or not");
  const [h1, b1, h2, b2, b3] = r.session.entries as [Entry, Entry, Entry, Entry, Entry];
  assert.equal(h1.text, "Look </script><!-- here");
  assert.deepEqual(h1.attachments, [
    { id: "f1", name: "paper.pdf", kind: "pdf", mime: "application/pdf", size: 9, data: "data:application/pdf;base64,JVBERi0=" },
    { id: "f2", name: "gone.txt", kind: "text", mime: "text/plain", size: 3 },
  ]);
  assert.deepEqual(b1.made, [
    { id: "m1", name: "plan.md", kind: "md", size: 5, data: "# Plan" },
    { id: "m2", name: "old.md", kind: "md", size: 5, removed: true },
  ]);
  assert.equal(b1.cost, 0.01);
  assert.equal(h2.privateWith, "B");
  assert.equal(b2.status, "error", "Save All keeps a failed reply, as it is on screen");
  assert.equal(b3.status, "stopped", "a reply still arriving when saved comes back stopped");
  assert.equal(b3.text, "Half.");
  assert.equal(b3.made?.[0]?.name, "a.txt");

  // Save Selected: just the ticked turns (never a failed one), but every participant.
  const some = conversationFromFile(withConversationData(page, session, s, new Set(["b1", "b2"])), here);
  assert.deepEqual(some.session.entries.map((e) => e.id), ["b1"]);
  assert.deepEqual(some.settings.seats.map((x) => x.name), ["Claude", "Grok"]);
});

test("saved conversation: an older saved page, or anything else, is refused in plain words", () => {
  const s = defaultSettings();
  assert.throws(() => conversationFromFile('<html><body><header class="doc-head">Dialog</header></body></html>', s), /saved by an earlier version of Dialog/);
  assert.throws(() => conversationFromFile("hello", s), /isn't a conversation saved by Dialog/);
  assert.throws(() => conversationFromFile('<script type="application/json" id="dialog-conversation">{oops</script>', s), /isn't a conversation saved by Dialog/);
  assert.throws(() => conversationFromFile('<script type="application/json" id="dialog-conversation">{"format":"dialog-settings","entries":[]}</script>', s), /isn't a conversation/);
});
