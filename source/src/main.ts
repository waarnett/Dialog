// The page: draws the conversation and the participants, and wires up the buttons.
// The rules of the conversation live in engine.ts; talking to OpenRouter lives in
// openrouter.ts, and what differs for LM Studio in lmstudio.ts. This file only connects
// them to what you see and click.

import DOMPurify from "dompurify";
import { Marked } from "marked";
import { readAttachment } from "./attachments";
import { conversationFileName, conversationHtml, copiedHtml, copiedText, escapeHtml, type CopiedTurn, type ExportOptions } from "./export";
import { makerOf, type Maker } from "./makers";
import { MATH_CSS, mathExtension, mathHtml, mathSource } from "./math";
import { prettyHtml } from "./pretty";
import {
  addressedSeat,
  addresseeLabel,
  buildMessages,
  readAddress,
  teamCall,
  type TeamCall,
  copySeat,
  defaultSettings,
  friendlySeatName,
  NEW_SEAT_NAME,
  seatColorFor,
  uniqueSeatName,
  describeAttachment,
  describeMadeFile,
  formatBytes,
  madeFileFrom,
  replacedFiles,
  splitFiles,
  hasFileParts,
  DEFAULT_HOUSE_RULES,
  formatCost,
  isSettled,
  speedDetails,
  speedLabel,
  waitingLabel,
  turnSpeed,
  turnDetails,
  privateGroup,
  privateLabel,
  privateWithFor,
  type Addressing,
  formatAsOf,
  formatDate,
  MODEL_SORTS,
  type ModelSort,
  sortModels,
  formatTime,
  newId,
  newSession,
  stripSelfPrefix,
  pauseBreak,
  thinkingChoices,
  thinkingLabel,
  totalCost,
} from "./engine";
import { fetchLocalModels, isLocalModel, LOCAL_EXAMPLE } from "./lmstudio";
import { fetchCredits, fetchHost, fetchKeyInfo, fetchModels, OpenRouterError, streamChat, type CreditInfo, type KeyInfo, type ModelInfo } from "./openrouter";
import * as store from "./storage";
import type { Addressee, Attachment, Entry, MadeFile, MadeKind, Seat } from "./types";

// ---------------------------------------------------------------------------
// State

let settings = store.loadSettings();
let session = store.loadSession();
/** OpenRouter's model list: Dialog's saved copy at first, however old, until a new one comes. */
const savedModels = store.loadCachedModels();
let models: ModelInfo[] = savedModels?.models ?? [];
/** When `models` was fetched from OpenRouter (milliseconds since 1970; 0 if never). */
let modelsAt = savedModels?.at ?? 0;
/** A fetch of the model list under way, if any. */
let modelsLoading: Promise<void> | null = null;
/** Why the last fetch of the model list failed ("" if it didn't). */
let modelsError = "";
/** LM Studio's models, if its address is set in Settings: fetched afresh each time the picker opens, never kept. */
let localModels: ModelInfo[] = [];
/** Has LM Studio's list been fetched from the address now in Settings? */
let localFetched = false;
/** A fetch of LM Studio's list under way, if any. */
let localLoading: Promise<void> | null = null;
/** Why the last fetch of LM Studio's list failed ("" if it didn't). */
let localError = "";
/** How the model picker sorts the list (remembered in this browser). */
let modelSort: ModelSort = store.loadModelSort();
let keyInfo: KeyInfo | null = null;
let keyInfoFailed = false;
/** The account's remaining credit, if a management key is set and worked. */
let credit: CreditInfo | null = null;
let creditError = "";
/**
 * The replies arriving now, by seat. Usually one seat speaks at a time; in an independent
 * round ("…independently, team") all of them speak at once.
 */
const busy = new Map<string, { entryId: string; controller: AbortController }>();
/**
 * A round in progress ("…, team", or a list of names): every participant speaking once,
 * one after another, or (`parallel`, for an independent round) all at once.
 */
let round: { cancelled: boolean; parallel: boolean } | null = null;
/** Is a reply (or a round of them) under way? */
const occupied = () => busy.size > 0 || round !== null;
/** Is this entry a reply still arriving? */
const arriving = (entryId: string) => [...busy.values()].some((b) => b.entryId === entryId);
const canStore = store.storageWorks();

// ---------------------------------------------------------------------------
// Small DOM helpers

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Dialog: missing element #${id}`);
  return el as T;
}

type AttrValue = string | number | boolean | undefined | ((ev: Event) => void);
type Child = Node | string | null | undefined | false;

/** Create an element: h("button", { class: "primary", onclick: fn }, "Speak"). */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (val === undefined || val === false) continue;
    if (typeof val === "function") el.addEventListener(key.slice(2), val);
    else if (key === "class") el.className = String(val);
    else if (key === "value") (el as HTMLInputElement).value = String(val);
    else if (key === "checked") (el as HTMLInputElement).checked = Boolean(val);
    else if (val === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(val));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/**
 * Dialog's version, shown on the welcome screen and in Settings. The second number goes up
 * with each release; between releases a third counts the changes made since (dropped on release).
 */
const VERSION = "2.6";

const els = {
  transcript: byId("transcript"),
  sessionCost: byId("session-cost"),
  keyInfo: byId("key-info"),
  banner: byId("banner"),
  composer: byId<HTMLFormElement>("composer"),
  composerText: byId<HTMLTextAreaElement>("composer-text"),
  composerTo: byId<HTMLSelectElement>("composer-to"),
  composerSend: byId<HTMLButtonElement>("composer-send"),
  composerHint: byId("composer-hint"),
  conversation: byId("conversation"),
  attachTray: byId("attach-tray"),
  attachStatus: byId("attach-status"),
  attachButton: byId<HTMLButtonElement>("attach-button"),
  attachInput: byId<HTMLInputElement>("attach-input"),
  seatList: byId("seat-list"),
  modelDialog: byId<HTMLDialogElement>("model-dialog"),
  modelTitle: byId("model-title"),
  modelSearch: byId<HTMLInputElement>("model-search"),
  modelSort: byId<HTMLSelectElement>("model-sort"),
  modelResults: byId("model-results"),
  modelCount: byId("model-count"),
  modelRefresh: byId<HTMLButtonElement>("model-refresh"),
  modelCancel: byId<HTMLButtonElement>("model-cancel"),
  brand: byId<HTMLButtonElement>("brand"),
  brandVersion: byId("brand-version"),
  btnSave: byId<HTMLButtonElement>("btn-save"),
  btnResume: byId<HTMLButtonElement>("btn-resume"),
  btnNew: byId<HTMLButtonElement>("btn-new"),
  btnSettings: byId<HTMLButtonElement>("btn-settings"),
  btnAddSeat: byId<HTMLButtonElement>("btn-add-seat"),
  dialog: byId<HTMLDialogElement>("settings-dialog"),
  setVersion: byId("set-version"),
  setKey:byId<HTMLInputElement>("set-key"),
  setKeyShow: byId<HTMLButtonElement>("set-key-show"),
  setMkey: byId<HTMLInputElement>("set-mkey"),
  setMkeyShow: byId<HTMLButtonElement>("set-mkey-show"),
  setLocal: byId<HTMLInputElement>("set-local"),
  creditInfo: byId("credit-info"),
  setName: byId<HTMLInputElement>("set-name"),
  setAbout: byId<HTMLTextAreaElement>("set-about"),
  setRules: byId<HTMLTextAreaElement>("set-rules"),
  setRulesReset: byId<HTMLButtonElement>("set-rules-reset"),
  setSaveFile: byId<HTMLButtonElement>("set-save-file"),
  setRestoreFile: byId<HTMLButtonElement>("set-restore-file"),
  setRestoreInput: byId<HTMLInputElement>("set-restore-input"),
  setIncludeKeys: byId<HTMLInputElement>("set-include-keys"),
  setFileStatus: byId("set-file-status"),
  resumeInput: byId<HTMLInputElement>("resume-input"),
};

// ---------------------------------------------------------------------------
// Markdown rendering (replies are Markdown, often with LaTeX math; this turns them into safe HTML)

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

document.head.append(h("style", {}, MATH_CSS));
const markdown = new Marked(mathExtension(mathHtml));
/** For a reply still arriving: its math is shown as written until the reply is complete. */
const arrivingMarkdown = new Marked(mathExtension(mathSource));

function renderMarkdown(text: string, keepLineBreaks: boolean, arriving = false): string {
  const html = (arriving ? arrivingMarkdown : markdown).parse(text, { async: false, gfm: true, breaks: keepLineBreaks }) as string;
  return DOMPurify.sanitize(html);
}

// ---------------------------------------------------------------------------
// Saving

let warnedStorage = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist(): void {
  clearTimeout(saveTimer);
  const ok = store.saveSettings(settings) && store.saveSession(session);
  if (!ok && !warnedStorage) {
    warnedStorage = true;
    updateBanner();
  }
}

/** Save shortly after typing stops, rather than on every keystroke. */
function persistSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

// ---------------------------------------------------------------------------
// Lookups

const seatById = (id: string): Seat | undefined => settings.seats.find((s) => s.id === id);
const seatCost = (id: string): number => totalCost(session.entries.filter((e) => e.speaker === id));
const hasKey = (): boolean => settings.apiKey.trim() !== "";
/** Is there an LM Studio address in Settings? */
const hasLocal = (): boolean => settings.localServer.trim() !== "";

/** "$4", "$0.75"; "varies" for a router's price (OpenRouter lists it as -1). */
function priceText(n: number): string {
  return n < 0 ? "varies" : "$" + String(Number(n.toFixed(2)));
}

// ---------------------------------------------------------------------------
// Top bar and banner

/** Where OpenRouter sells credit. */
const CREDITS_PAGE = "https://openrouter.ai/settings/credits";

function renderTopbar(): void {
  els.sessionCost.textContent = `This conversation: ${formatCost(totalCost(session.entries))}`;
  // The account's remaining credit: only visible with a management key (optional, in Settings).
  if (credit) {
    // A link to OpenRouter's Credits page, where you can buy more.
    els.creditInfo.replaceChildren(
      h("a", { href: CREDITS_PAGE, target: "_blank", rel: "noopener noreferrer" }, `Credit left: ${formatCost(credit.remaining)}`),
    );
    els.creditInfo.title =
      `Your OpenRouter account: ${formatCost(credit.purchased)} of credit bought, ${formatCost(credit.used)} used ` +
      `(by all your keys), ${formatCost(credit.remaining)} left. Click to add credit on OpenRouter's Credits page.`;
  } else {
    els.creditInfo.textContent = creditError ? "Credit: couldn't check" : "";
    if (creditError) els.creditInfo.title = creditError;
    else els.creditInfo.removeAttribute("title");
  }

  // What OpenRouter tells an ordinary key: its own spending (this month, all time) and its cap.
  if (keyInfo) {
    els.keyInfo.textContent = `This month: ${formatCost(keyInfo.usageMonthly)}`;
    const limit =
      keyInfo.limit === null
        ? "It has no spending limit."
        : `Its limit is ${formatCost(keyInfo.limit)}` +
          (keyInfo.limitReset ? `, resetting ${keyInfo.limitReset}` : ", never resetting") +
          (keyInfo.remaining !== null ? `, with ${formatCost(keyInfo.remaining)} of it unused` : "") +
          ". A limit is a cap, not money in your account.";
    els.keyInfo.title =
      `Spent with this API key this calendar month: ${formatCost(keyInfo.usageMonthly)} (months begin at midnight UTC). ` +
      `All time: ${formatCost(keyInfo.usage)}. ${limit}`;
  } else {
    els.keyInfo.textContent = keyInfoFailed ? "Couldn't check this key's spending" : "";
    els.keyInfo.removeAttribute("title");
  }
  updateSaveButton();
}

/** Turns ticked for saving (by id). Kept only while the page is open. */
const picked = new Set<string>();

/** "Save All", or "Save Selected" while any turn is ticked; and Resume… only while the conversation is empty. */
function updateSaveButton(): void {
  for (const id of picked) if (!session.entries.some((e) => e.id === id)) picked.delete(id);
  const n = picked.size;
  els.btnSave.textContent = n ? "Save Selected" : "Save All";
  els.btnSave.title = n
    ? `Save the ${n === 1 ? "ticked turn" : `${n} ticked turns`} as an HTML file. Untick them all to save everything.`
    : "Save the whole conversation as an HTML file. Tick the box beside particular turns to save just those.";
  els.btnSave.disabled = session.entries.length === 0;
  els.btnResume.hidden = session.entries.length > 0;
}

function updateBanner(): void {
  const msgs: string[] = [];
  if (!canStore || warnedStorage) {
    msgs.push("Your browser isn't letting Dialog save, so this conversation and your settings will be lost when the page closes.");
  }
  if (!hasKey() && !hasLocal()) msgs.push("Add your OpenRouter API key in Settings to begin.");
  els.banner.hidden = msgs.length === 0;
  els.banner.textContent = msgs.join(" ");
}

// ---------------------------------------------------------------------------
// The conversation

/**
 * Is the conversation following the latest words? Yes until you scroll up from the bottom,
 * and again once you scroll back down to it (see followScrolling). Arriving text is scrolled
 * into view only while it is; otherwise the conversation stays where you put it.
 */
let following = true;
let lastScrollTop = 0;

