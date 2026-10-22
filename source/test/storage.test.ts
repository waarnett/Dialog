import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "../src/engine";
import {
  loadCachedModels,
  loadModelSort,
  saveModelSort,
  loadSession,
  loadSettings,
  MODELS_MAX_AGE_MS,
  modelsAreStale,
  saveCachedModels,
  saveSession,
  settingsFileText,
  settingsFromFile,
} from "../src/storage";

// A stand-in for the browser's local storage.
const mem = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  },
});

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
  mem.set(
    "dialog.session.v1",
    JSON.stringify({
      startedAt: "2026-10-11T20:00:00.000Z",
      entries: [
        { id: "e1", speaker: "A", speakerName: "Claude", text: "Here.", time: "t", status: "done", made: [{ id: "m1", name: "a.md", kind: "md", size: 2 }, { id: "m2", name: "b.md", kind: "md", size: 2, removed: true }] },
        { id: "e2", speaker: "B", speakerName: "Grok", text: 'Writing.\n<file name="page.html">\n<p>Half', time: "t", status: "streaming" },
      ],
    }),
  );
  mem.set("dialog.file.m1", "# A");
  mem.set("dialog.file.m2", "left over");
  mem.set("dialog.file.zzz", "orphan");
  const s = loadSession();
  assert.equal(s.entries[0]!.made![0]!.data, "# A", "contents come back from their slot");
  assert.equal(s.entries[0]!.made![1]!.data, undefined);
  assert.ok(!mem.has("dialog.file.m2") && !mem.has("dialog.file.zzz"), "removed and orphaned files' slots freed");
  const cut = s.entries[1]!;
  assert.equal(cut.status, "stopped");
  assert.equal(cut.text, "Writing.");
  assert.equal(cut.made![0]!.name, "page.html");
  assert.equal(cut.made![0]!.data, "<p>Half");
  assert.equal(cut.made![0]!.incomplete, true);

  assert.ok(saveSession(s));
  assert.equal(mem.get(`dialog.file.${cut.made![0]!.id}`), "<p>Half", "the recovered file gets its own slot");
  assert.ok(!mem.get("dialog.session.v1")!.includes("<p>Half"), "and is not in the conversation record");
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
