// Saving and loading through the browser's storage, which keeps data on this computer, for
// this page. Each tab keeps its own conversation, files and settings in the tab's own storage
// (kept while the tab is open, through reloads, and gone when it closes). The storage all tabs
// share holds only what a new tab starts from: the latest settings, the model list and its
// order. Every access is guarded: if storage is unavailable, Dialog still works, it just can't
// remember anything.

import { defaultSettings, isSettled, madeFileFrom, MODEL_SORTS, newId, newSession, SEAT_COLORS, splitFiles, upgradeHouseRules, type ModelSort } from "./engine";
import type { ModelInfo } from "./openrouter";
import type { Attachment, Entry, MadeFile, Seat, Session, Settings } from "./types";

const SETTINGS_KEY = "dialog.settings.v1"; // in this tab, and the latest in shared storage
const SESSION_KEY = "dialog.session.v1"; // in this tab (in shared storage before tabs were separate)
const MODELS_KEY = "dialog.models.v6"; // v3 added what each model takes in; v4, whether it can use tools; v5, what a ~latest id stands for; v6, cache prices

/** This tab's own storage. */
const tab = (): Storage => sessionStorage;
/** The storage every tab shares. */
const shared = (): Storage => localStorage;

function read(area: () => Storage, key: string): unknown {
  try {
    const raw = area().getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(area: () => Storage, key: string, value: unknown, replacer?: (key: string, value: unknown) => unknown): boolean {
  try {
    area().setItem(key, JSON.stringify(value, replacer));
    return true;
  } catch {
    return false;
  }
}

/** True if the browser is letting this page store data, in the tab and shared. */
export function storageWorks(): boolean {
  try {
    for (const area of [tab(), shared()]) {
      area.setItem("dialog.probe", "1");
      area.removeItem("dialog.probe");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget everything this tab has stored, so it starts afresh: for a tab opened with a new
 * conversation, into which the browser may have copied the storage of the tab that opened it.
 */
export function forgetTab(): void {
  try {
    const mine: string[] = [];
    for (let i = 0; i < tab().length; i++) {
      const key = tab().key(i);
      if (key?.startsWith("dialog.")) mine.push(key);
    }
    for (const key of mine) tab().removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

/** One seat as stored. (Older web-search settings, now gone, are ignored.) */
function cleanSeat(v: unknown): Seat | null {
  if (!isObj(v) || typeof v.id !== "string" || typeof v.name !== "string") return null;
  const effort = typeof v.effort === "string" && v.effort ? v.effort : "default";
  return {
    id: v.id,
    name: v.name,
    model: str(v.model, ""),
    role: str(v.role, ""),
    effort,
    color: str(v.color, SEAT_COLORS[v.name] ?? "#888888"),
    ...(v.asleep === true ? { asleep: true } : {}),
  };
}

/** The settings this tab's storage holds ("" if none yet). */
let tabSettings = "";
/** The settings as loaded, or as last changed in this tab. */
let ownSettings = "";

/** This tab's settings; in a new tab, the latest settings changed in any tab. */
export function loadSettings(): Settings {
  const mine = read(tab, SETTINGS_KEY);
  const s = parseSettings(mine ?? read(shared, SETTINGS_KEY));
  ownSettings = JSON.stringify(s);
  tabSettings = mine ? ownSettings : "";
  return s;
}

/** Settings from stored or file data; anything missing or malformed gets its default. */
function parseSettings(v: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(v)) return d;
  const seats = Array.isArray(v.seats) ? v.seats.map(cleanSeat).filter((s): s is Seat => s !== null) : d.seats;
  return {
    apiKey: str(v.apiKey, ""),
    managementKey: str(v.managementKey, ""),
    localServer: str(v.localServer, ""),
    humanName: str(v.humanName, d.humanName) || d.humanName,
    aboutHuman: str(v.aboutHuman, ""),
    houseRules: upgradeHouseRules(str(v.houseRules, d.houseRules) || d.houseRules),
    seats,
  };
}

/**
 * Store this tab's settings. Only when they have been changed here do they also become the
 * latest, for new tabs, so that this tab's saves don't undo a change made in another tab.
 */
export function saveSettings(s: Settings): boolean {
  const json = JSON.stringify(s);
  if (json !== ownSettings) {
    write(shared, SETTINGS_KEY, s);
    ownSettings = json;
  }
  if (json === tabSettings) return true;
  const ok = write(tab, SETTINGS_KEY, s);
  if (ok) tabSettings = json;
  return ok;
}

// ---------------------------------------------------------------------------
// Settings as a file, to keep as a backup or to move to another browser or computer

/** Marks a file as Dialog's settings. */
const FILE_FORMAT = "dialog-settings";

/**
 * The settings as the text of a file: your name, About you, the house rules, every
 * participant and the LM Studio address. The keys only if asked for: anyone holding them
 * could spend your credit.
 */
export function settingsFileText(s: Settings, includeKeys: boolean, savedAt = new Date()): string {
  const out: Record<string, unknown> = {
    format: FILE_FORMAT,
    version: 1,
    savedAt: savedAt.toISOString(),
    humanName: s.humanName,
    aboutHuman: s.aboutHuman,
    houseRules: s.houseRules,
    localServer: s.localServer,
    seats: s.seats.map(({ id, name, model, effort, role, color, asleep }) => ({ id, name, model, effort, role, color, ...(asleep ? { asleep } : {}) })),
  };
  if (includeKeys) {
    out.apiKey = s.apiKey;
    out.managementKey = s.managementKey;
  }
  return JSON.stringify(out, null, 2) + "\n";
}

export interface RestoredSettings {
  settings: Settings;
  savedAt?: Date;
  /** Did the file supply a key (which then replaces the current one)? */
  hasKeys: boolean;
}

/**
 * Read a settings file. Each key, and the LM Studio address, comes from the file if the file
 * has one (older files have no address), otherwise the current one is kept. Throws an Error
 * in plain words if it isn't a Dialog settings file.
 */
export function settingsFromFile(text: string, current: Settings): RestoredSettings {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    v = undefined;
  }
  if (!isObj(v) || v.format !== FILE_FORMAT) {
    throw new Error("That isn't a Dialog settings file (one made with “Save settings to a file”).");
  }
  // A participant typed in by hand may lack the identifier Dialog gives each one.
  const seats = Array.isArray(v.seats) ? v.seats.map((x) => (isObj(x) && typeof x.id !== "string" ? { ...x, id: newId() } : x)) : [];
  const parsed = parseSettings({ ...v, seats });
  const key = (k: "apiKey" | "managementKey") => (typeof v[k] === "string" && v[k].trim() ? v[k].trim() : current[k]);
  const localServer = typeof v.localServer === "string" ? v.localServer.trim() : current.localServer;
  const settings: Settings = { ...parsed, apiKey: key("apiKey"), managementKey: key("managementKey"), localServer };
  const hasKeys = [v.apiKey, v.managementKey].some((k) => typeof k === "string" && k.trim() !== "");
  const savedAt = typeof v.savedAt === "string" && !Number.isNaN(Date.parse(v.savedAt)) ? new Date(v.savedAt) : undefined;
  return { settings, savedAt, hasKeys };
}

// Attached files are stored one per slot ("dialog.file.<id>"), apart from the conversation,
// so a large file can't stop the conversation itself from being saved. Browsers allow each
// tab only a few megabytes in all; a file that doesn't fit stays in memory and is marked.

const FILE_PREFIX = "dialog.file.";
/** Files known to be in storage already, so they aren't rewritten on every save. */
const storedFiles = new Set<string>();

/** Every stored file: your attachments and the files participants made (except removed ones). */
function allAttachments(s: Session): (Attachment | MadeFile)[] {
  return s.entries.flatMap((e) => [...(e.attachments ?? []), ...(e.made ?? []).filter((f) => !f.removed)]);
}

/**
 * This tab's conversation. A new tab starts with none, except that the first one opened since
 * tabs became separate takes over the conversation (and its files) that all tabs used to share.
 */
export function loadSession(): Session {
  const mine = read(tab, SESSION_KEY);
  const area = mine === null ? shared : tab;
  const v = mine ?? read(shared, SESSION_KEY);
  const contents = (a: Attachment | MadeFile) => {
    try {
      const data = area().getItem(FILE_PREFIX + a.id);
      if (data === null) return undefined;
      if (area === tab) storedFiles.add(a.id);
      return data;
    } catch {
      return undefined;
    }
  };
  const session = isObj(v) && Array.isArray(v.entries)
    ? { startedAt: str(v.startedAt, new Date().toISOString()), entries: cleanEntries(v.entries, contents) }
    : newSession();
  if (area === tab) {
    removeUnusedFiles(session);
    return session;
  }
  // Moved from shared storage into this tab's own.
  try {
    shared().removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
  removeUnusedFiles(newSession(), shared);
  if (session.entries.length) saveSession(session);
  return session;
}

/**
 * Entries as stored, or as saved in a file, made fit to use: malformed ones dropped, each
 * file's contents taken from `contents` (absent if there are none), and a reply that was
 * still arriving kept as stopped, with what had arrived.
 */
function cleanEntries(raw: unknown[], contents: (a: Attachment | MadeFile) => string | undefined): Entry[] {
  const entries: Entry[] = [];
  for (const e of raw) {
    if (!isObj(e) || typeof e.id !== "string" || typeof e.speaker !== "string" || typeof e.text !== "string") continue;
    const entry = e as unknown as Entry;
    for (const a of [...(entry.attachments ?? []), ...(entry.made ?? [])]) {
      delete a.unsaved;
      if ("removed" in a && a.removed) {
        delete a.data; // removed by you: its slot is freed when the conversation is next stored
        continue;
      }
      const data = contents(a);
      if (data !== undefined) a.data = data;
      else delete a.data;
    }
    // A reply that was still arriving when the page closed (or was saved): keep what arrived, if anything.
    if (entry.status === "streaming") {
      // (While arriving, a reply's text still holds any files it is writing.)
      const split = splitFiles(entry.text);
      entry.text = split.text;
      if (split.files.length) {
        entry.made = split.files.map(madeFileFrom);
      }
      if (!entry.text.trim() && !entry.made?.length) continue;
      entry.status = "stopped";
    }
    entries.push(entry);
  }
  return entries;
}

/** Save the conversation (without file contents or thinking) and any files not yet stored. */
export function saveSession(s: Session): boolean {
  for (const a of allAttachments(s)) {
    if (!a.data || storedFiles.has(a.id)) continue;
    try {
      tab().setItem(FILE_PREFIX + a.id, a.data);
      storedFiles.add(a.id);
      delete a.unsaved;
    } catch {
      a.unsaved = true;
    }
  }
  // File contents go in their own slots; thinking is never stored.
  const ok = write(tab, SESSION_KEY, s, (key, value: unknown) => (key === "data" || key === "thinking" ? undefined : value));
  removeUnusedFiles(s);
  return ok;
}

/** Delete stored files that no entry refers to any more (removed entries, old conversations). */
function removeUnusedFiles(s: Session, area = tab): void {
  const used = new Set(allAttachments(s).map((a) => a.id));
  try {
    const stale: string[] = [];
    for (let i = 0; i < area().length; i++) {
      const key = area().key(i);
      if (key?.startsWith(FILE_PREFIX) && !used.has(key.slice(FILE_PREFIX.length))) stale.push(key);
    }
    for (const key of stale) {
      area().removeItem(key);
      storedFiles.delete(key.slice(FILE_PREFIX.length));
    }
  } catch {
    /* storage unavailable */
  }
}

// Which of the recent conversations (see recent.ts) this tab's conversation is kept as.

const RECENT_ID_KEY = "dialog.recentId.v1";
let recentIdNow: string | undefined;

/** The id this tab's conversation is kept under among the recent ones: made on first use, kept through reloads. */
export function recentId(): string {
  if (recentIdNow === undefined) {
    const v = read(tab, RECENT_ID_KEY);
    recentIdNow = typeof v === "string" ? v : newId();
    write(tab, RECENT_ID_KEY, recentIdNow);
  }
  return recentIdNow;
}

/** Keep this tab's conversation under `id` from now on: a new one for a new conversation. */
export function setRecentId(id = newId()): void {
  recentIdNow = id;
  write(tab, RECENT_ID_KEY, id);
}

// A saved conversation, to resume: Save All and Save Selected write the readable page with
// the conversation's data inside it, in a block the browser doesn't show or run.

/** Marks the data block in a saved page as Dialog's. */
const CONVERSATION_FORMAT = "dialog-conversation";
const DATA_OPEN = `<script type="application/json" id="${CONVERSATION_FORMAT}">`;

/**
 * A saved page with the data to resume it added at the end: the turns (all of them, or just
 * those in `only`, which then leaves out failed replies, as the page does), with every
 * attachment and every file made in full, and the participants, house rules, your name and
 * About you. Never the keys, the LM Studio address or the participants' thinking.
 */
export function withConversationData(html: string, session: Session, settings: Settings, only?: ReadonlySet<string>, savedAt = new Date()): string {
  // With every "<" written as \u003c, nothing in the data can end the block early.
  const json = JSON.stringify(conversationData(session, settings, only, savedAt)).replace(/</g, "\\u003c");
  const block = `${DATA_OPEN}${json}</script>\n`;
  const end = html.lastIndexOf("</body>");
  return end === -1 ? html + block : html.slice(0, end) + block + html.slice(end);
}

/** What a saved page carries to resume the conversation (and what Recent… keeps of one). */
export interface ConversationData {
  format: typeof CONVERSATION_FORMAT;
  version: 1;
  savedAt: string;
  humanName: string;
  aboutHuman: string;
  houseRules: string;
  seats: Seat[];
  startedAt: string;
  entries: Entry[];
}

/**
 * The data to resume a conversation (see withConversationData), as a copy of its own:
 * changing the conversation afterwards doesn't change it. Thinking is never included.
 */
export function conversationData(session: Session, settings: Settings, only?: ReadonlySet<string>, savedAt = new Date()): ConversationData {
  const entries = only?.size ? session.entries.filter((e) => only.has(e.id) && isSettled(e)) : session.entries;
  const data: ConversationData = {
    format: CONVERSATION_FORMAT,
    version: 1,
    savedAt: savedAt.toISOString(),
    humanName: settings.humanName,
    aboutHuman: settings.aboutHuman,
    houseRules: settings.houseRules,
    seats: settings.seats,
    startedAt: session.startedAt,
    entries,
  };
  return JSON.parse(JSON.stringify(data, (key, value: unknown) => (key === "unsaved" || key === "thinking" ? undefined : value))) as ConversationData;
}

/** Is this the data to resume a conversation (at least in outline)? */
export function isConversationData(v: unknown): v is ConversationData {
  return isObj(v) && v.format === CONVERSATION_FORMAT && Array.isArray(v.entries);
}

export interface ResumedConversation {
  session: Session;
  /** The current settings with the participants, house rules, name and About you from the file. */
  settings: Settings;
  savedAt?: Date;
}

/**
 * Read a page saved with Save All or Save Selected. Throws an Error in plain words if it
 * isn't one, or was saved before conversations could be resumed.
 */
export function conversationFromFile(text: string, current: Settings): ResumedConversation {
  const start = text.indexOf(DATA_OPEN);
  const end = start === -1 ? -1 : text.indexOf("</script>", start);
  let v: unknown;
  if (end !== -1) {
    try {
      v = JSON.parse(text.slice(start + DATA_OPEN.length, end));
    } catch {
      v = undefined;
    }
  }
  if (!isConversationData(v)) {
    if (start === -1 && /<header class="doc-head">/.test(text)) {
      throw new Error("That conversation was saved by an earlier version of Dialog, which didn't keep what's needed to resume it. It can still be read by a browser.");
    }
    throw new Error("That isn't a conversation saved by Dialog (with Save All or Save Selected).");
  }
  return conversationFromData(v, current);
}

/** A conversation to resume from its data (from a saved page, or kept by Recent…). */
export function conversationFromData(v: ConversationData, current: Settings): ResumedConversation {
  const parsed = parseSettings({ ...v, seats: Array.isArray(v.seats) ? v.seats : [] });
  const settings: Settings = { ...current, humanName: parsed.humanName, aboutHuman: parsed.aboutHuman, houseRules: parsed.houseRules, seats: parsed.seats };
  const entries = cleanEntries(v.entries, (a) => (typeof a.data === "string" ? a.data : undefined));
  const session = { startedAt: str(v.startedAt, new Date().toISOString()), entries };
  const savedAt = typeof v.savedAt === "string" && !Number.isNaN(Date.parse(v.savedAt)) ? new Date(v.savedAt) : undefined;
  return { session, settings, savedAt };
}

// Dialog's copy of OpenRouter's model list, with the time it was fetched.

/** A copy older than this is replaced: when the page opens, and when the model picker does. */
export const MODELS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface CachedModels {
  models: ModelInfo[];
  /** When the list was fetched from OpenRouter (milliseconds since 1970, as Date.now()). */
  at: number;
}

/**
 * The saved copy of the model list, however old: an old copy is still shown while a new one
 * is fetched, and kept if that fails. Null if there is none.
 */
export function loadCachedModels(): CachedModels | null {
  const v = read(shared, MODELS_KEY);
  if (!isObj(v) || typeof v.at !== "number" || !Array.isArray(v.models)) return null;
  return { models: v.models as ModelInfo[], at: v.at };
}

/**
 * Is a copy fetched at `at` too old to keep using? (No copy at all, `at` = 0, is.) So is one
 * dated more than a few minutes ahead, as when the computer's clock was wrong and has since
 * been put right: otherwise it would go unreplaced until the wrong date came round.
 */
export function modelsAreStale(at: number, now = Date.now()): boolean {
  return now - at > MODELS_MAX_AGE_MS || at - now > 5 * 60 * 1000;
}

export function saveCachedModels(models: ModelInfo[], at = Date.now()): void {
  write(shared, MODELS_KEY, { at, models });
}

// How the model picker sorts its list: remembered in this browser.

const MODEL_SORT_KEY = "dialog.modelSort.v1";

export function loadModelSort(): ModelSort {
  const v = read(shared, MODEL_SORT_KEY);
  return MODEL_SORTS.find((x) => x === v) ?? "name";
}

export function saveModelSort(sort: ModelSort): void {
  write(shared, MODEL_SORT_KEY, sort);
}