/**
 * On each scroll of the conversation. Only a move upward stops the following: the window or
 * the panels around the conversation changing size can leave it short of the bottom without
 * your having scrolled at all.
 */
function followScrolling(): void {
  const top = els.transcript.scrollTop;
  if (atBottom()) following = true;
  else if (top < lastScrollTop) following = false;
  lastScrollTop = top;
}

function atBottom(): boolean {
  const t = els.transcript;
  return t.scrollHeight - t.scrollTop - t.clientHeight < 8;
}

function scrollToBottom(): void {
  els.transcript.scrollTop = els.transcript.scrollHeight;
  following = true;
}

/** The welcome screen shown while the conversation is empty: the engraving and how to begin. */
function emptyState(): HTMLElement {
  const figure = byId<HTMLTemplateElement>("welcome-figure").content.cloneNode(true);
  return h(
    "div",
    { class: "empty" },
    figure as DocumentFragment,
    h(
      "div",
      { class: "how" },
      h("h2", {}, "Start a dialogue"),
      h(
        "ol",
        {},
        hasKey() || hasLocal()
          ? null
          : h(
              "li",
              {},
              "Open Settings and paste your OpenRouter API key (or, for models running in LM Studio on this computer, its server’s address). " +
                "While you're there, put in your name and a few words about yourself.",
            ),
        settings.seats.length
          ? null
          : h(
              "li",
              {},
              "Add participants: press + Add a seat, under Participants on the right, and choose a model. " +
                "Each new seat is named after its model (you can rename it). Add as many as you like, including several of the same model.",
            ),
        h("li", {}, "If you like, give each participant a role: open Role on its card. A role is standing instructions only that participant sees."),
        h(
          "li",
          {},
          "Every participant also follows the house rules: how the group talks, and how each one should think and contribute. " +
            "You can read and edit them in Settings.",
        ),
        h(
          "li",
          {},
          "Write below. Return adds what you’ve typed and asks a participant to reply: the one named at the end of your message " +
            "(“…what do you think, Grok?”), or else whoever spoke last; the note beside the button shows who. " +
            `${ADD_KEY} or Add to conversation just adds it, and no one replies until you press a participant’s Speak button. ` +
            `${NEWLINE_KEY} starts a new line. To have one participant answer another, press Speak on the one who should answer.`,
        ),
        h(
          "li",
          {},
          "To ask several, end with their names (“…, Claude and Gemini”): just those reply, once each, in the order named. " +
            "End with “team” and every participant replies once, in turn. Add “independently” or “in parallel” " +
            "(“…independently, team”) and they all reply at once, each without seeing the others’ replies. " +
            "Tick Sleep on a card to have that participant sit out “team” rounds; it still replies if you name it.",
        ),
        h("li", {}, "To speak to one participant privately, choose it under To. It replies at once, and the others never see the exchange."),
        h(
          "li",
          {},
          "Ask a participant for a file (a document, a table, a drawing, a small web page) and it appears under the reply, " +
            "with buttons to open or save it. The others see it too, until you remove it.",
        ),
        h(
          "li",
          {},
          "Save All saves the whole conversation as a web page, private exchanges included and marked. " +
            "To save only some turns, tick the box beside each one; the button then reads Save Selected. " +
            "Either file can be resumed later, with the same participants: press Resume… at the top, before the conversation starts.",
        ),
      ),
      h(
        "p",
        { class: "how-readme" },
        "Everything else is explained in the ",
        h("a", { href: "README.html", target: "_blank", rel: "noopener" }, "README"),
        " (it opens in a new tab; keep README.html in the same folder as this page).",
      ),
      h(
        "p",
        { class: "how-note" },
        "A note: the participants are the same models as in their makers’ own chat apps (ChatGPT, Claude, Gemini and the rest), " +
          "but they don’t get those apps’ hidden instructions. Each gets Dialog’s house rules, what you’ve written about yourself " +
          "and its role instead, so its answers may differ from what the app would say.",
      ),
      h("p", { class: "how-version" }, `Version ${VERSION}`),
    ),
  );
}

/** Replies whose full particulars are showing (by id). Kept only while the page is open. */
const opened = new Set<string>();

/** Replies whose thinking is showing (by id). Kept only while the page is open. */
const thinkingOpen = new Set<string>();

/** A reply's thinking, folded up under a "Thinking" line until opened. */
function thinkingBox(e: Entry): HTMLElement {
  const box = h(
    "details",
    {
      class: "thinking",
      open: thinkingOpen.has(e.id),
      ontoggle: () => {
        if (box.open) thinkingOpen.add(e.id);
        else thinkingOpen.delete(e.id);
        fillThinking(box, e);
      },
    },
    h("summary", {}, "Thinking"),
    h("div", { class: "thought" }),
  );
  fillThinking(box, e);
  return box;
}

/**
 * The thinking so far, written out only while it is open. The line reads "Thinking…" while
 * the thinking is still arriving (no reply text yet), and "Thinking" once it is complete.
 */
function fillThinking(box: HTMLDetailsElement, e: Entry): void {
  const summary = box.querySelector("summary");
  if (summary) summary.textContent = e.status === "streaming" && !e.text ? "Thinking…" : "Thinking";
  const thought = box.querySelector<HTMLElement>(".thought");
  if (thought) thought.innerHTML = box.open ? renderMarkdown(e.thinking ?? "", false, e.status === "streaming") : "";
}

/** Replies whose host is being asked of OpenRouter now (by id). */
const hostLookups = new Set<string>();

/**
 * Tapping a reply's cost and speed: show its full particulars below the text, or hide them
 * again. Opening them asks OpenRouter for the host, if the reply didn't bring it, and
 * scrolls just far enough to show them (below a long reply, they would open out of sight).
 */
function toggleDetails(e: Entry, article: HTMLElement): void {
  if (opened.has(e.id)) opened.delete(e.id);
  else opened.add(e.id);
  const open = opened.has(e.id);
  if (open) void lookUpHost(e);
  const fresh = renderEntry(e);
  article.replaceWith(fresh);
  // When opening, the focus mustn't scroll: Safari would take the view back up to the
  // focused button, at the top of a long reply, after the particulars were scrolled into view.
  (fresh.querySelector<HTMLElement>("button.glance") ?? fresh.querySelector<HTMLElement>("button.foot"))?.focus({ preventScroll: open });
  const box = fresh.querySelector<HTMLElement>("button.foot.open");
  if (box && typeof box.scrollIntoView === "function") box.scrollIntoView({ block: "nearest" });
}

/**
 * Ask OpenRouter which host ran a reply, and keep the answer with it. If it can't say, the
 * host is left out, and asked again the next time the particulars are opened.
 */
async function lookUpHost(e: Entry): Promise<void> {
  if (e.host || !e.requestId || !hasKey() || hostLookups.has(e.id)) return;
  hostLookups.add(e.id);
  try {
    const host = await fetchHost(settings.apiKey.trim(), e.requestId);
    if (host) {
      e.host = host;
      persist();
    }
  } catch {
    /* unreachable: leave it out */
  }
  hostLookups.delete(e.id);
  // Redraw the reply, if it's still there, keeping the focus where it was.
  const article = [...els.transcript.querySelectorAll<HTMLElement>("article.entry")].find((a) => a.dataset.id === e.id);
  if (!article) return;
  const focused = article.contains(document.activeElement);
  const fresh = renderEntry(e);
  article.replaceWith(fresh);
  if (focused) (fresh.querySelector<HTMLElement>("button.glance") ?? fresh.querySelector<HTMLElement>("button.foot"))?.focus();
}

/** For pointing at a participant's name: the model that answered and the thinking level asked for. */
function replyModelTitle(e: Entry): string | undefined {
  const model = e.model ?? e.seatModel;
  const thinking =
    e.seatEffort === undefined ? "" : `thinking: ${thinkingLabel({ effort: e.seatEffort }, modelInfo(e.seatModel ?? model ?? ""))}`;
  return [model, thinking].filter(Boolean).join(", ") || undefined;
}

function renderEntry(e: Entry): HTMLElement {
  const isHuman = e.speaker === "human";
  const seat = isHuman ? undefined : seatById(e.speaker);
  const streaming = e.status === "streaming";
  const classes = ["entry", isHuman ? "human" : "bot"];
  if (e.privateWith) classes.push("private");
  if (e.status === "error") classes.push("error");
  if (streaming) classes.push("streaming");

  // A private exchange is marked like a stage direction in a printed play.
  let direction: string | undefined = e.independent ? "(answering independently)" : undefined;
  if (e.addressedTo && !e.privateWith) direction = `(${addresseeLabel(e.addressedTo, settings.seats)})`;
  const privately = privateLabel(e, settings.seats, settings.humanName);
  if (privately) direction = `(${privately})`;

  const body = h("div", { class: "body" });
  if (streaming) fillArrivingBody(body, e);
  else body.innerHTML = renderMarkdown(e.text, isHuman);
  if (!streaming && !e.text.trim() && (e.attachments?.length || e.made?.length)) body.hidden = true; // just files

  // What the reply cost and how fast it came: two lines in the margin, under the name.
  // Tapping (or clicking) them shows the full particulars below the text; tapping again hides them.
  const glance: HTMLElement[] = [];
  if (e.cost !== undefined) glance.push(h("span", { class: "cost" }, formatCost(e.cost)));
  const speed = turnSpeed(e);
  if (speed) glance.push(h("span", { class: "speed" }, speedLabel(speed)));
  const stopped = e.status === "stopped";
  const details = (glance.length || stopped) && !streaming ? turnDetails(e, allModels(), hostLookups.has(e.id)) : [];
  const open = details.length > 0 && opened.has(e.id);
  const toggle = () => toggleDetails(e, article);
  const more = () => h("span", { class: "more", "aria-hidden": "true" }, open ? "▾" : "▸");
  let glanceBox: HTMLElement | null = null;
  if (glance.length && details.length) {
    const last = glance.pop()!;
    glanceBox = h(
      "button",
      {
        type: "button",
        class: "glance",
        "aria-expanded": open ? "true" : "false",
        "aria-label": open ? undefined : "Show this reply's model, token counts and speed",
        onclick: toggle,
      },
      ...glance,
      h("span", {}, last, " ", more()),
    );
  } else if (glance.length) {
    glanceBox = h("div", { class: "glance" }, ...glance);
  }

  const article = h(
    "article",
    { class: classes.join(" "), "data-id": e.id, style: seat ? `--seat-color: ${seat.color}` : undefined },
    h(
      "header",
      {},
      h(
        "span",
        { class: "stamp" },
        isSettled(e)
          ? h("input", {
              type: "checkbox",
              class: "pick",
              checked: picked.has(e.id),
              title: "Tick to save this turn with Save Selected",
              "aria-label": "Select this turn for saving",
              onchange: (ev) => {
                if ((ev.target as HTMLInputElement).checked) picked.add(e.id);
                else picked.delete(e.id);
                updateSaveButton();
              },
            })
          : null,
        h("span", { class: "time", title: "When this turn began" }, formatTime(new Date(e.time))),
      ),
      h("span", { class: "who", title: isHuman ? undefined : replyModelTitle(e) }, e.speakerName),
      direction ? h("span", { class: "direction" }, direction) : null,
      glanceBox,
    ),
    h(
      "button",
      {
        class: "del",
        type: "button",
        title: "Remove this entry (no participant will see it from now on)",
        "aria-label": "Remove entry",
        disabled: streaming,
        onclick: () => deleteEntry(e.id),
      },
      "×",
    ),
    e.thinking ? thinkingBox(e) : null,
    body,
  );

  if (e.citations && e.citations.length) {
    article.append(
      h(
        "div",
        { class: "sources" },
        "Sources:",
        h("ul", {}, ...e.citations.map((c) => h("li", {}, h("a", { href: c.url, target: "_blank", rel: "noopener noreferrer" }, c.title || c.url)))),
      ),
    );
  }
  if (e.attachments && e.attachments.length) {
    article.append(
      h(
        "div",
        { class: "files" },
        ...e.attachments.map((a) => {
          const note = !a.data ? "No longer available." : a.unsaved ? "Not saved; lost when this page closes." : "";
          return h(
            "div",
            { class: "file" + (a.data ? "" : " missing") },
            a.kind === "image" && a.data ? h("img", { src: a.data, alt: a.name }) : null,
            h("span", { class: "file-name" }, describeAttachment(a)),
            note ? h("span", { class: "file-note" }, note) : null,
          );
        }),
      ),
    );
  }
  if (e.made?.length) article.append(madeFilesBox(e));
  if (e.error) {
    const canRetry = !isHuman && seat !== undefined;
    article.append(
      h(
        "div",
        { class: "err" },
        h("span", {}, e.error),
        canRetry
          ? h("button", { type: "button", class: "retry", disabled: occupied(), onclick: () => void retry(e) }, "Try again")
          : null,
      ),
    );
  }

  // After the text: the full particulars when they're open, or else whether the reply was cut short.
  if (open) {
    article.append(
      h(
        "button",
        { type: "button", class: "foot open", "aria-expanded": "true", onclick: toggle },
        ...details.map((line) => h("span", { class: "detail" }, line)),
        more(),
      ),
    );
  } else if (stopped && details.length && !glanceBox) {
    // Stopped before any cost or speed came: the only way to the particulars.
    article.append(
      h(
        "button",
        { type: "button", class: "foot", "aria-expanded": "false", "aria-label": "Show this reply's particulars", onclick: toggle },
        h("span", {}, "stopped early"),
        more(),
      ),
    );
  } else if (stopped) {
    article.append(h("div", { class: "foot" }, h("span", {}, "stopped early")));
  }
  return article;
}

