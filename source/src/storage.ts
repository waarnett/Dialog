// Saving and loading through the browser's local storage, which keeps data on this
// computer, for this page, between visits. Every access is guarded: if storage is unavailable,
// Dialog still works, it just can't remember anything after the page closes.

import { defaultSettings, madeFileFrom, MODEL_SORTS, newId, newSession, SEAT_COLORS, splitFiles, upgradeHouseRules, type ModelSort } from "./engine";
import type { ModelInfo } from "./openrouter";
import type { Attachment, Entry, MadeFile, Seat, Session, Settings } from "./types";

const SETTINGS_KEY = "dialog.settings.v1";
const SESSION_KEY = "dialog.session.v1";
const MODELS_KEY = "dialog.models.v5"; // v3 added what each model takes in; v4, whether it can use tools; v5, what a ~latest id stands for

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown, replacer?: (key: string, value: unknown) => unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value, replacer));
    return true;
  } catch {
    return false;
  }
}

/** True if the browser is letting this page store data. */
export function storageWorks(): boolean {
  try {
    localStorage.setItem("dialog.probe", "1");
    localStorage.removeItem("dialog.probe");
    return true;
  } catch {
    return false;
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

export function loadSettings(): Settings {
  return parseSettings(read(SETTINGS_KEY));
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

export function saveSettings(s: Settings): boolean {
  return write(SETTINGS_KEY, s);
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
// page only a few megabytes in all; a file that doesn't fit stays in memory and is marked.

const FILE_PREFIX = "dialog.file.";
/** Files known to be in storage already, so they aren't rewritten on every save. */
const storedFiles = new Set<string>();

/** Every stored file: your attachments and the files participants made (except removed ones). */
function allAttachments(s: Session): (Attachment | MadeFile)[] {
  return s.entries.flatMap((e) => [...(e.attachments ?? []), ...(e.made ?? []).filter((f) => !f.removed)]);
}

export function loadSession(): Session {
  const v = read(SESSION_KEY);
  if (!isObj(v) || !Array.isArray(v.entries)) return newSession();
  const entries: Entry[] = [];
  for (const e of v.entries) {
    if (!isObj(e) || typeof e.id !== "string" || typeof e.speaker !== "string" || typeof e.text !== "string") continue;
    const entry = e as unknown as Entry;
    for (const a of [...(entry.attachments ?? []), ...(entry.made ?? [])]) {
      delete a.unsaved;
      if ("removed" in a && a.removed) {
        delete a.data; // removed by you: its slot is freed below
        continue;
      }
      try {
        const data = localStorage.getItem(FILE_PREFIX + a.id);
        if (data !== null) {
          a.data = data;
          storedFiles.add(a.id);
        } else {
          delete a.data;
        }
      } catch {
        delete a.data;
      }
    }
    // A reply that was still arriving when the page closed: keep what arrived, if anything.
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
  const session = { startedAt: str(v.startedAt, new Date().toISOString()), entries };
  removeUnusedFiles(session);
  return session;
}

/** Save the conversation (without file contents) and any files not yet stored. */
export function saveSession(s: Session): boolean {
  for (const a of allAttachments(s)) {
    if (!a.data || storedFiles.has(a.id)) continue;
    try {
      localStorage.setItem(FILE_PREFIX + a.id, a.data);
      storedFiles.add(a.id);
      delete a.unsaved;
    } catch {
      a.unsaved = true;
    }
  }
  const ok = write(SESSION_KEY, s, (key, value: unknown) => (key === "data" ? undefined : value));
  removeUnusedFiles(s);
  return ok;
}

/** Delete stored files that no entry refers to any more (removed entries, old conversations). */
function removeUnusedFiles(s: Session): void {
  const used = new Set(allAttachments(s).map((a) => a.id));
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(FILE_PREFIX) && !used.has(key.slice(FILE_PREFIX.length))) stale.push(key);
    }
    for (const key of stale) {
      localStorage.removeItem(key);
      storedFiles.delete(key.slice(FILE_PREFIX.length));
    }
  } catch {
    /* storage unavailable */
  }
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
  const v = read(MODELS_KEY);
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
  write(MODELS_KEY, { at, models });
}

// How the model picker sorts its list: remembered in this browser.

const MODEL_SORT_KEY = "dialog.modelSort.v1";

export function loadModelSort(): ModelSort {
  const v = read(MODEL_SORT_KEY);
  return MODEL_SORTS.find((x) => x === v) ?? "name";
}

export function saveModelSort(sort: ModelSort): void {
  write(MODEL_SORT_KEY, sort);
}
