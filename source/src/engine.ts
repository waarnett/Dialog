// The engine: Dialog's rules, independent of how the page looks.
//
// The central idea: the conversation is kept once, as a list of entries. When a seat
// is asked to speak, buildMessages() constructs *that seat's own view* of the
// conversation in the two-speaker format the model APIs expect:
//   - the seat's own earlier replies become "assistant" messages;
//   - everything said by anyone else becomes "user" messages, labeled "Name says:";
//   - private exchanges with other seats are left out entirely.

import { isLocalModel, localId, localModelName } from "./lmstudio";
import type { ModelInfo } from "./openrouter";
import type { Addressee, Attachment, ChatMessage, ContentPart, Entry, MadeFile, MadeKind, Seat, Session, Settings } from "./types";

// ---------------------------------------------------------------------------
// Defaults

/** The house rules up to 2026 Oct 07; saved copies identical to this are upgraded. */
const PREVIOUS_HOUSE_RULES = `You are {name}, one of several participants in a moderated group conversation.

Participants:
{participants}

How the conversation works:
- {humanName} is the human moderator and decides who speaks next. You are speaking now because {humanName} asked you to.
- Messages from others reach you labeled "Name says:". Your own earlier contributions appear without a label.
- Write only your own contribution. Don't begin with your name or "{name} says:", and never write lines for other participants.
- A message from {humanName} marked "privately" is seen only by you, and your reply to it is private too. The others never see private exchanges, so don't refer to them as if they had.
- Today's date is {date}.`;

export const DEFAULT_HOUSE_RULES = `${PREVIOUS_HOUSE_RULES}

How to contribute:
- If you agree with something already said, say so briefly; don't repeat it. If you have something to add, correct or qualify, do that without repeating what's been said.
- Keep each contribution focused: a few paragraphs, unless {humanName} asks for more depth.
- Avoid even a hint of sycophancy, toward {humanName} or toward the other participants. If someone says something wrong, say so and why. If {humanName} says something right, a plain "right" or "OK" is enough; save praise for an unusually sharp point.
- When you're unsure, say so. Give your confidence as a percentage for claims and conclusions that matter (e.g. "my confidence: 25%"), and say what would raise or lower it. Don't say 100% or 0% without clear, hard evidence.

How to think:
- When discussing an idea, consider how it applies in particular situations, look for the general case and the special cases, and try to reach the underlying structure of the idea, especially for abstract concepts. Be consistent.
- Apply a concept in a new context only when the circumstances are clearly analogous, and explain why they are.
- If you're confused, say so. It's fine to be humble; it's not fine to claim more than you can justify.
- Your knowledge comes from text, not from direct experience of the world. If you're unsure about some physical aspect of the subject, say so and ask.
- Bring all relevant context to bear; your knowledge is vast, so use it. If you're missing information, search the web if you can, or ask {humanName}. A cogent answer that misses a key concept is worse than none.
- If there's more than one reasonable answer, present each with its pluses and minuses and your confidence in it. Show the evidence, especially the evidence against your favorite. {humanName} would rather see the alternatives than have you choose.
- In a hypothetical or counterfactual, stick to the exact hypothetical posed; if you need further assumptions to make your case, state them plainly. Asked "what would X say about Y?", explain why X would think it as well as what X would say.
- On normative questions, keep facts separate from value judgements.
- Make your reasoning explicit, especially in multi-step chains, and check that each step is consistent with the ones before it.

The greatest danger is a perfectly cogent presentation that is simply wrong. No answer, or a qualified one, is better than a confident mistake.`;

// The confidence rule as it read from 2026 Oct 07 to Oct 09, and as it reads now.
const CONFIDENCE_RULE_OCT07 = `- When you're unsure, say so. Give your confidence as a percentage for claims and conclusions that matter (e.g. "my confidence: 25%"), and say what would raise it. Don't say 100% without clear, hard evidence.`;
const CONFIDENCE_RULE = `- When you're unsure, say so. Give your confidence as a percentage for claims and conclusions that matter (e.g. "my confidence: 25%"), and say what would raise or lower it. Don't say 100% or 0% without clear, hard evidence.`;

/** The default house rules from 2026 Oct 07 to Oct 09. */
const HOUSE_RULES_OCT07 = DEFAULT_HOUSE_RULES.replace(CONFIDENCE_RULE, CONFIDENCE_RULE_OCT07);

/**
 * Saved house rules, brought up to date: an untouched old default becomes the current
 * default; edited rules that still contain the old confidence rule word for word get just
 * that rule updated, and are otherwise left exactly as they are.
 */
export function upgradeHouseRules(saved: string): string {
  const t = saved.trim();
  if (t === PREVIOUS_HOUSE_RULES || t === HOUSE_RULES_OCT07) return DEFAULT_HOUSE_RULES;
  return saved.replace(CONFIDENCE_RULE_OCT07, CONFIDENCE_RULE);
}

/** Colors for the familiar families; other seats get one from OTHER_SEAT_COLORS. */
export const SEAT_COLORS: Record<string, string> = {
  Claude: "#c96442",
  ChatGPT: "#10a37f",
  Gemini: "#4285f4",
  Grok: "#6b7280",
  DeepSeek: "#4d6bfe",
  Qwen: "#615ced",
  Mistral: "#e25822",
  Llama: "#0866ff",
};
export const OTHER_SEAT_COLORS = ["#8e44ad", "#d35400", "#16a085", "#c0392b", "#2c3e50", "#b7950b"];