/**
 * A reply still arriving: its text so far, without the files it is writing, and a line
 * saying which files are done and which is being written. Until anything at all arrives,
 * "waiting for <name>…" with the time waited (kept counting by tickWaiting); once thinking
 * arrives, the Thinking line above says so instead.
 */
function fillArrivingBody(body: HTMLElement, e: Entry): void {
  const split = splitFiles(e.text, true);
  body.innerHTML = split.text ? renderMarkdown(split.text, false, true) : "";
  if (!split.text && !split.files.length && !split.writing && !e.thinking) {
    body.append(h("span", { class: "waiting" }, waitingLabel(e.speakerName, Date.now() - Date.parse(e.time))));
  }
  const done = split.files.map((f) => f.name);
  if (done.length || split.writing) {
    const parts = [done.length ? `Made ${done.join(", ")}.` : "", split.writing ? `Writing ${split.writing.name} (${formatBytes(split.writing.size)} so far)…` : ""];
    body.append(h("p", { class: "writing" }, parts.filter(Boolean).join(" ")));
  }
}

let waitTicker: ReturnType<typeof setInterval> | undefined;

/**
 * Once a reply has begun: twice a second, bring the time on each "waiting for …" line up to
 * date. Stops by itself once no reply is waiting (anything arriving ends the wait).
 */
function tickWaiting(): void {
  waitTicker ??= setInterval(() => {
    let waiting = false;
    for (const e of session.entries) {
      if (e.status !== "streaming") continue;
      const line = els.transcript.querySelector(`[data-id="${e.id}"] .waiting`);
      if (!line) continue;
      line.textContent = waitingLabel(e.speakerName, Date.now() - Date.parse(e.time));
      waiting = true;
    }
    if (!waiting) {
      clearInterval(waitTicker);
      waitTicker = undefined;
    }
  }, 500);
}

/** The files a participant made in a reply, each with Open, Save and × (remove). */
function madeFilesBox(e: Entry): HTMLElement {
  const replaced = replacedFiles(session.entries);
  return h(
    "div",
    { class: "made" },
    ...(e.made ?? []).map((f) => {
      const gone = f.removed || f.data === undefined;
      const notes: string[] = [];
      if (f.removed) notes.push("Removed; no participant sees it now.");
      else if (f.data === undefined) notes.push("No longer available.");
      else {
        if (replaced.has(f.id)) notes.push("A later version replaces this one.");
        if (f.incomplete) notes.push("May be incomplete: the reply ended before the file did.");
        if (f.unsaved) notes.push("Not saved; lost when this page closes.");
      }
      const preview =
        f.kind === "svg" && !gone
          ? h("img", { class: "made-preview", src: svgDataUrl(f.data!), alt: "", onclick: () => openMadeFile(f) })
          : null;
      return h(
        "div",
        { class: `made-file kind-${f.kind}` + (gone ? " gone" : "") + (replaced.has(f.id) ? " replaced" : "") },
        preview,
        h(
          "div",
          { class: "made-info" },
          h("span", { class: "made-name" }, describeMadeFile(f)),
          notes.length ? h("span", { class: "made-note" }, notes.join(" ")) : null,
          gone
            ? null
            : h(
                "span",
                { class: "made-actions" },
                h("button", { type: "button", title: openTitle(f), onclick: () => openMadeFile(f) }, "Open"),
                h("button", { type: "button", title: "Save this file on your computer", onclick: () => void saveMadeFile(f) }, "Save…"),
                h(
                  "button",
                  {
                    type: "button",
                    class: "danger",
                    title: "Remove this file: no participant will see it from now on",
                    "aria-label": `Remove ${f.name}`,
                    disabled: arriving(e.id),
                    onclick: () => removeMadeFile(e, f),
                  },
                  "×",
                ),
              ),
        ),
      );
    }),
  );
}

function openTitle(f: MadeFile): string {
  return f.kind === "html"
    ? "Open this web page in a new tab, walled off from Dialog"
    : f.kind === "svg"
      ? "Open this drawing in a new tab"
      : f.kind === "md"
        ? "Open this file, formatted, in a new tab"
        : "Open this file in a new tab";
}

/** An SVG drawing as an image address (shown as an image, any script in it never runs). */
function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

const FILE_TYPES: Record<MadeKind, { mime: string; description: string }> = {
  html: { mime: "text/html;charset=utf-8", description: "Web page" },
  svg: { mime: "image/svg+xml;charset=utf-8", description: "SVG drawing" },
  md: { mime: "text/markdown;charset=utf-8", description: "Markdown text" },
  txt: { mime: "text/plain;charset=utf-8", description: "Text" },
};

/** Save a participant's file (a web page goes through the pretty-printer first). */
async function saveMadeFile(f: MadeFile): Promise<void> {
  if (f.data === undefined) return;
  const t = FILE_TYPES[f.kind];
  await download(f.kind === "html" ? prettyHtml(f.data) : f.data, f.name, t.mime, t.description);
}

/** The page a participant's file is shown as, inside the walled-off frame of a new tab. */
function viewerDocument(f: MadeFile): string {
  const data = f.data ?? "";
  if (f.kind === "html") return data;
  const page = (title: string, style: string, body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${style}</style></head><body>${body}</body></html>`;
  if (f.kind === "svg") {
    return page(
      f.name,
      "html,body{margin:0;height:100%;background:#fff}body{display:grid;place-items:center}img{max-width:100%;max-height:100%}",
      `<img src="${escapeHtml(svgDataUrl(data))}" alt="${escapeHtml(f.name)}">`,
    );
  }
  const reading =
    "body{max-width:46rem;margin:2rem auto;padding:0 1.5rem;font:17px/1.6 'Iowan Old Style',Palatino,Georgia,serif;color:#1e1d1b;background:#fff}" +
    "pre,code{font-family:ui-monospace,Menlo,monospace;font-size:0.88em}pre{white-space:pre-wrap;overflow-wrap:anywhere}" +
    "table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:.25rem .5rem}";
  if (f.kind === "md") return page(f.name, reading, renderMarkdown(data, false));
  return page(f.name, reading, `<pre>${escapeHtml(data)}</pre>`);
}

/**
 * Open a participant's file in a new tab. It is shown inside a walled-off ("sandboxed") frame
 * that counts as a different site, so nothing in it, such as a script in a web page, can
 * reach Dialog or what Dialog keeps in the browser (your keys among it). Only a web page's
 * scripts are allowed to run.
 */
function openMadeFile(f: MadeFile): void {
  if (f.data === undefined) return;
  const tab = window.open("", "_blank");
  if (!tab) {
    alert("The browser didn't open a new tab. Allow pop-up windows for this page, or use Save… instead.");
    return;
  }
  // Links may open in new tabs; only a web page may also run scripts, use forms and offer downloads.
  const popups = "allow-popups allow-popups-to-escape-sandbox";
  const sandbox = f.kind === "html" ? `allow-scripts allow-forms allow-modals allow-downloads ${popups}` : popups;
  tab.document.open();
  tab.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(f.name)}</title>` +
      `<style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style></head>` +
      `<body><iframe sandbox="${sandbox}" srcdoc="${escapeHtml(viewerDocument(f))}" title="${escapeHtml(f.name)}"></iframe></body></html>`,
  );
  tab.document.close();
  tab.opener = null; // the new tab keeps no handle on Dialog
}

/** Remove a participant's file: it stays listed, but no participant sees it from now on. */
function removeMadeFile(e: Entry, f: MadeFile): void {
  if (arriving(e.id)) return;
  if (!confirm(`Remove ${f.name}? No participant will see it from now on. (Save it first if you want to keep it.)`)) return;
  f.removed = true;
  delete f.data;
  delete f.unsaved;
  persist();
  renderTranscript();
}

function renderTranscript(forceScroll = false): void {
  const kept = els.transcript.scrollTop;
  els.transcript.replaceChildren(
    ...(session.entries.length ? session.entries.map(renderEntry) : [emptyState()]),
  );
  if (forceScroll || following) scrollToBottom();
  else els.transcript.scrollTop = kept; // you scrolled back: stay there
  updateComposerState(); // who ⌘↩ would ask next may have changed
}

/**
 * While replies stream in, redraw only their text, at most once per screen refresh. Several
 * may be arriving at once (an independent round), so every reply with new text since the
 * last refresh is redrawn.
 */
let streamFrame = 0;
const streamChanged = new Set<Entry>();
function scheduleStreamUpdate(entry: Entry): void {
  streamChanged.add(entry);
  if (streamFrame) return;
  streamFrame = requestAnimationFrame(() => {
    streamFrame = 0;
    for (const e of streamChanged) {
      const body = els.transcript.querySelector(`[data-id="${e.id}"] .body`);
      if (body) fillArrivingBody(body as HTMLElement, e);
      // The thinking: its box is added when the first of it arrives.
      if (body && e.thinking) {
        const box = body.parentElement?.querySelector<HTMLDetailsElement>(":scope > details.thinking");
        if (box) fillThinking(box, e);
        else body.before(thinkingBox(e));
      }
    }
    streamChanged.clear();
    if (following) scrollToBottom();
  });
}

function deleteEntry(id: string): void {
  if (arriving(id)) return;
  if (!confirm("Remove this entry? None of the participants will see it from now on.")) return;
  session.entries = session.entries.filter((e) => e.id !== id);
  persist();
  renderTranscript();
  renderTopbar();
  updateSeatStatus();
}

function addHumanEntry(text: string, privateWith?: string | string[], attachments?: Attachment[], addressedTo?: Addressee): void {
  session.entries.push({
    id: newId(),
    speaker: "human",
    speakerName: settings.humanName,
    privateWith,
    addressedTo,
    text,
    attachments,
    time: new Date().toISOString(),
  });
  persist();
  renderTranscript(true);
  renderTopbar();
  if (attachments?.some((a) => a.unsaved)) {
    showAttachMessage(
      "The browser had no room to store an attached file, so it will be lost when this page closes " +
        "(the participants can use it until then). Removing old files or starting a new conversation frees room.",
    );
  }
}

// ---------------------------------------------------------------------------
// Speaking

/** Can these seats speak? Only LM Studio's models need no OpenRouter key; if one is missing, Settings opens. */
function ensureKey(seats: Seat[] = settings.seats): boolean {
  if (hasKey() || seats.every((s) => isLocalModel(s.model))) return true;
  openSettings();
  els.setKey.focus();
  return false;
}

/** A finished reply: its text, and the files it made (taken out of the text). */
function takeFiles(entry: Entry, raw: string): void {
  const split = splitFiles(raw);
  entry.text = split.text.trim();
  if (split.files.length) entry.made = split.files.map(madeFileFrom);
}

/**
 * Ask a seat to speak. With `privateTo` (the seats of a private exchange, this one among
 * them), its reply is private to them (and you). Unless told otherwise, whatever you've typed
 * or attached goes in first: for everyone, or, if it ends with "privately", privately (see
 * sendPrivately; with no one named, to this seat). Only one seat
 * speaks at a time, except in an independent round, where all of them start together
 * (`alongside`). `independent` marks the reply "(answering independently)".
 */
