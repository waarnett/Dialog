// Recent conversations: the latest 25, kept in the browser's database (IndexedDB), which,
// unlike a tab's own storage, outlives the tab and has room for the files as well. A safety
// net for a conversation whose tab was closed, or that was cleared with New conversation,
// before it was saved; not an archive (the browser deletes it with the site's data). Every
// access is guarded: if the database is unavailable, Restore… lists only saved files.
// The database also remembers the folders you add to Restore…, where the browser lets a page
// keep a folder (Chrome and Edge; not Safari).

import { firstSentence } from "./export";
import { isConversationData, type ConversationData } from "./storage";

/** How many conversations are kept: keeping one more forgets the one kept longest ago. */
export const KEEP_RECENT = 25;

/** What the list shows of a kept conversation (stored apart from it, so the list is quick to read). */
export interface RecentSummary {
  id: string;
  /** When it was last kept (ISO), which is shortly after its latest change. */
  savedAt: string;
  /** The first sentence of your first message ("" if you haven't written one). */
  title: string;
  /** The participants' names. */
  seats: string[];
  turns: number;
}

export function recentSummary(id: string, data: ConversationData): RecentSummary {
  const first = data.entries.find((e) => e.speaker === "human" && e.text.trim());
  const { sentence } = firstSentence(first?.text ?? "");
  const title = sentence.length > 200 ? sentence.slice(0, 200).trimEnd() + "…" : sentence;
  return { id, savedAt: data.savedAt, title, seats: data.seats.map((s) => s.name), turns: data.entries.length };
}

export function newestFirst(list: RecentSummary[]): RecentSummary[] {
  return [...list].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** The ids of the conversations beyond the newest `keep`, to forget. */
export function beyondKept(list: RecentSummary[], keep = KEEP_RECENT): string[] {
  return newestFirst(list)
    .slice(keep)
    .map((s) => s.id);
}

// The database: the summaries in one store and the conversations in another, both by id;
// and (since version 2) the folders you've added in a third.

const DB_NAME = "dialog";
const SUMMARIES = "recentSummaries";
const CONVERSATIONS = "recentConversations";
const FOLDERS = "folders";
const SAVES_FOLDERS = "added";

let opening: Promise<IDBDatabase | null> | undefined;

/** The database, opened once (and again if the browser closes it); null if it can't be. */
function database(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = (ev) => {
        if (ev.oldVersion < 1) {
          req.result.createObjectStore(SUMMARIES, { keyPath: "id" });
          req.result.createObjectStore(CONVERSATIONS);
        }
        if (ev.oldVersion < 2) req.result.createObjectStore(FOLDERS);
      };
      req.onsuccess = () => {
        req.result.onclose = () => (opening = undefined);
        resolve(req.result);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // no database in this browser
    }
  });
  return opening;
}

function result<T>(req: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

/**
 * Keep a conversation under `id`, replacing what was kept under it before, and forget any
 * beyond the newest 25. True if it was kept.
 */
export async function keepRecent(id: string, data: ConversationData): Promise<boolean> {
  const db = await database();
  if (!db) return false;
  try {
    const tx = db.transaction([SUMMARIES, CONVERSATIONS], "readwrite");
    const summaries = tx.objectStore(SUMMARIES);
    const conversations = tx.objectStore(CONVERSATIONS);
    summaries.put(recentSummary(id, data));
    conversations.put(data, id);
    const all = summaries.getAll();
    all.onsuccess = () => {
      for (const old of beyondKept(all.result as RecentSummary[])) {
        summaries.delete(old);
        conversations.delete(old);
      }
    };
    return await new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    });
  } catch {
    opening = undefined; // the connection may have been lost: open it again next time
    return false;
  }
}

/** The kept conversations, newest first. */
export async function listRecent(): Promise<RecentSummary[]> {
  const db = await database();
  if (!db) return [];
  try {
    const list = await result(db.transaction(SUMMARIES).objectStore(SUMMARIES).getAll());
    return newestFirst((list ?? []) as RecentSummary[]);
  } catch {
    opening = undefined;
    return [];
  }
}

/** A kept conversation's data; null if it's no longer kept. */
export async function loadRecent(id: string): Promise<ConversationData | null> {
  const db = await database();
  if (!db) return null;
  try {
    const data = await result(db.transaction(CONVERSATIONS).objectStore(CONVERSATIONS).get(id));
    return isConversationData(data) ? data : null;
  } catch {
    opening = undefined;
    return null;
  }
}

/** Forget a kept conversation. True if it's gone. */
export async function deleteRecent(id: string): Promise<boolean> {
  const db = await database();
  if (!db) return false;
  try {
    const tx = db.transaction([SUMMARIES, CONVERSATIONS], "readwrite");
    tx.objectStore(SUMMARIES).delete(id);
    tx.objectStore(CONVERSATIONS).delete(id);
    return await new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    });
  } catch {
    opening = undefined;
    return false;
  }
}

/** The parts of a folder the browser lets a page keep (Chrome and Edge) that Dialog uses. */
export interface SavesFolder {
  name: string;
  values(): AsyncIterable<{ kind: string; name: string; getFile?(): Promise<File> }>;
  isSameEntry(other: SavesFolder): Promise<boolean>;
  queryPermission(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" }): Promise<PermissionState>;
}

/** Remember the folders you've added. */
export async function rememberFolders(folders: SavesFolder[]): Promise<void> {
  const db = await database();
  if (!db) return;
  try {
    db.transaction(FOLDERS, "readwrite").objectStore(FOLDERS).put(folders, SAVES_FOLDERS);
  } catch {
    opening = undefined;
  }
}

/** The folders you've added, as remembered. */
export async function rememberedFolders(): Promise<SavesFolder[]> {
  const db = await database();
  if (!db) return [];
  try {
    const folders = await result(db.transaction(FOLDERS).objectStore(FOLDERS).get(SAVES_FOLDERS));
    return Array.isArray(folders) ? (folders as SavesFolder[]) : [];
  } catch {
    opening = undefined;
    return [];
  }
}