/** The name a just-added seat carries until a model is chosen for it. */
export const NEW_SEAT_NAME = "New seat";

const FAMILIES: [RegExp, string][] = [
  [/^~?anthropic\//, "Claude"],
  [/^~?openai\//, "ChatGPT"],
  [/^~?google\//, "Gemini"],
  [/^~?x-ai\//, "Grok"],
  [/^~?deepseek\//, "DeepSeek"],
  [/^~?qwen\//, "Qwen"],
  [/^~?mistralai\//, "Mistral"],
  [/^~?meta(-llama)?\//, "Llama"],
];

/**
 * A short participant name for a model: "Claude" for anthropic/…, else the model's own name.
 * A model in LM Studio is named after itself ("Gemma 4 31B QAT"), not its maker's family.
 */
export function friendlySeatName(modelId: string, modelName?: string): string {
  if (isLocalModel(modelId)) return localModelName(localId(modelId)) || modelId;
  for (const [re, name] of FAMILIES) if (re.test(modelId.trim())) return name;
  const fromName = modelName?.replace(/^[^:]+:\s*/, "").trim(); // "Z.ai: GLM 5.3" -> "GLM 5.3"
  if (fromName) return fromName;
  return modelId.replace(/^~?[^/]*\//, "").trim() || modelId;
}

/** `base`, or "base 2", "base 3"… if that name is taken. */
export function uniqueSeatName(base: string, seats: Seat[], exceptId?: string): string {
  const taken = new Set(seats.filter((s) => s.id !== exceptId).map((s) => s.name));
  if (!taken.has(base)) return base;
  let k = 2;
  while (taken.has(`${base} ${k}`)) k++;
  return `${base} ${k}`;
}

/** The family's color if no other seat is using it, else the first unused other color. */
export function seatColorFor(name: string, seats: Seat[], exceptId?: string): string {
  const used = new Set(seats.filter((s) => s.id !== exceptId).map((s) => s.color));
  const family = SEAT_COLORS[name.replace(/\s+\d+$/, "")];
  if (family && !used.has(family)) return family;
  return OTHER_SEAT_COLORS.find((c) => !used.has(c)) ?? OTHER_SEAT_COLORS[seats.length % OTHER_SEAT_COLORS.length] ?? "#888888";
}

/** First run: no participants yet (add them with "+ Add a seat"), and a placeholder name. */
export function defaultSettings(): Settings {
  return {
    apiKey: "",
    managementKey: "",
    localServer: "",
    humanName: "John Doe",
    aboutHuman: "",
    houseRules: DEFAULT_HOUSE_RULES,
    seats: [],
  };
}

export function newSession(now = new Date()): Session {
  return { startedAt: now.toISOString(), entries: [] };
}

// ---------------------------------------------------------------------------
// Small helpers

export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026 Oct 06" (local time). */
export function formatDate(d: Date): string {
  return `${d.getFullYear()} ${MONTHS[d.getMonth()]} ${pad2(d.getDate())}`;
}

/** "23:05" (local time, 24-hour). */
export function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** When something happened, briefly: "15:28 today", or "2026 Oct 14 at 09:01" on another day. */
export function formatAsOf(d: Date, now = new Date()): string {
  return formatDate(d) === formatDate(now) ? `${formatTime(d)} today` : `${formatDate(d)} at ${formatTime(d)}`;
}

/** "820 bytes", "12 KB", "1.4 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "notes.md (text, 12 KB, about 3,000 tokens)". */
export function describeAttachment(a: Attachment): string {
  const kind = a.kind === "pdf" ? "PDF" : a.kind;
  const bits = [kind, formatBytes(a.size)];
  if (a.tokens) bits.push(`about ${a.tokens.toLocaleString("en-US")} tokens`);
  return `${a.name} (${bits.join(", ")})`;
}

const MADE_KIND_LABELS: Record<MadeKind, string> = { html: "web page", svg: "drawing", md: "Markdown", txt: "text" };

/** "plan.md (Markdown, 2 KB)". */
export function describeMadeFile(f: MadeFile): string {
  return `${f.name} (${MADE_KIND_LABELS[f.kind]}, ${formatBytes(f.size)})`;
}

/** "$0.0213" for small amounts, "$1.27" otherwise. */
export function formatCost(dollars: number): string {
  if (dollars === 0) return "$0.00";
  if (Math.abs(dollars) < 0.1) return "$" + dollars.toFixed(4);
  return "$" + dollars.toFixed(2);
}

/** Darken (negative amount) or lighten (positive) a #rrggbb color. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount))),
  );
  return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** A second seat of the same bot: same model and settings, new name and a darker color. */
export function copySeat(seat: Seat, existing: Seat[]): Seat {
  const base = seat.name.replace(/\s+\d+$/, "");
  const taken = new Set(existing.map((s) => s.name));
  let k = 2;
  while (taken.has(`${base} ${k}`)) k++;
  const { asleep: _asleep, ...awake } = seat; // a copy starts awake
  return { ...awake, id: newId(), name: `${base} ${k}`, role: "", color: shade(seat.color, -0.3) };
}

// ---------------------------------------------------------------------------
// Thinking levels

export interface ThinkingChoice {
  /** What gets stored on the seat: a level, or "default" (send nothing; the model decides). */
  value: string;
  label: string;
}

/**
 * The Thinking menu for a model: exactly the levels its OpenRouter page lists, highest
 * first, with the model's own default marked. Choosing the default sends no setting.
 */
export function thinkingChoices(model: ModelInfo | undefined): ThinkingChoice[] {
  if (!model) return [{ value: "default", label: "model’s default" }];
  const r = model.reasoning;
  if (!r || r.efforts.length === 0) return [{ value: "default", label: "not adjustable" }];
  let def = r.defaultEffort;
  if (!def && !r.mandatory && r.defaultEnabled === false && r.efforts.includes("none")) def = "none";
  const choices = r.efforts.map((e) =>
    e === def ? { value: "default", label: `${e} (default)` } : { value: e, label: e },
  );
  if (!def || !r.efforts.includes(def)) choices.unshift({ value: "default", label: "model’s default" });
  return choices;
}

/** The Thinking menu's label for a seat's current setting, e.g. "high (default)". */
export function thinkingLabel(seat: Pick<Seat, "effort">, model: ModelInfo | undefined): string {
  const choice = thinkingChoices(model).find((c) => c.value === seat.effort);
  return choice ? choice.label : seat.effort === "default" ? "model’s default" : seat.effort;
}

// ---------------------------------------------------------------------------
// The model picker's order

/** How the model picker can sort: by name, or by input or output price, lowest or highest first. */
export const MODEL_SORTS = ["name", "in-asc", "in-desc", "out-asc", "out-desc"] as const;
export type ModelSort = (typeof MODEL_SORTS)[number];

/**
 * Models in the picker's order. Models whose price varies (routers, which pass each request
 * to a model they pick; OpenRouter lists their price as -1) go last whichever way prices are
 * sorted; models at the same price are in name order.
 */
export function sortModels(list: ModelInfo[], sort: ModelSort): ModelInfo[] {
  const byName = (a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name);
  if (sort === "name") return [...list].sort(byName);
  const price = (m: ModelInfo) => (sort.startsWith("in") ? m.inputPrice : m.outputPrice);
  const dir = sort.endsWith("desc") ? -1 : 1;
  return [...list].sort((a, b) => {
    const [pa, pb] = [price(a), price(b)];
    if (pa < 0 || pb < 0) return pa < 0 && pb < 0 ? byName(a, b) : pa < 0 ? 1 : -1;
    return (pa - pb) * dir || byName(a, b);
  });
}

// ---------------------------------------------------------------------------
// Private exchanges

/** The seats a private entry is shared with (by id), or undefined if everyone sees it. */
export function privateGroup(e: Pick<Entry, "privateWith">): string[] | undefined {
  const p = e.privateWith;
  if (!p || (Array.isArray(p) && !p.length)) return undefined;
  return Array.isArray(p) ? p : [p];
}

/** How a private group is stored: one seat's id as it always was, several as a list. */
export function privateWithFor(group: string[] | undefined): string | string[] | undefined {
  if (!group || !group.length) return undefined;
  return group.length === 1 ? group[0] : [...group];
}

/** Can this seat see this entry? (Everyone sees what isn't private.) */
export function canSee(seatId: string, e: Pick<Entry, "privateWith">): boolean {
  const g = privateGroup(e);
  return !g || g.includes(seatId);
}

/**
 * A private entry's stage direction, without the parentheses: "privately, to Grok" or
 * "privately, to Claude and Grok, in turn" for yours; "privately, to Bill" or "privately, to
 * Bill and Grok" for a participant's reply. Undefined if the entry isn't private.
 */
export function privateLabel(e: Entry, seats: Seat[], humanName: string): string | undefined {
  const group = privateGroup(e);
  if (!group) return undefined;
  const name = (id: string) => seats.find((s) => s.id === id)?.name ?? "a removed seat";
  if (e.speaker === "human") {
    if (e.addressedTo && !("seatId" in e.addressedTo)) return `privately, ${addresseeLabel(e.addressedTo, seats)}`;
    return `privately, to ${nameList(group.map(name))}`;
  }
  return `privately, to ${nameList([humanName, ...group.filter((id) => id !== e.speaker).map(name)])}`;
}

/** Is this entry part of the shared record (as opposed to failed or still arriving)? */
export function isSettled(e: Entry): boolean {
  if (e.speaker === "human") return true;
  return (e.status === "done" || e.status === "stopped") && (e.text.trim() !== "" || (e.made?.length ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// Speed

export interface Speed {
  /** From pressing Speak to the last word. */
  seconds: number;
  /** Output tokens (thinking included) per second over that whole time. */
  tokensPerSecond: number;
  /** When the first visible words arrived. */
  firstTextSeconds?: number;
  /** How fast the visible text arrived once it started (the nearest thing to raw generation speed). */
  visibleTokensPerSecond?: number;
}

export function turnSpeed(e: Entry): Speed | undefined {
  const t = e.timing;
  const u = e.usage;
  if (!t || !u || u.completionTokens <= 0 || t.totalMs <= 0) return undefined;
  const seconds = t.totalMs / 1000;
  const speed: Speed = { seconds, tokensPerSecond: u.completionTokens / seconds };
  if (t.firstTextMs !== undefined) {
    speed.firstTextSeconds = t.firstTextMs / 1000;
    const streaming = (t.totalMs - t.firstTextMs) / 1000;
    const visible = u.completionTokens - u.reasoningTokens;
    if (streaming >= 0.5 && visible > 0) speed.visibleTokensPerSecond = visible / streaming;
  }
  return speed;
}

/** "69 tokens/s" */
export function speedLabel(s: Speed): string {
  return `${Math.round(s.tokensPerSecond).toLocaleString("en-US")} tokens/s`;
}

/** The longer explanation shown on hover. */
export function speedDetails(e: Entry, s: Speed): string {
  const u = e.usage;
  const n = (x: number) => x.toLocaleString("en-US");
  const parts: string[] = [];
  if (u) {
    parts.push(
      `${n(u.completionTokens)} tokens written` +
        (u.reasoningTokens ? ` (${n(u.reasoningTokens)} of them thinking)` : "") +
        ` in ${s.seconds.toFixed(1)} s from pressing Speak to the last word: ${n(Math.round(s.tokensPerSecond))} tokens per second overall.`,
    );
  }
  if (s.firstTextSeconds !== undefined) {
    let line = `The first words appeared after ${s.firstTextSeconds.toFixed(1)} s`;
    if (s.visibleTokensPerSecond !== undefined) {
      line += `; after that, text arrived at about ${n(Math.round(s.visibleTokensPerSecond))} tokens per second`;
    }
    parts.push(line + ".");
  }
  return parts.join(" ");
}

/** A reply's token counts in words: "12,345 tokens read (…); 1,480 written (…)". */
export function usageText(e: Entry): string | undefined {
  const u = e.usage;
  if (!u) return undefined;
  const n = (x: number) => x.toLocaleString("en-US");
  const parts: string[] = [];
  if (u.cachedTokens) parts.push(`${n(u.cachedTokens)} at the re-read discount`);
  if (u.cacheWriteTokens) parts.push(`${n(u.cacheWriteTokens)} stored for re-reading`);
  const read = `${n(u.promptTokens)} tokens read` + (parts.length ? ` (${parts.join(", ")})` : "");
  const wrote = `${n(u.completionTokens)} written` + (u.reasoningTokens ? ` (${n(u.reasoningTokens)} of them thinking)` : "");
  return `${read}; ${wrote}`;
}

/**
 * The full particulars of a reply, shown in place of its cost and speed when you tap them:
 * the model that answered and the thinking level it was given, the cost with its token
 * counts, the speed with its breakdown, and whether it was stopped early.
 */
export function turnDetails(e: Entry, models?: ModelInfo[]): string[] {
  if (e.speaker === "human") return [];
  const lines: string[] = [];
  const model = e.model ?? e.seatModel;
  if (model) {
    const asked = e.seatModel && e.model && e.seatModel !== e.model ? ` (for ${e.seatModel})` : "";
    const thinking = e.seatEffort === undefined ? "" : `; thinking: ${thinkingLabel({ effort: e.seatEffort }, models?.find((m) => m.id === (e.seatModel ?? model).trim()))}`;
    lines.push(`Model: ${model}${asked}${thinking}.`);
  }
  if (e.cost !== undefined) {
    const usage = usageText(e);
    lines.push(`Cost: ${formatCost(e.cost)}` + (usage ? `, for ${usage}.` : "."));
  }
  const speed = turnSpeed(e);
  if (speed) lines.push(`Speed: ${speedDetails(e, speed)}`);
  if (e.status === "stopped") lines.push("Stopped early.");
  return lines;
}

export function totalCost(entries: Entry[]): number {
  return entries.reduce((sum, e) => sum + (e.cost ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Files the participants make
//
// A participant makes a file by writing it, on lines of its own, between <file name="…">
// and </file>: the same form in which it receives the files you attach. Dialog takes the
// file out of the reply and shows it as a card you can open or save; the other
// participants are given it after the reply's text.

/** What every participant is told about making files (after the house rules). */
export const MAKING_FILES_NOTE = `Making files: if {humanName} asks for a file, or a file is clearly the best way to deliver something (a document, a table, a drawing, a small web page), you can make one. Write it on lines of its own between <file name="name.ext"> and </file>, with the whole contents in between and nothing else around them, not even a code fence. Use .md, .txt, .svg or .html; make a web page complete in one file, with its styles and scripts inside it. {humanName} sees each file as a card with buttons to open or save it, and the other participants see it too. Mention the file in your reply, but don't repeat its contents outside the tags. To revise a file, write it again in full under the same name; the newer version replaces the older one for everyone.`;

/** The kind of file a name stands for: .html/.htm, .svg, .md/.markdown, anything else text. */
export function madeKind(name: string): MadeKind {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "svg") return "svg";
  if (ext === "md" || ext === "markdown") return "md";
  return "txt";
}

/** A safe file name from what a participant wrote: no folders, no odd characters, with an extension. */
export function cleanFileName(raw: string): string {
  let name = raw.split(/[/\\]/).pop() ?? "";
  name = name.replace(/[\u0000-\u001f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "");
  if (name.length > 100) {
    const ext = /\.[a-z0-9]{1,10}$/i.exec(name)?.[0] ?? "";
    name = name.slice(0, 100 - ext.length).trimEnd() + ext;
  }
  if (!name) return "file.txt";
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.txt`;
}

/** One file found in a reply. */
export interface FoundFile {
  name: string;
  content: string;
  /** The reply ended before </file>. */
  incomplete?: boolean;
}

/** A reply split into its text and its files. */
export interface FileSplit {
  /** The reply without the files. */
  text: string;
  files: FoundFile[];
  /** While a reply is still arriving: the file being written now, and how much of it has come. */
  writing?: { name: string; size: number };
}

const FILE_OPEN = /^[ \t]*<file\s+name\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')\s*>[ \t]*\r?\n?/gim;
const FILE_CLOSE = /\r?\n?[ \t]*<\/file\s*>/gi;

/** A file's contents, without a code fence wrapped around the whole of it (some models add one). */
function unwrapFence(content: string): string {
  const m = /^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*\s*$/.exec(content);
  return m ? m[2]! : content;
}

/** The number of bytes a text takes (UTF-8). */
export function byteSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Take the files out of a reply. A file begins with <file name="…"> at the start of a line
 * and ends with </file>. While the reply is still arriving (`arriving`), a file not yet
 * closed is reported as being written; afterwards, it is kept and marked incomplete.
 */
export function splitFiles(raw: string, arriving = false): FileSplit {
  const files: FoundFile[] = [];
  let writing: FileSplit["writing"];
  let text = "";
  let pos = 0;
  const open = new RegExp(FILE_OPEN.source, FILE_OPEN.flags);
  for (let m = open.exec(raw); m; m = open.exec(raw)) {
    const name = cleanFileName(m[1] ?? m[2] ?? "");
    const bodyStart = m.index + m[0].length;
    const close = new RegExp(FILE_CLOSE.source, FILE_CLOSE.flags);
    close.lastIndex = bodyStart;
    const c = close.exec(raw);
    text += raw.slice(pos, m.index);
    if (!c) {
      const content = raw.slice(bodyStart);
      if (arriving) writing = { name, size: byteSize(content) };
      else files.push({ name, content: unwrapFence(content), incomplete: true });
      pos = raw.length;
      break;
    }
    files.push({ name, content: unwrapFence(raw.slice(bodyStart, c.index)) });
    pos = c.index + c[0].length;
    open.lastIndex = pos;
  }
  text += raw.slice(pos);
  if (files.length || writing) {
    text = text
      .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n(?:[ \t]*\n)*[ \t]*\1[ \t]*$/gm, "") // a code fence left empty
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return { text, files, writing };
}

/** A found file, ready to keep with its reply. */
export function madeFileFrom(f: FoundFile): MadeFile {
  const made: MadeFile = { id: newId(), name: f.name, kind: madeKind(f.name), size: byteSize(f.content), data: f.content };
  if (f.incomplete) made.incomplete = true;
  return made;
}

/** The made files that a later file of the same name replaces (by id), among the given entries. */
export function replacedFiles(entries: Entry[]): Set<string> {
  const latest = new Map<string, string>();
  const replaced = new Set<string>();
  for (const e of entries) {
    if (!isSettled(e)) continue;
    for (const f of e.made ?? []) {
      if (f.removed) continue;
      const key = f.name.toLowerCase();
      const before = latest.get(key);
      if (before) replaced.add(before);
      latest.set(key, f.id);
    }
  }
  return replaced;
}

/** How a made file reaches a participant: its contents, or a note saying why not. */
function madeFileText(f: MadeFile, maker: string, humanName: string, replaced: ReadonlySet<string>): string {
  if (f.removed) return `(${maker}'s file ${f.name} was here; ${humanName} has since removed it.)`;
  if (replaced.has(f.id)) return `(${maker}'s file ${f.name} was here; a later version of it comes further on.)`;
  if (f.data === undefined) return `(${maker}'s file ${f.name} was here, but it is no longer available.)`;
  const note = f.incomplete ? `\n(This file may be incomplete: the reply ended before the file did.)` : "";
  return `<file name="${f.name}">\n${f.data}\n</file>${note}`;
}

// ---------------------------------------------------------------------------
// What each seat sees

/** The house rules with the placeholders filled in for one seat. */
export function systemPromptFor(seat: Seat, settings: Settings, now = new Date()): string {
  const participants = [
    `- ${settings.humanName} (human moderator)`,
    ...settings.seats.map((s) => `- ${s.name}: model ${s.model}${s.id === seat.id ? " (this is you)" : ""}`),
  ].join("\n");
  const filled = settings.houseRules
    .split("{name}").join(seat.name)
    .split("{humanName}").join(settings.humanName)
    .split("{participants}").join(participants)
    .split("{date}").join(formatDate(now));
  let prompt = filled + "\n\n" + MAKING_FILES_NOTE.split("{humanName}").join(settings.humanName);
  const about = settings.aboutHuman.trim();
  if (about) prompt += `\n\nAbout ${settings.humanName}, in ${settings.humanName}'s own words:\n${about}`;
  const role = seat.role.trim();
  if (role) prompt += `\n\nYour role in this conversation:\n${role}`;
  return prompt;
}

/** What the seat's model can take in directly. */
export interface ModelAbilities {
  /** Can it look at images? If not, it is told an image was shared. */
  images: boolean;
  /** Can it be sent PDFs (unset: yes)? If not, it is told a PDF was shared. */
  pdfs?: boolean;
}

/** The parts that carry one entry to a seat that didn't write it. */
function entryParts(
  e: Entry,
  humanName: string,
  abilities: ModelAbilities,
  seats: Seat[],
  replaced: ReadonlySet<string>,
  viewerId: string,
): ContentPart[] {
  const files = e.attachments ?? [];
  const group = privateGroup(e);
  const name = (id: string) => seats.find((s) => s.id === id)?.name ?? "a removed seat";
  let label: string;
  if (e.speaker === "human") {
    const verb = e.text.trim() ? "says" : files.length > 1 ? "shares these files" : "shares a file";
    const to = e.addressedTo ? ` (${addresseeLabel(e.addressedTo, seats, true)})` : "";
    if (group) {
      // Who else can see it, and (to several) how they are to reply.
      const others = group.filter((id) => id !== viewerId).map(name);
      const how = e.addressedTo && !("seatId" in e.addressedTo) ? `; ${addresseeLabel(e.addressedTo, seats, true)}` : "";
      label = `${humanName} ${verb} (privately, only you${others.length ? ` and ${nameList(others)}` : ""} can see this${how}):`;
    } else {
      label = `${humanName} ${verb}${to}:`;
    }
  } else if (group) {
    // Another member's reply in a private exchange with several.
    const others = group.filter((id) => id !== e.speaker && id !== viewerId).map(name);
    label = `${e.speakerName} says (privately; only ${nameList([humanName, ...others, "you"])} can see this):`;
  } else {
    label = `${e.speakerName} says:`;
  }
  const parts: ContentPart[] = [{ type: "text", text: e.text.trim() ? `${label}\n${e.text}` : label }];
  for (const f of e.made ?? []) parts.push({ type: "text", text: madeFileText(f, e.speakerName, humanName, replaced) });

  for (const a of files) {
    if (!a.data) {
      parts.push({ type: "text", text: `(${humanName} attached ${a.name}, but the file is no longer available.)` });
    } else if (a.kind === "text") {
      parts.push({ type: "text", text: `<file name="${a.name}">\n${a.data}\n</file>` });
    } else if (a.kind === "image") {
      if (abilities.images) {
        parts.push({ type: "text", text: `(Attached image: ${a.name})` });
        parts.push({ type: "image_url", image_url: { url: a.data } });
      } else {
        parts.push({ type: "text", text: `(${humanName} attached an image, ${a.name}, but your model can't view images.)` });
      }
    } else if (abilities.pdfs === false) {
      parts.push({ type: "text", text: `(${humanName} attached a PDF, ${a.name}, but your model can't read PDFs.)` });
    } else {
      parts.push({ type: "text", text: `(Attached PDF: ${a.name})` });
      parts.push({ type: "file", file: { filename: a.name, file_data: a.data } });
    }
  }
  return parts;
}

/**
 * Build the messages to send when `seat` is asked to speak.
 * The result always starts with the system prompt, alternates user/assistant,
 * begins with a user message and ends with one (as all the providers require).
 * Messages are plain text unless images or PDFs are included.
 */
export function buildMessages(
  seat: Seat,
  settings: Settings,
  entries: Entry[],
  now = new Date(),
  abilities: ModelAbilities = { images: true },
): ChatMessage[] {
  const turns: { role: "user" | "assistant"; parts: ContentPart[] }[] = [];
  // Consecutive pieces of text, within an entry or across entries, are joined into one.
  const push = (role: "user" | "assistant", parts: ContentPart[]) => {
    let last = turns[turns.length - 1];
    if (!last || last.role !== role) {
      last = { role, parts: [] };
      turns.push(last);
    }
    for (const p of parts) {
      const tail = last.parts[last.parts.length - 1];
      if (p.type === "text" && tail?.type === "text") tail.text += "\n\n" + p.text;
      else last.parts.push(p.type === "text" ? { ...p } : p);
    }
  };
  const text = (t: string): ContentPart[] => [{ type: "text", text: t }];

  // What this seat can see; among its files, the ones replaced by a later version.
  const seen = entries.filter((e) => isSettled(e) && canSee(seat.id, e));
  const replaced = replacedFiles(seen);
  for (const e of seen) {
    if (e.speaker === seat.id) {
      // Its own reply, with its own files as it wrote them (or a note where they're gone).
      const own = [e.text, ...(e.made ?? []).map((f) => madeFileText(f, e.speakerName, settings.humanName, replaced))];
      push("assistant", text(own.filter((t) => t.trim()).join("\n\n")));
    } else {
      push("user", entryParts(e, settings.humanName, abilities, settings.seats, replaced, seat.id));
    }
  }

  const opener = `(${settings.humanName} has asked you to open the conversation.)`;
  if (turns.length === 0) turns.push({ role: "user", parts: text(opener) });
  else if (turns[0]?.role === "assistant") turns.unshift({ role: "user", parts: text(opener) });
  if (turns[turns.length - 1]?.role === "assistant") {
    turns.push({ role: "user", parts: text(`(${settings.humanName} asks you to continue.)`) });
  }

  const messages: ChatMessage[] = turns.map((t) => {
    const allText = t.parts.every((p) => p.type === "text");
    const content = allText ? t.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n\n") : t.parts;
    return { role: t.role, content };
  });
  return [{ role: "system", content: systemPromptFor(seat, settings, now) }, ...messages];
}

/** Does any message carry a PDF? */
export function hasFileParts(messages: ChatMessage[]): boolean {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "file"));
}

/**
 * The participant your message ends by naming, ignoring punctuation and case: "…what do you
 * think, Grok?" names Grok. The name must stand as its own word(s), and the longest match
 * wins, so "…ask Claude 2" names Claude 2, not Claude.
 */
export function addressedSeat(text: string, seats: Seat[]): Seat | undefined {
  const t = text.replace(/[^\p{L}\p{N}]+$/u, "").toLowerCase();
  let best: Seat | undefined;
  for (const s of seats) {
    const n = s.name.trim().toLowerCase();
    if (!n || !t.endsWith(n)) continue;
    if (/[\p{L}\p{N}]$/u.test(t.slice(0, t.length - n.length))) continue; // the end of a longer word
    if (!best || n.length > best.name.trim().length) best = s;
  }
  return best;
}

/**
 * Edit distance counting a swap of neighboring letters as one slip (the "optimal string
 * alignment" form of Damerau–Levenshtein): the number of typing slips between two words.
 */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

// Real English words one slip away from "team", which must not start a round
// ("…in the long term."). Found by checking every one-slip variant against a word list.
const NOT_TEAM = new Set(["term", "teams", "tea", "teas", "steam", "tear", "beam", "tram", "seam", "teal", "teak", "teat", "ream", "teem"]);

/** "team", or a slip of the keyboard away from it (but not another real word). */
function isTeam(word: string): boolean {
  return word === "team" || (!NOT_TEAM.has(word) && editDistance(word, "team") === 1);
}

/** "independently", allowing a few slips ("independantly", "indepentently"), but not "dependently". */
function isIndependently(word: string): boolean {
  return word.length >= 9 && word !== "dependently" && editDistance(word, "independently") <= 3;
}

// Real English words within two slips of "parallel", which must not be taken for it
// ("…draw some parallels, team"). Found by checking a word list, as for "team".
const NOT_PARALLEL = new Set([
  "parallels", "paralleled", "unparallel", "parallax", "parable", "parables", "parabled", "parafle", "parafles", "parelle", "parelles",
]);

/** "parallel", allowing two slips ("paralel", "paralell", "parralel"), but not another real word. */
function isParallel(word: string): boolean {
  return word.length >= 6 && !NOT_PARALLEL.has(word) && editDistance(word, "parallel") <= 2;
}

/** "privately", allowing one slip ("privatly", "privatley"); "private" doesn't count. */
function isPrivately(word: string): boolean {
  return word === "privately" || (word.length >= 8 && editDistance(word, "privately") === 1);
}

/** A word that asks for replies apart from one another: "independently", or "parallel" (its synonym). */
function isApart(word: string): boolean {
  return isIndependently(word) || isParallel(word);
}

/**
 * How "…, team" (or a list of names) asks for replies: each in turn, seeing the replies
 * before it; or each independently, all at once, without seeing the others' replies.
 */
export type TeamCall = "in turn" | "independently";

/**
 * Where "independently", "parallel" or "in parallel" begins, if it ends at word `k` of
 * `words` (lowercased words); -1 if word `k` is none of these.
 */
function apartFrom(words: string[], k: number): number {
  const w = words[k] ?? "";
  if (!isApart(w)) return -1;
  return isParallel(w) && words[k - 1] === "in" ? k - 1 : k;
}

/**
 * Does the message end by calling on the whole group? "…what do you think, team?" asks
 * every participant to reply in turn; "…independently, team" or "…team, independently"
 * asks each to reply without seeing the others' replies. "parallel" or "in parallel"
 * does the same as "independently" ("…in parallel, team", "…team, in parallel"). Case and
 * punctuation don't matter, and typing slips are forgiven.
 */
export function teamCall(text: string): TeamCall | undefined {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const n = words.length;
  if (n && isTeam(words[n - 1]!)) return apartFrom(words, n - 2) >= 0 ? "independently" : "in turn";
  const apart = apartFrom(words, n - 1);
  if (apart > 0 && isTeam(words[apart - 1]!)) return "independently";
  return undefined;
}

/** What Return should do with a message, read from its last words, and the message without them. */
export interface Addressing {
  /** The message as the participants should read it: without the words meant for Dialog. */
  text: string;
  /** The participants named at the end ("…, Grok?", "…, Claude and Grok?"), in the order named. */
  seats: Seat[];
  /** "…, team": everyone (awake). */
  everyone?: boolean;
  /** For several participants or everyone: in turn, or each without seeing the others' replies. */
  call?: TeamCall;
  /** "…privately" (or "…only", after names or "team") at the very end: private to whoever the message is for. */
  privately?: boolean;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Where the last word before `end` ends, skipping punctuation and spaces after it. */
function lastWordEnd(text: string, end = text.length): number {
  let i = end;
  while (i > 0 && !isWordChar(text[i - 1])) i--;
  return i;
}

/** The word ending exactly at `end`, lowercased, and where it starts. */
function wordEndingAt(text: string, end: number): { start: number; word: string } | undefined {
  const m = /[\p{L}\p{N}']+$/u.exec(text.slice(0, end));
  return m ? { start: end - m[0].length, word: m[0].toLowerCase() } : undefined;
}

/** Step back over what separates names in a list: spaces, commas, "&", "+", "/", "and". */
function skipSeparators(text: string, end: number): number {
  let i = end;
  for (;;) {
    const before = text.slice(0, i);
    const m = /[\s,;&+/]+$/u.exec(before) ?? (/and$/i.test(before) && !isWordChar(before[before.length - 4]) ? ["and"] : null);
    if (!m || !m[0].length) return i;
    i -= m[0].length;
  }
}

/** The longest participant name ending exactly at `end`, as whole word(s), and where it starts. */
function nameEndingAt(text: string, end: number, seats: Seat[]): { seat: Seat; start: number } | undefined {
  const lower = text.slice(0, end).toLowerCase();
  let best: { seat: Seat; start: number } | undefined;
  for (const s of seats) {
    const n = s.name.trim().toLowerCase();
    if (!n || !lower.endsWith(n)) continue;
    const start = end - n.length;
    if (isWordChar(lower[start - 1])) continue; // the end of a longer word
    if (!best || start < best.start) best = { seat: s, start };
  }
  return best;
}

/**
 * "independently", "parallel" or "in parallel" ending exactly at `end`: where it begins.
 * Undefined if the word ending there is none of these.
 */
function apartEndingAt(text: string, end: number): number | undefined {
  const w = wordEndingAt(text, end);
  if (!w || !isApart(w.word)) return undefined;
  if (isParallel(w.word)) {
    const gap = /\s+$/u.exec(text.slice(0, w.start));
    const before = gap ? wordEndingAt(text, w.start - gap[0].length) : undefined;
    if (before?.word === "in") return before.start; // "in parallel"
  }
  return w.start;
}

/**
 * Take the words meant for Dialog off the end of a message and say what they ask for:
 * - a participant's name ("…, Grok?"), or a list of them ("…, Claude, Grok and Gemini?",
 *   also with "&", "+" or "/"), optionally with "independently" (or "parallel", or "in
 *   parallel") just before or after;
 * - "team" (with or without "independently", "parallel" or "in parallel"): everyone.
 * The sentence's own end punctuation stays: "What do you think, Grok?" becomes "What do
 * you think?". With none of these, the text comes back unchanged and `seats` is empty.
 */
export function readAddress(text: string, seats: Seat[]): Addressing {
  const tail = lastWordEnd(text);
  // "…privately" as the very last word: whoever the message is for, it is private to them.
  // "…only" means the same, but only right after names or "team" ("…, Grok only"), since
  // "Answer in one sentence only" is ordinary English. The word comes off, and what comes
  // before it is read as usual.
  const lastWord = wordEndingAt(text, tail);
  const only = lastWord?.word === "only";
  const privately = lastWord !== undefined && (only || isPrivately(lastWord.word));
  const stop = privately ? lastWordEnd(text, lastWord.start) : tail;
  const finish = (cut: number, rest: Omit<Addressing, "text">): Addressing => {
    const before = text.slice(0, skipSeparators(text, cut)).replace(/[\s,;:–—-]+$/u, "");
    let after = text.slice(tail).trim();
    if (!before || /[.?!…]$/.test(before)) after = ""; // "Thoughts? Grok." → "Thoughts?"
    return { text: (before + after).trim(), ...rest, ...(privately ? { privately: true } : {}) };
  };

  // Names, read backwards from the end, after an optional "independently" or "(in) parallel".
  let end = stop;
  let independently = false;
  const trailing = apartEndingAt(text, end);
  if (trailing !== undefined) {
    independently = true;
    end = skipSeparators(text, trailing);
  }
  const found: Seat[] = [];
  let cut = end;
  for (let pos = end; ; ) {
    const n = nameEndingAt(text, pos, seats);
    if (!n) break;
    if (!found.includes(n.seat)) found.unshift(n.seat);
    cut = n.start;
    pos = skipSeparators(text, n.start);
  }
  if (found.length) {
    if (!independently) {
      const leading = apartEndingAt(text, skipSeparators(text, cut));
      if (leading !== undefined) {
        independently = true;
        cut = leading;
      }
    }
    return finish(cut, { seats: found, call: found.length > 1 ? (independently ? "independently" : "in turn") : undefined });
  }

  // "…, team", "…independently, team", "…team, independently", and the same with "(in) parallel".
  const call = teamCall(text.slice(0, stop));
  const last = call ? wordEndingAt(text, stop) : undefined;
  // No names and no "team": "…privately" alone is still private; "…only" alone is just a word.
  if (!call || !last) return privately && !only ? finish(lastWord.start, { seats: [] }) : { text, seats: [] };
  let first = last.start;
  if (isTeam(last.word)) {
    // "…independently, team": the word(s) before "team" come off too.
    const apart = call === "independently" ? apartEndingAt(text, skipSeparators(text, last.start)) : undefined;
    if (apart !== undefined) first = apart;
  } else {
    // "…team, independently": "team" comes before them.
    const apart = apartEndingAt(text, stop) ?? last.start;
    first = wordEndingAt(text, skipSeparators(text, apart))?.start ?? apart;
  }
  return finish(first, { seats: [], everyone: true, call });
}

/** "Claude", "Claude and Grok", "Claude, Grok and Gemini". */
function nameList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The addressee as a stage direction: "to Grok", "to Claude and Grok, in turn", "to
 * everyone, independently". For the models, the manner is spelled out.
 */
export function addresseeLabel(a: Addressee, seats: Seat[], forModels = false): string {
  const current = (id: string, name: string) => seats.find((s) => s.id === id)?.name ?? name;
  if ("seatId" in a) return `to ${current(a.seatId, a.name)}`;
  const who = "seats" in a ? nameList(a.seats.map((x) => current(x.id, x.name))) : "everyone";
  const how = "seats" in a ? a.how : a.everyone;
  if (how === "in turn") return forModels ? `to ${who}, each replying in turn` : `to ${who}, in turn`;
  return forModels ? `to ${who}, each replying without seeing the others' replies` : `to ${who}, independently`;
}

/** Remove a leading "Name says:" if a model adds one despite the house rules. */
export function stripSelfPrefix(text: string, name: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*(?:\\*\\*|__)?${esc}(?:\\s+says)?\\s*:\\s*(?:\\*\\*|__)?[ \\t]*\\n?`, "i");
  return text.replace(re, "");
}