async function speak(
  seatId: string,
  privateTo?: string[],
  { useComposer = true, independent = false, alongside = false }: { useComposer?: boolean; independent?: boolean; alongside?: boolean } = {},
): Promise<Entry | undefined> {
  if (busy.has(seatId) || (busy.size > 0 && !alongside)) return undefined;
  const seat = seatById(seatId);
  if (!seat || !ensureKey([seat])) return undefined;
  if (!seat.model.trim()) {
    alert(`Choose a model for ${seat.name} first.`);
    return undefined;
  }

  // Speak also adds whatever you've typed or attached, for everyone (or privately, if it says so).
  if (useComposer && !privateTo && !els.composerTo.value) {
    const typed = els.composerText.value.trim();
    const a = readAddress(typed, settings.seats);
    if (a.privately) {
      void sendPrivately(a, seat);
      return undefined;
    }
    if (typed || pending.length) {
      addHumanEntry(typed, undefined, takePending());
      els.composerText.value = "";
    }
  }

  // What this seat's model can take in directly (unknown models: assume images, convert PDFs;
  // LM Studio's take no PDFs, and images only if its list says so).
  const info = modelInfo(seat.model);
  const local = isLocalModel(seat.model);
  // The seat's view is built now, before this function first waits. In an independent round
  // every seat's view is built in the same moment, while the others' replies are still empty
  // and arriving, and replies still arriving are never part of anyone's view.
  const messages = buildMessages(seat, settings, session.entries, new Date(), {
    images: info ? info.inputModalities.includes("image") : !local,
    pdfs: !local,
  });
  const pdfEngine = hasFileParts(messages) && !info?.inputModalities.includes("file") ? "cloudflare-ai" : undefined;
  const entry: Entry = {
    id: newId(),
    speaker: seat.id,
    speakerName: seat.name,
    privateWith: privateWithFor(privateTo),
    independent: independent || undefined,
    text: "",
    time: new Date().toISOString(),
    model: seat.model,
    seatModel: seat.model,
    seatEffort: seat.effort,
    status: "streaming",
  };
  session.entries.push(entry);
  const controller = new AbortController();
  busy.set(seat.id, { entryId: entry.id, controller });
  tickWaiting();
  renderTranscript(); // to the new reply only if you haven't scrolled back
  updateSaveButton(); // a reply has begun: no more Resume…
  updateSeatStatus();
  updateComposerState();

  let raw = "";
  // Timing, for tokens per second: from pressing Speak, to the first words, to the last.
  const t0 = performance.now();
  let tFirst: number | undefined;
  try {
    const result = await streamChat({
      apiKey: settings.apiKey.trim(),
      model: seat.model.trim(),
      sessionId: `dialog-${seat.id}`,
      messages,
      effort: seat.effort,
      tools: info?.tools !== false,
      pdfEngine,
      localServer: settings.localServer,
      signal: controller.signal,
      onText: (piece, afterPause) => {
        if (tFirst === undefined) tFirst = performance.now();
        if (afterPause) raw += pauseBreak(raw); // back from the web: a new paragraph
        raw += piece;
        entry.text = stripSelfPrefix(raw, seat.name);
        scheduleStreamUpdate(entry);
      },
      onThinking: (piece) => {
        entry.thinking = (entry.thinking ?? "") + piece;
        scheduleStreamUpdate(entry);
      },
      onMeta: (meta) => {
        entry.requestId = meta.requestId;
        entry.host = meta.host;
      },
    });
    takeFiles(entry, stripSelfPrefix(raw, seat.name));
    entry.model = result.model ?? seat.model;
    entry.usage = result.usage;
    entry.cost = result.cost;
    if (result.citations.length) entry.citations = result.citations;
    if (entry.text || entry.made?.length) {
      entry.status = "done";
    } else {
      entry.status = "error";
      entry.error = "The model returned an empty reply.";
    }
  } catch (err) {
    takeFiles(entry, stripSelfPrefix(raw, seat.name));
    if (controller.signal.aborted) {
      if (entry.text || entry.made?.length) {
        entry.status = "stopped";
      } else {
        entry.status = "error";
        entry.error = "Stopped before any reply arrived.";
      }
    } else {
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : String(err);
      // The likeliest reason, when Dialog can see it: the model has left OpenRouter's list.
      const gone = !local && err instanceof OpenRouterError && (err.status === 404 || err.status === 400) && models.length > 0 && !modelInfo(seat.model);
      if (gone) entry.error = `${seat.model} is no longer in OpenRouter's list of models; choose another with ${seat.name}'s model button. ${entry.error}`;
    }
  } finally {
    entry.timing = {
      totalMs: Math.round(performance.now() - t0),
      firstTextMs: tFirst === undefined ? undefined : Math.round(tFirst - t0),
    };
    busy.delete(seat.id);
    persist();
    renderTranscript();
    renderTopbar();
    updateSeatStatus();
    updateComposerState();
    void refreshKeyInfo();
  }
  return entry;
}

/** Stop everything under way: every reply arriving, and the rest of any round. */
function stopAll(): void {
  if (round) round.cancelled = true;
  for (const b of busy.values()) b.controller.abort();
}

/**
 * A card's Stop: ends that participant's reply. In a round taken in turn it also ends the
 * rest of the round; in an independent round, where all reply at once, the others go on.
 */
function stopSeat(seatId: string): void {
  if (round && !round.parallel) round.cancelled = true;
  busy.get(seatId)?.controller.abort();
}

/**
 * The order for a "team" round: every awake participant with a model, in card order,
 * continuing around the table from the one after the last speaker (from the first card if
 * none has spoken). Sleeping participants sit rounds out.
 */
function roundOrder(): Seat[] {
  const seats = settings.seats.filter((s) => s.model.trim() && !s.asleep);
  const last = previousSpeaker();
  const i = last ? seats.findIndex((s) => s.id === last.id) : -1;
  const start = i < 0 ? 0 : (i + 1) % Math.max(seats.length, 1);
  return [...seats.slice(start), ...seats.slice(0, start)];
}

/**
 * A round: each participant in `order` speaks once ("…, team" uses roundOrder(); a list of
 * names, the order named).
 * - In turn: one after another, each seeing the replies before it. A card's Stop ends the
 *   reply under way and the rest of the round; a failed reply is skipped.
 * - Independently: all at once. Every reply starts in the same moment, so none can see
 *   another's reply from this round (each sees them all afterwards). The replies appear in
 *   the round's order and fill in together; the round ends when the last one does. A
 *   card's Stop ends only that participant's reply.
 * With `privateTo` (a private exchange with several), every reply is private to them.
 */
async function runRound(call: TeamCall, order?: Seat[], privateTo?: string[]): Promise<void> {
  const named = Boolean(order); // participants you named are asked even if asleep
  order ??= roundOrder();
  if (occupied() || !ensureKey(order)) return;
  if (!order.length) return;
  const parallel = call === "independently";
  const r = { cancelled: false, parallel };
  round = r;
  try {
    let first = true;
    const started: Promise<Entry | undefined>[] = [];
    for (const seat of order) {
      if (r.cancelled) break;
      const now = seatById(seat.id);
      if (!now) continue; // removed meanwhile
      if (now.asleep && !named) continue; // put to sleep meanwhile
      const options = { useComposer: first, independent: parallel, alongside: parallel }; // your message goes in once, before the first reply
      first = false;
      if (parallel) started.push(speak(seat.id, privateTo, options)); // started now; waited for below
      else await speak(seat.id, privateTo, options);
    }
    await Promise.allSettled(started);
  } finally {
    round = null;
    updateSeatStatus();
    updateComposerState();
  }
}

/** Replace a failed reply with a fresh attempt by the same seat (privately if it was private). */
async function retry(failed: Entry): Promise<void> {
  if (occupied()) return;
  session.entries = session.entries.filter((x) => x.id !== failed.id);
  await speak(failed.speaker, privateGroup(failed), { useComposer: false });
}

// ---------------------------------------------------------------------------
// The composer (your input box)

function renderComposerTo(): void {
  const current = els.composerTo.value;
  els.composerTo.replaceChildren(
    h("option", { value: "" }, "Everyone"),
    ...settings.seats.map((s) => h("option", { value: s.id }, `Privately: ${s.name || "unnamed"}`)),
  );
  els.composerTo.value = settings.seats.some((s) => s.id === current) ? current : "";
  updateComposerState();
}

// The input box's keys, named as the Mac or other systems name them:
// Return adds your message and asks a participant to reply; ⌘↩ just adds it;
// Shift-Return or Option-Return starts a new line.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const ASK_KEY = IS_MAC ? "↩" : "Enter";
const ADD_KEY = IS_MAC ? "⌘↩" : "Ctrl+Enter";
const NEWLINE_KEY = IS_MAC ? "⇧↩ or ⌥↩" : "Shift+Enter or Alt+Enter";

/**
 * Who answers Return with To: Everyone, when your message doesn't end with a participant's
 * name: the one who spoke last in the open conversation (private replies don't count), if
 * its seat is still here and awake.
 */
function previousSpeaker(): Seat | undefined {
  for (let i = session.entries.length - 1; i >= 0; i--) {
    const e = session.entries[i]!;
    if (e.speaker === "human" || e.privateWith) continue;
    const seat = seatById(e.speaker);
    if (seat && !seat.asleep) return seat;
  }
  return undefined;
}

/** "Claude", "Claude and Grok", "Claude, Grok and Gemini", with each name in its color. */
function coloredNames(seats: Seat[]): (string | Node)[] {
  const out: (string | Node)[] = [];
  seats.forEach((s, i) => {
    if (i > 0) out.push(i === seats.length - 1 ? " and " : ", ");
    out.push(h("b", { style: `--seat-color: ${s.color}` }, s.name));
  });
  return out;
}

function updateComposerState(): void {
  const to = els.composerTo.value;
  const seat = to ? seatById(to) : undefined;
  els.composerSend.textContent = seat ? `Send privately to ${seat.name}` : "Add to conversation";
  els.composerSend.disabled = Boolean(seat && busy.size);
  els.composer.classList.toggle("private-mode", Boolean(seat));

  // The note beside the button: what Return will do, naming who will reply. It follows your
  // typing: a message ending with a participant's name is for that participant.
  const name = (s: Seat) => h("b", { style: `--seat-color: ${s.color}` }, s.name);
  const justAdds = () => h("span", { class: "nowrap" }, ` · ${ADD_KEY} just adds`);
  const newlineNote = ` ${NEWLINE_KEY} starts a new line.`;

  // A message ending with "privately": the box turns parchment, as with To:, and the note
  // says to whom it will go. It is never added for everyone.
  const typed = !seat ? readAddress(els.composerText.value, settings.seats) : undefined;
  if (typed?.privately) {
    els.composer.classList.add("private-mode");
    els.composerSend.textContent = "Add privately";
    const targets = privateTargets(typed);
    if (occupied()) {
      els.composerHint.replaceChildren("Wait until the replies have finished to send this privately");
      els.composerHint.title = "While participants are replying, a message ending with “privately” stays in the box; Return and Add do nothing." + newlineNote;
      els.composerSend.disabled = true;
    } else if (!targets.length) {
      els.composerHint.replaceChildren("Say whom it’s for: “…, Grok, privately”");
      els.composerHint.title = "No one has spoken yet, so a message ending with “privately” needs a participant’s name before it; until then, Return and Add do nothing." + newlineNote;
      els.composerSend.disabled = true;
    } else {
      const apart = typed.call === "independently" && targets.length > 1;
      els.composerHint.replaceChildren(
        `${ASK_KEY} sends privately; `,
        ...coloredNames(targets),
        targets.length === 1 ? " replies" : apart ? " reply independently, at once" : " reply in turn",
        h("span", { class: "nowrap" }, ` · ${ADD_KEY} just adds it privately`),
      );
      els.composerHint.title =
        `Return sends your message privately to ${targets.map((s) => s.name).join(", ")}` +
        (targets.length === 1
          ? ", who replies privately, as if you had chosen them under To."
          : ": only they see it and one another’s replies to it, and each replies once" + (apart ? ", all at the same time." : ", in that order.")) +
        ` ${ADD_KEY} (or Add privately) just adds it, privately, without asking anyone.` +
        newlineNote;
    }
    return;
  }
  const free = !seat && !occupied();
  const a = free ? readAddress(els.composerText.value, settings.seats) : undefined;
  const listed = a && a.seats.length > 1 ? a.seats : [];
  const named = a?.seats.length === 1 ? a.seats[0] : undefined;
  const call = a?.everyone ? a.call : undefined;
  const order = call ? roundOrder() : [];
  const next = free && !call && !listed.length ? (named ?? previousSpeaker()) : undefined;
  const newline = ` ${NEWLINE_KEY} starts a new line.`;
  if (listed.length) {
    const apart = a!.call === "independently";
    els.composerHint.replaceChildren(`${ASK_KEY} adds, then `, ...coloredNames(listed), apart ? " reply independently, at once" : " reply in turn", justAdds());
    els.composerHint.title =
      `Return adds your message, then ${listed.map((s) => s.name).join(", ")} reply once each` +
      (apart
        ? ", all at the same time, each without seeing the others’ replies. Their replies appear in that order and fill in together; Stop on a card stops only that participant"
        : ", in that order") +
      `. ${ADD_KEY} (or Add to conversation) just adds your message.` +
      newline;
  } else if (seat) {
    els.composerHint.replaceChildren(`${ASK_KEY} sends; `, name(seat), " replies");
    els.composerHint.title = `Return sends your message privately to ${seat.name}, who replies at once.` + newline;
  } else if (call && order.length) {
    const asleep = settings.seats.filter((s) => s.asleep && s.model.trim()).length;
    const who = asleep ? `the ${order.length} awake` : `all ${order.length}`;
    const names = order.map((s) => s.name).join(", ");
    if (call === "independently") {
      // All at once: nobody goes first.
      els.composerHint.replaceChildren(`${ASK_KEY} adds, then ${who} reply independently, at once`, justAdds());
      els.composerHint.title =
        `Return adds your message, then every participant replies once, all at the same time, each without seeing the others’ replies: ${names}. ` +
        "Their replies appear in that order (around the table, starting after the last to speak) and fill in together; afterwards everyone sees them all." +
        (asleep ? ` Sleeping participants sit it out.` : "") +
        ` Stop on a card stops only that participant. ${ADD_KEY} (or Add to conversation) just adds your message.` +
        newline;
    } else {
      els.composerHint.replaceChildren(`${ASK_KEY} adds, then ${who} reply in turn, `, name(order[0]!), " first", justAdds());
      els.composerHint.title =
        `Return adds your message, then each participant replies once, in this order: ${names} ` +
        "(around the table, starting after the last to speak)." +
        (asleep ? ` Sleeping participants sit it out.` : "") +
        ` Stop ends the round. ${ADD_KEY} (or Add to conversation) just adds your message.` +
        newline;
    }
  } else if (call && settings.seats.some((s) => s.asleep && s.model.trim())) {
    els.composerHint.replaceChildren(`${ASK_KEY} adds (everyone’s asleep)`);
    els.composerHint.title = "Return adds your message without “team”, but no one replies: every participant is asleep. Uncheck Sleep on a card to wake it." + newline;
  } else if (next) {
    els.composerHint.replaceChildren(`${ASK_KEY} adds, then `, name(next), " replies", justAdds());
    els.composerHint.title =
      `Return adds your message to the conversation, then ${next.name}` +
      (named ? ", named at the end of your message," : ", the last to speak,") +
      ` replies. End with several names to ask just those, or with “team” to have everyone reply in turn. ${ADD_KEY} (or Add to conversation) just adds it, without asking anyone.` +
      newline;
  } else {
    els.composerHint.replaceChildren(`${ASK_KEY} adds`);
    els.composerHint.title =
      (occupied()
        ? "Return adds your message to the conversation. (While participants are replying, no one else is asked.)"
        : "Return adds your message to the conversation. End it with a participant's name to have that one reply, with several names for just those, or with “team” for everyone in turn.") +
      newline;
  }
}

/**
 * Whom a message ending with "privately" is private to: the participants it names; with
 * "team", everyone awake; naming no one, `fallback` (the seat whose Speak you pressed) or else
 * the one who spoke last. Empty if there is no one.
 */
function privateTargets(a: Addressing, fallback?: Seat): Seat[] {
  if (a.everyone) return roundOrder();
  if (a.seats.length) return a.seats;
  const next = fallback ?? previousSpeaker();
  return next ? [next] : [];
}

/** The stage direction stored with a private message: to one participant, or to several and how. */
function privateAddressee(seats: Seat[], a: Addressing): Addressee {
  if (seats.length === 1) return { seatId: seats[0]!.id, name: seats[0]!.name };
  if (a.everyone && a.call) return { everyone: a.call };
  return { seats: seats.map((s) => ({ id: s.id, name: s.name })), how: a.call ?? "in turn" };
}

/**
 * A message ending with "privately", sent with Return (or Speak): as if To: had named whom
 * it's for (see privateTargets). The word comes off. One participant replies privately, as
 * with To:. Several make a private exchange of their own: the message and every reply in it
 * are seen only by them (and you), and they reply in turn, or all at once with
 * "independently". If there is no one to send it to, nothing is sent: it stays in the box.
 */
async function sendPrivately(a: Addressing, fallback?: Seat): Promise<void> {
  if (!a.text && !pending.length) return;
  const seats = privateTargets(a, fallback);
  if (!seats.length || !ensureKey(seats)) return;
  const unready = seats.find((s) => !s.model.trim());
  if (unready) {
    alert(`Choose a model for ${unready.name} first.`);
    return;
  }
  const group = seats.map((s) => s.id);
  addHumanEntry(a.text, privateWithFor(group), takePending(), privateAddressee(seats, a));
  els.composerText.value = "";
  updateComposerState();
  if (seats.length === 1) await speak(seats[0]!.id, group, { useComposer: false });
  else await runRound(a.call ?? "in turn", seats, group);
}

/**
 * Return in the input box: add what you've typed, then the participant your message ends by
 * naming replies; "…, team" has everyone reply in turn; otherwise the previous speaker
 * replies. (Privately: send, and that one replies.)
 */
async function sendAndAsk(): Promise<void> {
  const typed = els.composerText.value;
  if (!typed.trim() && !pending.length) return;
  if (els.composerTo.value) return submitComposer(); // To: has already chosen someone, privately
  if (readAddress(typed, settings.seats).privately) {
    // Ending with "privately": never added for everyone by mistake. While others are still
    // replying, it waits in the box (the note beside the button says so).
    if (!occupied()) await sendPrivately(readAddress(typed, settings.seats));
    return;
  }
  if (occupied()) return submitComposer(); // while others are replying: just add it

  // Words at the end meant for Dialog ("…, Grok", "…, team") are acted on and left out of
  // the message; the participants are told whom it's for instead.
  const a = readAddress(typed, settings.seats);
  const everyone = a.everyone && a.call && roundOrder().length ? a.call : undefined;
  if (a.everyone && !everyone) {
    // "…, team" with everyone asleep: add the message (without "team"); no one replies.
    const files = takePending();
    if (a.text || files) addHumanEntry(a.text, undefined, files);
    els.composerText.value = "";
    updateComposerState();
    return;
  }
  if (!a.seats.length && !everyone) {
    const next = previousSpeaker();
    if (next) await speak(next.id); // Speak adds what you've typed first
    else submitComposer();
    return;
  }
  if (!ensureKey(everyone ? roundOrder() : a.seats)) return;
  const unready = a.seats.find((s) => !s.model.trim());
  if (unready) {
    alert(`Choose a model for ${unready.name} first.`);
    return;
  }
  const to: Addressee = everyone
    ? { everyone }
    : a.seats.length === 1
      ? { seatId: a.seats[0]!.id, name: a.seats[0]!.name }
      : { seats: a.seats.map((s) => ({ id: s.id, name: s.name })), how: a.call ?? "in turn" };
  const files = takePending();
  if (a.text || files) addHumanEntry(a.text, undefined, files, to);
  els.composerText.value = "";
  updateComposerState();
  if (everyone) await runRound(everyone); // "…, team"
  else if (a.seats.length > 1) await runRound(a.call ?? "in turn", a.seats); // "…, Claude and Grok"
  else await speak(a.seats[0]!.id); // "…, Grok"
}

/** Put a line break at the caret, as typing one would (undoable where the browser allows). */
function insertNewline(box: HTMLTextAreaElement): void {
  let done = false;
  try {
    done = document.execCommand("insertText", false, "\n");
  } catch {
    done = false;
  }
  if (!done) {
    box.setRangeText("\n", box.selectionStart, box.selectionEnd, "end");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/** The same as pressing Add to conversation (or Send privately). */
function submitComposer(): void {
  if (typeof els.composer.requestSubmit === "function") els.composer.requestSubmit();
  else els.composerSend.click();
}

async function onComposerSubmit(ev: Event): Promise<void> {
  ev.preventDefault();
  const text = els.composerText.value.trim();
  if (!text && !pending.length) return;
  const to = els.composerTo.value;
  if (!to) {
    const a = readAddress(text, settings.seats);
    if (a.privately) {
      // ⌘↩ or Add: just add it, privately to whom it's for; no one is asked to reply.
      // With no one to keep it private to, it isn't added at all.
      const seats = privateTargets(a);
      if (!seats.length || occupied() || (!a.text && !pending.length)) return;
      addHumanEntry(a.text, privateWithFor(seats.map((s) => s.id)), takePending(), privateAddressee(seats, a));
      els.composerText.value = "";
      updateComposerState();
      return;
    }
    addHumanEntry(text, undefined, takePending());
    els.composerText.value = "";
    updateComposerState();
    return;
  }
  if (busy.size || !ensureKey(settings.seats.filter((s) => s.id === to))) return;
  addHumanEntry(text, to, takePending());
  els.composerText.value = "";
  await speak(to, [to]);
}

// ---------------------------------------------------------------------------
// Attaching files (drag and drop, or the Attach button)

/** Files waiting to go out with your next entry. */
let pending: Attachment[] = [];

function takePending(): Attachment[] | undefined {
  const files = pending;
  pending = [];
  renderPending();
  return files.length ? files : undefined;
}

function renderPending(): void {
  els.attachTray.hidden = pending.length === 0;
  els.attachTray.replaceChildren(
    ...pending.map((a) =>
      h(
        "span",
        { class: "chip" },
        a.kind === "image" && a.data ? h("img", { src: a.data, alt: "" }) : null,
        h("span", {}, describeAttachment(a)),
        h(
          "button",
          {
            type: "button",
            class: "chip-x",
            "aria-label": `Remove ${a.name}`,
            title: "Don't attach this file",
            onclick: () => {
              pending = pending.filter((p) => p !== a);
              renderPending();
            },
          },
          "×",
        ),
      ),
    ),
  );
}

function showAttachMessage(message: string): void {
  els.attachStatus.textContent = message;
  els.attachStatus.hidden = !message;
}

async function addFiles(files: File[]): Promise<void> {
  const problems: string[] = [];
  for (const file of files) {
    try {
      pending.push(await readAttachment(file, (m) => confirm(m)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg) problems.push(msg);
    }
  }
  showAttachMessage(problems.join(" "));
  renderPending();
  els.composerText.focus();
}

/** Drag files over the conversation: show where to drop; drop: attach them. */
function wireDrop(): void {
  let depth = 0; // dragenter/dragleave fire for every child element crossed
  const hasFiles = (ev: DragEvent) => Array.from(ev.dataTransfer?.types ?? []).includes("Files");
  const zone = els.conversation;
  zone.addEventListener("dragenter", (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    depth++;
    zone.classList.add("dropping");
  });
  zone.addEventListener("dragover", (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  });
  zone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) zone.classList.remove("dropping");
  });
  zone.addEventListener("drop", (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    depth = 0;
    zone.classList.remove("dropping");
    void addFiles(Array.from(ev.dataTransfer?.files ?? []));
  });
  // A file dropped anywhere else shouldn't make the browser leave the page to show it.
  window.addEventListener("dragover", (ev) => ev.preventDefault());
  window.addEventListener("drop", (ev) => ev.preventDefault());
}

// ---------------------------------------------------------------------------
// Participants (seats)


interface SeatControls {
  card: HTMLElement;
  stop: HTMLButtonElement;
  sleep: HTMLInputElement;
  // A sleeping seat's folded card has none of these:
  grip?: HTMLElement;
  speak?: HTMLButtonElement;
  copy?: HTMLButtonElement;
  remove?: HTMLButtonElement;
  cost?: HTMLElement;
  /** Redraw the parts of the card that depend on the seat's model. */
  refreshModel?: () => void;
}
const seatControls = new Map<string, SeatControls>();

/** The Sleep box: a sleeping seat sits out "team" rounds, and its card folds up at the end of the list. */
function sleepBox(seat: Seat): HTMLInputElement {
  return h("input", {
    type: "checkbox",
    checked: Boolean(seat.asleep),
    onchange: (ev) => setAsleep(seat.id, (ev.target as HTMLInputElement).checked),
  });
}

/** A sleeping seat's card: just its name and the Sleep box (and Stop, should you ask it by name). */
function sleepingCard(seat: Seat): HTMLElement {
  const sleep = sleepBox(seat);
  const stopBtn = h("button", { class: "danger", type: "button", hidden: true, onclick: () => stopSeat(seat.id) }, "Stop");
  const card = h(
    "div",
    { class: "seat asleep", "data-seat": seat.id, style: `--seat-color: ${seat.color}` },
    h(
      "div",
      { class: "seat-head" },
      h("span", { class: "seat-name", title: seat.model }, seat.name),
      ...(seat.model.trim() ? [makerLogo(makerOf(seat.model, modelInfo(seat.model)?.name))] : []),
      h("span", { class: "head-gap" }),
      stopBtn,
      h("label", { class: "sleep", title: "Uncheck to wake this participant and unfold its card." }, sleep, "Sleep"),
    ),
  );
  seatControls.set(seat.id, { card, stop: stopBtn, sleep });
  return card;
}

/**
 * The logo of a model's maker, as OpenRouter shows it (see makers.ts), on a small white
 * plate so dark logos show in dark mode. The maker's initial instead if Dialog knows no logo
 * for it, or the logo doesn't load.
 */
function makerLogo(maker: Maker): HTMLElement {
  const initial = () => h("span", { class: "maker-logo initial", "aria-hidden": "true" }, maker.initial);
  if (!maker.logo) return initial();
  const img = h("img", { class: "maker-logo", src: maker.logo, alt: "", width: 20, height: 20, referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => img.replaceWith(initial()), { once: true });
  return img;
}

function seatCard(seat: Seat): HTMLElement {
  if (seat.asleep) return sleepingCard(seat);
  const modelBtn = h("button", { type: "button", class: "model-button", title: "Choose a model", onclick: () => openModelPicker(seat.id) });
  const info = h("div", { class: "seat-model-info" });
  const logoSlot = h("span", { class: "maker-slot" });
  const effortSelect = h("select", {
    "aria-label": "Thinking level",
    onchange: (ev) => {
      seat.effort = (ev.target as HTMLSelectElement).value;
      persist();
    },
  });

  const refreshModel = () => {
    const m = modelInfo(seat.model);
    // The maker's logo on the card's top line, to the right of the seat's name.
    logoSlot.replaceChildren(...(seat.model.trim() ? [makerLogo(makerOf(seat.model, m?.name))] : []));
    modelBtn.replaceChildren(
      h("span", { class: "model-name" }, m?.name ?? (seat.model || "Choose a model…")),
      h("span", { class: "chev", "aria-hidden": "true" }, "▾"),
    );
    info.classList.remove("warn");
    if (m?.local) {
      info.replaceChildren(
        h("span", { class: "id" }, m.id),
        h("span", {}, m.local.loaded ? "In LM Studio on this computer, loaded" : "In LM Studio on this computer; it loads the model when asked"),
        h("span", { class: "no-tools" }, "No web search or page reading"),
      );
    } else if (isLocalModel(seat.model)) {
      // An LM Studio model not in its list: LM Studio would answer with whichever model it has loaded.
      info.textContent = localFetched && !localError ? `${seat.model} is not among LM Studio’s models` : seat.model;
      info.classList.toggle("warn", localFetched && !localError);
    } else if (m) {
      const varies = m.inputPrice < 0 || m.outputPrice < 0;
      info.replaceChildren(
        // An id that follows a family's newest model ("~…-latest"): the model it stands for now.
        m.aliasOf
          ? h("span", { class: "id alias", title: `${m.id} stands for this model now; OpenRouter moves it to each newer one` }, m.aliasOf.id)
          : h("span", { class: "id" }, m.id),
        h("span", {}, varies ? "Price varies: it passes each request to a model it chooses" : `${priceText(m.inputPrice)} in, ${priceText(m.outputPrice)} out per million tokens`),
      );
      if (m.tools === false) info.append(h("span", { class: "no-tools" }, "Can't use tools, so no web search or page reading"));
    } else if (models.length && seat.model) {
      info.textContent = `${seat.model} is not in OpenRouter’s current list`;
      info.classList.add("warn");
    } else {
      info.textContent = seat.model;
    }

    // The Thinking menu offers exactly this model's levels, its default marked.
    const choices = thinkingChoices(m);
    if (m && !choices.some((c) => c.value === seat.effort)) {
      seat.effort = "default"; // e.g. after switching to a model without that level
      persistSoon();
    }
    if (!m && seat.effort !== "default") choices.push({ value: seat.effort, label: seat.effort });
    effortSelect.replaceChildren(...choices.map((c) => h("option", { value: c.value }, c.label)));
    effortSelect.value = seat.effort;
    effortSelect.disabled = choices.length < 2;
  };
  refreshModel();

  const roleSummary = h("summary", {}, seat.role.trim() ? "Role (set)" : "Role (none)");

  const speakBtn = h("button", { class: "speak primary", type: "button", onclick: () => void speak(seat.id) }, "Speak");
  const stopBtn = h("button", { class: "danger", type: "button", hidden: true, onclick: () => stopSeat(seat.id) }, "Stop");
  const copyBtn = h(
    "button",
    {
      type: "button",
      title: "Add a second seat with the same model",
      onclick: () => {
        settings.seats.splice(seatIndex(seat.id) + 1, 0, copySeat(seat, settings.seats));
        persist();
        renderSeats();
        renderComposerTo();
      },
    },
    "+ copy",
  );
  const removeBtn = h(
    "button",
    { type: "button", class: "danger", title: "Remove this seat", "aria-label": "Remove seat", onclick: () => removeSeat(seat.id) },
    "×",
  );
  const cost = h("span", { class: "seat-cost", title: "This seat's cost in this conversation" });
  const sleep = sleepBox(seat);

  // The handle for reordering: drag it, or focus it and press ↑ or ↓.
  // (A span, not a button: some browsers won't start a drag from a button.)
  const grip = h(
    "span",
    {
      class: "grip",
      role: "button",
      tabindex: 0,
      draggable: "true",
      title: "Drag to move this participant up or down (or click here and press ↑ or ↓)",
      "aria-label": `Move ${seat.name || "this participant"} up or down`,
      onkeydown: (ev) => {
        const key = (ev as KeyboardEvent).key;
        if (key !== "ArrowUp" && key !== "ArrowDown") return;
        ev.preventDefault();
        moveAmongAwake(seat.id, key === "ArrowUp" ? -1 : 1);
      },
    },
    "⠿",
  );

  const card = h(
    "div",
    { class: "seat", "data-seat": seat.id, style: `--seat-color: ${seat.color}` },
    h(
      "div",
      { class: "seat-head" },
      grip,
      // The name box is as wide as the name (its hidden copy, in data-text, sets the width),
      // so the maker's logo comes straight after the name.
      h(
        "span",
        { class: "name-fit", "data-text": seat.name },
        h("input", {
          type: "text",
          value: seat.name,
          size: "1", // no built-in width; the name sets it
          "aria-label": "Seat name",
          spellcheck: "false",
          oninput: (ev) => {
            const input = ev.target as HTMLInputElement;
            seat.name = input.value;
            input.parentElement!.dataset.text = input.value;
            renderComposerTo();
            persistSoon();
          },
          onchange: (ev) => {
            const input = ev.target as HTMLInputElement;
            if (!input.value.trim()) {
              seat.name = "Unnamed";
              input.value = seat.name;
              input.parentElement!.dataset.text = input.value;
              renderComposerTo();
            }
            persist();
          },
        }),
      ),
      logoSlot,
      h("span", { class: "head-gap" }),
      copyBtn,
      removeBtn,
    ),
    modelBtn,
    info,
    h(
      "div",
      { class: "seat-opts" },
      h("label", {}, "Thinking", effortSelect),
      h(
        "label",
        { class: "sleep", title: "Sleep: this participant sits out “team” rounds and isn’t asked by Return unless you name it. Its card folds up at the end of the list." },
        sleep,
        "Sleep",
      ),
    ),
    h(
      "details",
      {},
      roleSummary,
      h(
        "textarea",
        {
          rows: 4,
          placeholder: "Standing instructions for this participant, e.g. “Argue the skeptic’s side.”",
          oninput: (ev) => {
            seat.role = (ev.target as HTMLTextAreaElement).value;
            roleSummary.textContent = seat.role.trim() ? "Role (set)" : "Role (none)";
            persistSoon();
          },
        },
        seat.role,
      ),
    ),
    h("div", { class: "seat-actions" }, speakBtn, stopBtn, cost),
  );

  seatControls.set(seat.id, { card, grip, sleep, speak: speakBtn, stop: stopBtn, copy: copyBtn, remove: removeBtn, cost, refreshModel });
  return card;
}

const seatIndex = (id: string) => settings.seats.findIndex((s) => s.id === id);

/** The cards' order on screen: awake participants in their order, then the sleeping ones. */
function displayOrder(): Seat[] {
  return [...settings.seats.filter((s) => !s.asleep), ...settings.seats.filter((s) => s.asleep)];
}

/** Put the cards in display order (moving them, so nothing typed or opened is lost). */
function arrangeSeatCards(): void {
  els.seatList.append(...displayOrder().flatMap((s) => seatControls.get(s.id)?.card ?? []));
}

/**
 * Put a participant to sleep or wake it. A sleeping participant keeps its place in the
 * order, so waking it puts its card back where it was.
 */
function setAsleep(id: string, asleep: boolean): void {
  const seat = seatById(id);
  if (!seat) return;
  if (asleep) seat.asleep = true;
  else delete seat.asleep;
  persist();
  const old = seatControls.get(id)?.card;
  const fresh = seatCard(seat);
  if (old) old.replaceWith(fresh);
  else els.seatList.append(fresh);
  arrangeSeatCards();
  seatControls.get(id)?.sleep.focus(); // the box was redrawn; keep the keyboard on it
  updateSeatStatus();
  updateComposerState(); // who Return or "team" would ask may have changed
}

/** ↑ or ↓ on a card's handle: swap places with the next awake participant above or below. */
function moveAmongAwake(id: string, step: -1 | 1): void {
  const awake = settings.seats.filter((s) => !s.asleep);
  const neighbor = awake[awake.findIndex((s) => s.id === id) + step];
  if (neighbor) moveSeat(id, seatIndex(neighbor.id), true);
}

/**
 * Move a participant to another place in the list. The order is the order of the To menu,
 * of the list every participant is given, and of Participants in saved files. The cards
 * are moved, not redrawn, so an open Role box or a half-typed name survives.
 */
function moveSeat(id: string, to: number, keepFocus = false): void {
  const from = seatIndex(id);
  if (from < 0) return;
  const target = Math.max(0, Math.min(to, settings.seats.length - 1));
  if (target === from) return;
  const [seat] = settings.seats.splice(from, 1);
  settings.seats.splice(target, 0, seat!);
  persist();
  arrangeSeatCards();
  renderComposerTo();
  if (keepFocus) seatControls.get(id)?.grip?.focus();
}

/** Dragging a card by its handle: a line shows where it will land. */
let draggingSeat: string | null = null;

function clearDropMarks(): void {
  for (const c of seatControls.values()) c.card.classList.remove("drop-before", "drop-after");
}

/** The card under the pointer, and whether the pointer is in its upper half. */
function dropSpot(ev: DragEvent): { id: string; before: boolean } | null {
  const card = (ev.target as Element | null)?.closest?.<HTMLElement>(".seat");
  const id = card?.dataset.seat;
  if (!card || !id || card.classList.contains("asleep")) return null; // sleeping cards stay at the end
  const r = card.getBoundingClientRect();
  return { id, before: ev.clientY < r.top + r.height / 2 };
}

function wireSeatDragging(): void {
  const list = els.seatList;
  list.addEventListener("dragstart", (ev) => {
    const grip = (ev.target as Element | null)?.closest?.(".grip");
    const card = grip?.closest<HTMLElement>(".seat");
    if (!grip || !card?.dataset.seat) return;
    draggingSeat = card.dataset.seat;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", seatById(draggingSeat)?.name ?? "");
      const r = card.getBoundingClientRect();
      ev.dataTransfer.setDragImage?.(card, ev.clientX - r.left, ev.clientY - r.top); // drag the whole card
    }
    card.classList.add("dragging");
  });
  list.addEventListener("dragover", (ev) => {
    if (!draggingSeat) return; // not one of ours (e.g. a file)
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const spot = dropSpot(ev);
    clearDropMarks();
    if (spot && spot.id !== draggingSeat) seatControls.get(spot.id)?.card.classList.add(spot.before ? "drop-before" : "drop-after");
  });
  list.addEventListener("drop", (ev) => {
    if (!draggingSeat) return;
    ev.preventDefault();
    const spot = dropSpot(ev);
    const id = draggingSeat;
    if (spot && spot.id !== id) {
      let to = seatIndex(spot.id) + (spot.before ? 0 : 1);
      if (seatIndex(id) < to) to -= 1; // the card leaves its old place first
      moveSeat(id, to);
    }
  });
  list.addEventListener("dragend", () => {
    for (const c of seatControls.values()) c.card.classList.remove("dragging");
    clearDropMarks();
    draggingSeat = null;
  });
}

function renderSeats(): void {
  seatControls.clear();
  els.seatList.replaceChildren(
    ...(settings.seats.length
      ? displayOrder().map((s) => seatCard(s))
      : [h("p", { class: "seats-empty" }, "No participants yet. Press + Add a seat below and choose a model.")]),
  );
  els.btnAddSeat.classList.toggle("primary", settings.seats.length === 0); // the obvious next step
  els.btnAddSeat.classList.toggle("subtle", settings.seats.length > 0);
  updateSeatStatus();
}

function updateSeatStatus(): void {
  for (const seat of settings.seats) {
    const c = seatControls.get(seat.id);
    if (!c) continue;
    const speakingNow = busy.has(seat.id);
    if (c.speak) {
      c.speak.hidden = speakingNow;
      c.speak.disabled = occupied();
    }
    c.stop.hidden = !speakingNow;
    if (c.remove) c.remove.disabled = speakingNow;
    c.sleep.disabled = speakingNow; // its card mustn't fold or unfold mid-reply
    c.card.classList.toggle("speaking", speakingNow);
    if (c.cost) {
      const spent = seatCost(seat.id);
      c.cost.textContent = spent > 0 ? formatCost(spent) : "";
    }
  }
  els.btnAddSeat.disabled = false;
}

function removeSeat(id: string): void {
  const seat = seatById(id);
  if (!seat || busy.has(id)) return;
  if (!confirm(`Remove ${seat.name}? Its earlier contributions stay in the conversation.`)) return;
  settings.seats = settings.seats.filter((s) => s.id !== id);
  persist();
  renderSeats();
  renderComposerTo();
  renderTranscript();
}

/** Add a seat and go straight to choosing its model; the seat is then named after the model. */
function addSeat(): void {
  const seat: Seat = {
    id: newId(),
    name: NEW_SEAT_NAME,
    model: "",
    role: "",
    effort: "default",
    color: seatColorFor(NEW_SEAT_NAME, settings.seats),
  };
  settings.seats.push(seat);
  persist();
  renderSeats();
  renderComposerTo();
  if (!session.entries.length) renderTranscript(); // the welcome steps depend on whether there are seats
  openModelPicker(seat.id);
}

// ---------------------------------------------------------------------------
// Model list and the model picker

/** Every model Dialog knows of: LM Studio's first, then OpenRouter's. */
const allModels = (): ModelInfo[] => [...localModels, ...models];
const modelInfo = (id: string): ModelInfo | undefined => allModels().find((m) => m.id === id.trim());

function refreshModelDisplays(): void {
  for (const c of seatControls.values()) c.refreshModel?.();
}

/**
 * Get OpenRouter's model list again, and keep it. Asked again while a fetch is under way, it
 * waits for that one. If the fetch fails, the list Dialog had stays (the list is a
 * convenience: a model id can always be typed into the picker in full).
 */
function refreshModels(): Promise<void> {
  if (!modelsLoading) {
    modelsError = "";
    modelsLoading = fetchAndKeepModels().finally(() => {
      modelsLoading = null;
      if (pickerSeatId) renderPicker(true); // the new list (or the trouble) in the open picker
    });
    if (pickerSeatId) renderPicker(true); // "Refreshing…"
  }
  return modelsLoading;
}

async function fetchAndKeepModels(): Promise<void> {
  try {
    models = await fetchModels();
    modelsAt = Date.now();
    store.saveCachedModels(models, modelsAt);
    refreshModelDisplays();
  } catch (err) {
    modelsError = err instanceof Error ? err.message : String(err);
  }
}

/**
 * Get LM Studio's list of models again (if its address is set). Asked again while a fetch is
 * under way, it waits for that one. If it fails, the list is emptied and the trouble shown.
 */
function refreshLocalModels(): Promise<void> {
  if (!localLoading) {
    const address = settings.localServer;
    localLoading = (async () => {
      try {
        localModels = address.trim() ? await fetchLocalModels(address) : [];
        localError = "";
      } catch (err) {
        localModels = [];
        localError = err instanceof Error ? err.message : String(err);
      }
      localFetched = address.trim() !== "";
    })().finally(() => {
      localLoading = null;
      refreshModelDisplays();
      if (pickerSeatId) renderPicker(true);
    });
    if (pickerSeatId) renderPicker(true);
  }
  return localLoading;
}

/** After the LM Studio address changes: forget the old list, and get one from the new address if any seat uses LM Studio. */
function localServerChanged(): void {
  localModels = [];
  localFetched = false;
  localError = "";
  if (hasLocal() && settings.seats.some((s) => isLocalModel(s.model))) void refreshLocalModels();
  else refreshModelDisplays();
}

/**
 * When the page opens: show the saved list at once, and get a new one if it's too old (or
 * there is none). LM Studio's list too, if a seat uses one of its models.
 */
function loadModels(): void {
  refreshModelDisplays();
  if (store.modelsAreStale(modelsAt)) void refreshModels();
  if (hasLocal() && settings.seats.some((s) => isLocalModel(s.model))) void refreshLocalModels();
}

let pickerSeatId: string | null = null;
let pickerRows: { id: string; el: HTMLElement }[] = [];
let pickerActive = 0;
/** How many of OpenRouter's models match the picker's search words. */
let pickerFound = 0;
/** How many of LM Studio's. */
let pickerLocalFound = 0;

function openModelPicker(seatId: string): void {
  const seat = seatById(seatId);
  if (!seat) return;
  pickerSeatId = seatId;
  els.modelTitle.textContent = `Choose a model for ${seat.name}`;
  els.modelSearch.value = "";
  renderPicker();
  if (typeof els.modelDialog.showModal === "function") els.modelDialog.showModal();
  else els.modelDialog.setAttribute("open", "");
  els.modelSearch.focus();
  const current = pickerRows.findIndex((r) => r.id === seat.model);
  if (current >= 0) setPickerActive(current, "center");
  // A list kept open for more than 12 hours is out of date: get a new one while you look.
  if (store.modelsAreStale(modelsAt)) void refreshModels();
  // LM Studio's list changes as you download and load models: get it every time.
  if (hasLocal()) void refreshLocalModels();
}

function closeModelPicker(): void {
  if (els.modelDialog.open && typeof els.modelDialog.close === "function") els.modelDialog.close();
  else els.modelDialog.removeAttribute("open");
  pickerSeatId = null;
}

function setPickerActive(i: number, scroll: ScrollLogicalPosition | null = "nearest"): void {
  if (!pickerRows.length) return;
  pickerActive = Math.max(0, Math.min(i, pickerRows.length - 1));
  pickerRows.forEach((r, k) => r.el.classList.toggle("active", k === pickerActive));
  const el = pickerRows[pickerActive]?.el;
  if (scroll && el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: scroll });
}

/**
 * Redraw the list for the current search words (every word must appear in the name or id).
 * With `keep` (a new list has come while the picker is open), the highlighted model stays
 * highlighted and the list stays where it was scrolled to.
 */
function renderPicker(keep = false): void {
  const keepId = keep ? pickerRows[pickerActive]?.id : undefined;
  const keepScroll = els.modelResults.scrollTop;
  const seat = pickerSeatId ? seatById(pickerSeatId) : undefined;
  const q = els.modelSearch.value.trim();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (m: ModelInfo) => {
    const hay = `${m.name} ${m.id}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  // LM Studio's models first, by name; then OpenRouter's, in the order chosen.
  const localFound = sortModels(localModels.filter(matches), "name");
  const found = [...localFound, ...sortModels(models.filter(matches), modelSort)];

  pickerRows = [];
  // Any id typed in full can be used, e.g. a model newer than the cached list.
  if (q.includes("/") && !/\s/.test(q) && !allModels().some((m) => m.id === q)) {
    pickerRows.push({
      id: q,
      el: h("div", { class: "model-row custom", role: "option" }, h("span", { class: "m-name" }, `Use “${q}” as typed`)),
    });
  }
  for (const m of found) {
    pickerRows.push({
      id: m.id,
      el: h(
        "div",
        { class: "model-row" + (seat && m.id === seat.model ? " current" : ""), role: "option" },
        h("span", { class: "m-name" }, m.name),
        h("span", { class: "m-id" }, m.id),
        h("span", { class: "m-price" }, m.local ? (m.local.loaded ? "loaded" : "this computer") : `${priceText(m.inputPrice)} / ${priceText(m.outputPrice)}`),
      ),
    });
  }
  pickerRows.forEach((r, i) => {
    r.el.addEventListener("click", () => chooseModel(r.id));
    r.el.addEventListener("mousemove", () => {
      if (pickerActive !== i) setPickerActive(i, null);
    });
  });

  const empty = allModels().length
    ? "No models match. For a model that has only just appeared, press Refresh list. To use an id that isn’t listed, type it in full (it contains a “/”)."
    : modelsLoading
      ? "Getting OpenRouter’s list of models…"
      : "OpenRouter’s model list hasn’t loaded. Type a model id in full, e.g. anthropic/claude-opus-5.5.";
  els.modelResults.replaceChildren(...(pickerRows.length ? pickerRows.map((r) => r.el) : [h("div", { class: "model-empty" }, empty)]));
  pickerFound = found.length - localFound.length;
  pickerLocalFound = localFound.length;
  updatePickerFoot();
  const kept = keepId === undefined ? -1 : pickerRows.findIndex((r) => r.id === keepId);
  if (kept >= 0) {
    els.modelResults.scrollTop = keepScroll;
    setPickerActive(kept, "nearest");
  } else {
    setPickerActive(0, "nearest");
  }
}

/** The line under the picker's list: how many models, how old the list is, any trouble getting a new one. */
function updatePickerFoot(): void {
  const loading = modelsLoading !== null;
  els.modelRefresh.disabled = loading;
  els.modelRefresh.textContent = loading ? "Refreshing…" : "Refresh list";
  let text = "";
  if (models.length) {
    text = `${pickerFound} of ${models.length} models, from OpenRouter’s list as of ${formatAsOf(new Date(modelsAt))}.`;
    // (While a new list is coming, the price note gives way, so the line stays one line long.)
    if (loading) text += " Getting a newer one…";
    else text += (modelsError ? ` A newer list couldn’t be fetched. ${modelsError}` : "") + " Prices are dollars per million tokens, in / out.";
  } else if (!loading && modelsError) {
    text = `OpenRouter’s list of models couldn’t be fetched. ${modelsError}`;
  }
  // LM Studio's part: how many of its models, or why they couldn't be listed.
  if (localLoading) text += " Asking LM Studio for its models…";
  else if (localError) text += ` ${localError}`;
  else if (localFetched) text += ` ${pickerLocalFound} of ${localModels.length} from LM Studio, listed first.`;
  text = text.trim();
  els.modelCount.textContent = text;
  els.modelCount.classList.toggle("problem", (Boolean(modelsError) && !loading) || (Boolean(localError) && !localLoading));
}

function chooseModel(id: string): void {
  const seat = pickerSeatId ? seatById(pickerSeatId) : undefined;
  closeModelPicker();
  if (!seat) return;
  seat.model = id.trim();
  if (seat.name.trim() === NEW_SEAT_NAME) {
    // A seat that hasn't been named yet is named after its model ("Claude", "Grok", ...).
    seat.name = uniqueSeatName(friendlySeatName(seat.model, modelInfo(seat.model)?.name), settings.seats, seat.id);
    seat.color = seatColorFor(seat.name, settings.seats, seat.id);
    persist();
    renderSeats();
    renderComposerTo();
    return;
  }
  persist();
  seatControls.get(seat.id)?.refreshModel?.();
}

// ---------------------------------------------------------------------------
// Key balance

async function refreshKeyInfo(): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (!hasKey()) {
    keyInfo = null;
    keyInfoFailed = false;
  } else {
    tasks.push(
      fetchKeyInfo(settings.apiKey.trim()).then(
        (info) => {
          keyInfo = info;
          keyInfoFailed = false;
        },
        () => {
          keyInfo = null;
          keyInfoFailed = true;
        },
      ),
    );
  }
  const mkey = settings.managementKey.trim();
  if (!mkey) {
    credit = null;
    creditError = "";
  } else {
    tasks.push(
      fetchCredits(mkey).then(
        (c) => {
          credit = c;
          creditError = "";
        },
        (err: unknown) => {
          credit = null;
          creditError = err instanceof Error ? err.message : String(err);
        },
      ),
    );
  }
  await Promise.all(tasks);
  renderTopbar();
}

// ---------------------------------------------------------------------------
// Settings dialog

function openSettings(): void {
  localServerBefore = settings.localServer;
  fillSettingsForm();
  els.setIncludeKeys.checked = false; // keys go into a file only when asked for each time
  showFileStatus("");
  if (typeof els.dialog.showModal === "function") els.dialog.showModal();
  else els.dialog.setAttribute("open", "");
}

/** Put the current settings into the Settings window's fields. */
function fillSettingsForm(): void {
  els.setKey.value = settings.apiKey;
  els.setKey.type = "password";
  els.setKeyShow.textContent = "Show";
  els.setMkey.value = settings.managementKey;
  els.setMkey.type = "password";
  els.setMkeyShow.textContent = "Show";
  els.setLocal.value = settings.localServer;
  els.setName.value = settings.humanName;
  els.setAbout.value = settings.aboutHuman;
  els.setRules.value = settings.houseRules;
}

function showFileStatus(message: string, isError = false): void {
  els.setFileStatus.textContent = message;
  els.setFileStatus.hidden = !message;
  els.setFileStatus.classList.toggle("error", isError);
}

/** "Dialog settings 2026 Oct 09 1722.json" */
function settingsFileName(at: Date): string {
  return `Dialog settings ${formatDate(at)} ${formatTime(at).replace(":", "")}.json`;
}

/** Save the settings (and the keys, if ticked) as a file. */
function saveSettingsFile(): void {
  const at = new Date();
  const name = settingsFileName(at);
  const withKeys = els.setIncludeKeys.checked;
  void download(store.settingsFileText(settings, withKeys, at), name, "application/json", "Dialog settings").then((saved) => {
    if (!saved) return; // cancelled
    showFileStatus(
      withKeys
        ? `Saved “${saved}”, with your keys. Keep it private: anyone who has it could spend your credit.`
        : `Saved “${saved}”, without your keys.`,
    );
  });
}

/** Restore settings from a file chosen with "Restore from a file…". */
function restoreSettingsFile(file: File): void {
  if (occupied()) {
    showFileStatus("Wait until the current reply has finished, then try again.", true);
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => showFileStatus(`Couldn't read “${file.name}”.`, true);
  reader.onload = () => {
    let restored: store.RestoredSettings;
    try {
      restored = store.settingsFromFile(String(reader.result), settings);
    } catch (err) {
      showFileStatus(err instanceof Error ? err.message : String(err), true);
      return;
    }
    const next = restored.settings;
    const when = restored.savedAt ? `, saved ${formatDate(restored.savedAt)} at ${formatTime(restored.savedAt)}` : "";
    const who = next.seats.length ? `${next.seats.length}: ${next.seats.map((s) => s.name).join(", ")}` : "none";
    const ok = confirm(
      `Replace your current settings with those in “${file.name}”${when}?\n\n` +
        `Your name (${next.humanName}), About you, the house rules and the participants (${who}) will be replaced. ` +
        (restored.hasKeys ? "The file includes keys, which will replace yours. " : "Your keys stay as they are. ") +
        "The conversation itself isn't changed.",
    );
    if (!ok) return;
    const localBefore = settings.localServer;
    settings = next;
    persist();
    if (settings.localServer !== localBefore) localServerChanged();
    fillSettingsForm();
    updateBanner();
    renderSeats();
    renderComposerTo();
    renderTranscript();
    renderTopbar();
    void refreshKeyInfo();
    showFileStatus(`Restored the settings from “${file.name}”.`);
  };
  reader.readAsText(file);
}

function closeSettings(): void {
  if (typeof els.dialog.close === "function") els.dialog.close(); // fires "close", below
  else {
    els.dialog.removeAttribute("open");
    onSettingsClosed();
  }
}

/**
 * Close a dialog when you click the dimmed area around it. Only a click that starts and
 * ends outside counts, so dragging out of it (selecting text, say) doesn't close it.
 */
function closeOnClickOutside(dialog: HTMLDialogElement, close: () => void): void {
  const outside = (ev: MouseEvent) => {
    if (ev.target !== dialog) return false; // a click inside lands on something in the dialog
    const r = dialog.getBoundingClientRect();
    return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
  };
  let startedOutside = false;
  dialog.addEventListener("mousedown", (ev) => {
    startedOutside = outside(ev);
  });
  dialog.addEventListener("click", (ev) => {
    if (startedOutside && outside(ev)) close();
    startedOutside = false;
  });
}

/** The LM Studio address when Settings opened, to tell whether it changed. */
let localServerBefore = "";

function onSettingsClosed(): void {
  if (settings.localServer !== localServerBefore) localServerChanged();
  persist();
  updateBanner();
  renderTranscript();
  renderComposerTo();
  void refreshKeyInfo();
}

// ---------------------------------------------------------------------------
// Save and New

/** The parts of the browser's file-saving interface Dialog uses (Chrome and Edge have it; Safari doesn't). */
interface SaveFilePicker {
  (options: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }): Promise<{
    name: string;
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

/**
 * Save a file. Where the browser lets a page open the system's Save dialog (Chrome, Edge),
 * you choose the folder and name there. Elsewhere it's an ordinary download: Safari puts it
 * in Downloads or, with "Ask for each download" set, shows the same Save dialog itself.
 * Resolves to the name the file was saved under, or null if you cancelled.
 */
async function download(content: string, fileName: string, type = "text/html;charset=utf-8", description = "Web page"): Promise<string | null> {
  const blob = new Blob([content], { type });
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === "function") {
    const ext = fileName.slice(fileName.lastIndexOf("."));
    try {
      const handle = await picker.call(window, {
        suggestedName: fileName,
        types: [{ description, accept: { [type.split(";")[0]!]: [ext] } }],
      });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return handle.name;
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") return null; // you pressed Cancel
      // Anything else (e.g. the browser refusing for a page opened from a file): an ordinary download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return fileName;
}

function exportOptions(): ExportOptions {
  const logo = document.querySelector<HTMLImageElement>(".topbar .medallion")?.src;
  // Replies whose particulars are open on screen are saved with them too.
  return { models: allModels(), render: renderMarkdown, logo, savedAt: new Date(), details: opened };
}

/** Save the whole conversation, or just the ticked turns, as one HTML file that can be resumed. */
function saveConversation(): void {
  updateSaveButton(); // forget ticks on turns that are gone
  const opts = { ...exportOptions(), only: picked.size ? picked : undefined };
  const page = store.withConversationData(prettyHtml(conversationHtml(session, settings, opts)), session, settings, opts.only, opts.savedAt);
  void download(page, conversationFileName(opts.savedAt, picked.size > 0));
}

/**
 * Resume a conversation from a file saved with Save All or Save Selected (offered only while
 * the conversation is empty, so nothing is in progress): its turns, and its participants, house rules,
 * name and About you in place of the current ones. The keys and LM Studio address stay.
 */
function resumeConversation(file: File): void {
  const reader = new FileReader();
  reader.onerror = () => alert(`Couldn't read “${file.name}”.`);
  reader.onload = () => {
    let resumed: store.ResumedConversation;
    try {
      resumed = store.conversationFromFile(String(reader.result), settings);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      return;
    }
    const n = resumed.session.entries.length;
    const when = resumed.savedAt ? `, saved ${formatDate(resumed.savedAt)} at ${formatTime(resumed.savedAt)}` : "";
    const seats = resumed.settings.seats;
    const who = seats.length ? seats.map((s) => s.name).join(", ") : "no participants";
    const ok = confirm(
      `Resume the conversation in “${file.name}”${when}? It has ${n} ${n === 1 ? "turn" : "turns"}, with ${who}.\n\n` +
        "Your participants, house rules, name and About you will be replaced with the ones saved with it. Your keys stay as they are.",
    );
    if (!ok) return;
    stopAll();
    settings = resumed.settings;
    session = resumed.session;
    picked.clear();
    opened.clear();
    persist();
    fillSettingsForm();
    updateBanner();
    renderSeats();
    renderComposerTo();
    renderTranscript(true);
    renderTopbar();
    updateSeatStatus();
  };
  reader.readAsText(file);
}

function newConversation(): void {
  if (!confirm("Start a new conversation? The current one will be cleared. (Save it first if you want to keep it.)")) return;
  stopAll();
  session = newSession();
  picked.clear();
  persist();
  renderTranscript();
  renderTopbar();
  updateSeatStatus();
}

// ---------------------------------------------------------------------------
// Copying

/** The part of `range` that lies within `el`, if it takes in any of its text. */
function partWithin(range: Range, el: Element | null): Range | null {
  if (!el) return null;
  const part = document.createRange();
  part.selectNodeContents(el);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
  return part.toString().trim() ? part : null;
}

function htmlOf(range: Range): string {
  const box = document.createElement("div");
  box.append(range.cloneContents());
  return box.innerHTML;
}

/** The turns a selection takes in, each with the parts of it that are selected. Failed and arriving replies are left out. */
function copiedTurns(range: Range): CopiedTurn[] {
  const turns: CopiedTurn[] = [];
  for (const article of els.transcript.querySelectorAll<HTMLElement>("article.entry")) {
    const e = session.entries.find((x) => x.id === article.dataset.id);
    if (!e || !isSettled(e) || !range.intersectsNode(article)) continue;
    const text = partWithin(range, article.querySelector(":scope > .body"));
    const thinking = partWithin(range, article.querySelector(":scope > .thinking .thought"));
    const turn: CopiedTurn = {
      entry: e,
      html: text ? htmlOf(text) : "",
      text: text?.toString() ?? "",
      thinking: thinking ? htmlOf(thinking) : undefined,
      sources: partWithin(range, article.querySelector(":scope > .sources")) !== null,
      files: partWithin(range, article.querySelector(":scope > .files")) !== null,
      made: partWithin(range, article.querySelector(":scope > .made")) !== null,
    };
    if (turn.html || turn.thinking || turn.sources || turn.files || turn.made) turns.push(turn);
  }
  return turns;
}

/**
 * Copying more than a piece of one turn's text (or everything, with Select All): just the
 * turns, as they look on screen but without the page's buttons and tick boxes, or the cost
 * and speed, so they paste into an email as they look here. A piece of one turn's text is
 * left to the browser, which copies that well.
 */
function onCopy(ev: ClipboardEvent): void {
  const selection = document.getSelection();
  if (!ev.clipboardData || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  if (ev.target instanceof Element && ev.target.closest("input, textarea")) return;
  const range = selection.getRangeAt(0);
  const turns = copiedTurns(range);
  if (!turns.length) return;
  const [first] = turns;
  const justText = turns.length === 1 && !first!.thinking && !first!.sources && !first!.files && !first!.made;
  const margins = [...els.transcript.querySelectorAll("article.entry > header")];
  if (justText && !margins.some((m) => partWithin(range, m))) return;
  ev.clipboardData.setData("text/html", copiedHtml(turns, settings));
  ev.clipboardData.setData("text/plain", copiedText(turns, settings));
  ev.preventDefault();
}

// ---------------------------------------------------------------------------
// Wiring

function wire(): void {
  els.transcript.addEventListener("scroll", followScrolling);
  document.addEventListener("copy", onCopy);
  els.composer.addEventListener("submit", (ev) => void onComposerSubmit(ev));
  els.composerTo.addEventListener("change", updateComposerState);
  els.composerText.addEventListener("input", updateComposerState); // who Return would ask follows your typing
  els.composerText.placeholder = `Your contribution… (${NEWLINE_KEY} for a new line)`;
  els.composerText.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    // Leave alone: Return that finishes composing a character in an input method (Safari
    // reports that one as key code 229), and Shift-Return, which the box turns into a new line.
    if (ev.isComposing || ev.keyCode === 229 || ev.shiftKey) return;
    ev.preventDefault();
    if (ev.altKey) {
      insertNewline(els.composerText); // Option-Return: a new line too (browsers differ on their own)
      return;
    }
    if (ev.metaKey || ev.ctrlKey) submitComposer(); // ⌘↩: just add
    else void sendAndAsk(); // Return: add, and a participant replies
  });

  // Clicking the medallion or the name shows the version under the name; clicking again hides it.
  els.brandVersion.textContent = `Version ${VERSION}`;
  els.brand.addEventListener("click", () => {
    const show = els.brandVersion.hidden;
    els.brandVersion.hidden = !show;
    els.brand.setAttribute("aria-expanded", String(show));
    els.brand.title = show ? "Hide Dialog's version" : "Show Dialog's version";
  });
  els.btnSave.addEventListener("click", saveConversation);
  els.btnNew.addEventListener("click", newConversation);
  els.btnResume.addEventListener("click", () => els.resumeInput.click());
  els.resumeInput.addEventListener("change", () => {
    const file = els.resumeInput.files?.[0];
    els.resumeInput.value = ""; // so the same file can be chosen again
    if (file) resumeConversation(file);
  });
  els.btnSettings.addEventListener("click", openSettings);
  els.btnAddSeat.addEventListener("click", addSeat);
  wireSeatDragging();
  els.banner.addEventListener("click", () => {
    if (!hasKey()) openSettings();
  });

  els.setKey.addEventListener("input", () => {
    settings.apiKey = els.setKey.value.trim();
    persistSoon();
  });
  els.setMkey.addEventListener("input", () => {
    settings.managementKey = els.setMkey.value.trim();
    persistSoon();
  });
  els.setVersion.textContent = `Version ${VERSION}`;
  els.setLocal.placeholder = LOCAL_EXAMPLE;
  // Clicking into the empty box fills in the usual address, selected so typing replaces it.
  els.setLocal.addEventListener("focus", () => {
    if (els.setLocal.value.trim()) return;
    els.setLocal.value = LOCAL_EXAMPLE;
    els.setLocal.select();
    settings.localServer = LOCAL_EXAMPLE;
    persistSoon();
  });
  els.setLocal.addEventListener("input", () => {
    settings.localServer = els.setLocal.value.trim();
    persistSoon();
  });
  els.setMkeyShow.addEventListener("click", () => {
    const show = els.setMkey.type === "password";
    els.setMkey.type = show ? "text" : "password";
    els.setMkeyShow.textContent = show ? "Hide" : "Show";
  });
  els.setKeyShow.addEventListener("click", () => {
    const show = els.setKey.type === "password";
    els.setKey.type = show ? "text" : "password";
    els.setKeyShow.textContent = show ? "Hide" : "Show";
  });
  els.setAbout.addEventListener("input", () => {
    settings.aboutHuman = els.setAbout.value;
    persistSoon();
  });
  els.attachButton.addEventListener("click", () => els.attachInput.click());
  els.attachInput.addEventListener("change", () => {
    const files = Array.from(els.attachInput.files ?? []);
    els.attachInput.value = ""; // so the same file can be picked again
    void addFiles(files);
  });
  wireDrop();
  els.setName.addEventListener("input", () => {
    settings.humanName = els.setName.value.trim() || defaultSettings().humanName;
    persistSoon();
  });
  els.setRules.addEventListener("input", () => {
    settings.houseRules = els.setRules.value;
    persistSoon();
  });
  els.setRulesReset.addEventListener("click", () => {
    if (!confirm("Replace the house rules with the defaults?")) return;
    settings.houseRules = DEFAULT_HOUSE_RULES;
    els.setRules.value = DEFAULT_HOUSE_RULES;
    persist();
  });
  els.dialog.addEventListener("close", onSettingsClosed);
  els.setSaveFile.addEventListener("click", saveSettingsFile);
  els.setRestoreFile.addEventListener("click", () => els.setRestoreInput.click());
  els.setRestoreInput.addEventListener("change", () => {
    const file = els.setRestoreInput.files?.[0];
    els.setRestoreInput.value = ""; // so the same file can be chosen again
    if (file) restoreSettingsFile(file);
  });
  closeOnClickOutside(els.dialog, closeSettings);

  // Model picker: type to filter; arrow keys move; Return chooses; Escape or Cancel closes.
  els.modelSearch.addEventListener("input", () => renderPicker());
  els.modelSearch.addEventListener("keydown", (ev) => {
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 20, PageUp: -20 };
    const delta = step[ev.key];
    if (delta !== undefined) {
      ev.preventDefault();
      setPickerActive(pickerActive + delta);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const row = pickerRows[pickerActive];
      if (row) chooseModel(row.id);
    }
  });
  els.modelSort.value = modelSort;
  els.modelSort.addEventListener("change", () => {
    modelSort = MODEL_SORTS.find((x) => x === els.modelSort.value) ?? "name";
    store.saveModelSort(modelSort);
    renderPicker(); // from the top, in the new order
    els.modelSearch.focus();
  });
  els.modelRefresh.addEventListener("click", () => {
    void refreshModels();
    if (hasLocal()) void refreshLocalModels();
    els.modelSearch.focus(); // so typing, the arrow keys and Return carry on working
  });
  els.modelCancel.addEventListener("click", closeModelPicker);
  // Escape closes the picker even from the search field, where Safari would otherwise
  // only clear the text.
  els.modelDialog.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    closeModelPicker();
  });
  els.modelDialog.addEventListener("close", () => {
    pickerSeatId = null;
  });
  closeOnClickOutside(els.modelDialog, closeModelPicker);

  window.addEventListener("beforeunload", persist);
}

function start(): void {
  wire();
  renderTopbar();
  updateBanner();
  renderSeats();
  renderComposerTo();
  renderTranscript(true);
  loadModels();
  void refreshKeyInfo();
}

start();
