// Saving as HTML: the whole conversation, or just the turns you've ticked, as a
// self-contained page styled like Dialog itself (no scripts; pictures embedded). Replies
// are written in Markdown; the caller supplies the function that turns that into safe HTML.

import {
  addresseeLabel,
  describeAttachment,
  describeMadeFile,
  formatCost,
  formatDate,
  formatTime,
  isSettled,
  privateLabel,
  turnDetails,
  speedDetails,
  speedLabel,
  thinkingLabel,
  totalCost,
  turnSpeed,
} from "./engine";
import { MATH_CSS } from "./math";
import type { ModelInfo } from "./openrouter";
import type { Attachment, Entry, Session, Settings } from "./types";

export interface ExportOptions {
  /** OpenRouter's model list, to name each seat's thinking level. */
  models?: ModelInfo[];
  savedAt?: Date;
  /** Turns Markdown into safe HTML. `keepLineBreaks` is used for the human's entries. */
  render: (markdown: string, keepLineBreaks: boolean) => string;
  /** The Socrates medallion (a data: URL) for the heading; omitted if absent. */
  logo?: string;
  /** Save only these turns (by id), and list only the participants who speak in them. */
  only?: ReadonlySet<string>;
  /**
   * Replies (by id) whose full particulars are open on screen: saved with those particulars
   * (model, thinking, token counts, speed) in place of the short cost and speed.
   */
  details?: ReadonlySet<string>;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
const esc = escapeHtml;

/** "Dialog 2026 Oct 07 2205.html", or "Dialog 2026 Oct 07 2205 selected.html" for chosen turns. */
export function conversationFileName(savedAt = new Date(), selected = false): string {
  return `Dialog ${formatDate(savedAt)} ${formatTime(savedAt).replace(":", "")}${selected ? " selected" : ""}.html`;
}

// Words whose full stop doesn't end a sentence.
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "cf", "ca", "approx", "dr", "mr", "mrs", "ms", "prof", "st", "jr", "sr", "no"]);

/**
 * The first sentence of some prose, or its first line if that ends sooner; `more` says
 * whether anything was left off. Full stops after abbreviations ("e.g.", "Dr.", "Ph.D.")
 * and initials ("J. Smith") don't count, nor does one followed by a lowercase word.
 */
export function firstSentence(text: string): { sentence: string; more: boolean } {
  const t = text.trim();
  const newline = t.indexOf("\n");
  const firstLine = newline === -1 ? t : t.slice(0, newline).trim();
  const ends = /[.!?]+["'\u201d\u2019)\]]*(?=\s|$)/g;
  for (let m = ends.exec(firstLine); m; m = ends.exec(firstLine)) {
    const end = m.index + m[0].length;
    const next = firstLine.slice(end).trimStart().charAt(0);
    if (!next) break; // the line ends here
    const word = /[\p{L}.]+$/u.exec(firstLine.slice(0, m.index))?.[0] ?? "";
    const abbreviation = ABBREVIATIONS.has(word.toLowerCase()) || /^\p{L}$/u.test(word) || word.includes(".");
    if ((m[0].startsWith(".") && abbreviation) || /\p{Ll}/u.test(next)) continue;
    return { sentence: firstLine.slice(0, end), more: true };
  }
  return { sentence: firstLine, more: firstLine !== t };
}

// ---------------------------------------------------------------------------
// Pieces

function seatColor(e: Entry, settings: Settings): string | undefined {
  return e.speaker === "human" ? undefined : settings.seats.find((s) => s.id === e.speaker)?.color;
}

/**
 * "(privately, to Grok)" for a private exchange; "(to Grok)" or "(to everyone, in turn)" for
 * a message addressed by its last words; "(answering independently)" in an independent round.
 */
function direction(e: Entry, settings: Settings): string {
  const privately = privateLabel(e, settings.seats, settings.humanName);
  if (privately) return `(${privately})`;
  if (e.addressedTo) return `(${addresseeLabel(e.addressedTo, settings.seats)})`;
  return e.independent ? "(answering independently)" : "";
}

/**
 * The model and thinking level behind a reply, when the Participants list wouldn't tell the
 * reader: the seat has since changed either one, or has been removed.
 */
function modelNote(e: Entry, settings: Settings, models: ModelInfo[] | undefined): string {
  if (e.speaker === "human") return "";
  const seat = settings.seats.find((s) => s.id === e.speaker);
  const used = e.seatModel ?? e.model;
  const modelChanged = e.seatModel !== undefined && seat?.model !== e.seatModel;
  const effortChanged = e.seatEffort !== undefined && seat?.effort !== e.seatEffort;
  if (!used || (seat && !modelChanged && !effortChanged)) return "";
  const thinking = e.seatEffort === undefined ? "" : `thinking: ${thinkingLabel({ effort: e.seatEffort }, models?.find((m) => m.id === used))}`;
  return [used, thinking].filter(Boolean).join(", ");
}

function filesHtml(files: Attachment[]): string {
  if (!files.length) return "";
  const items = files.map((a) => {
    const label = esc(describeAttachment(a));
    if (!a.data) return `<p class="file">${label} <span class="gone">no longer available</span></p>`;
    if (a.kind === "image") {
      return `<figure class="file"><img src="${esc(a.data)}" alt="${esc(a.name)}"><figcaption>${label}</figcaption></figure>`;
    }
    if (a.kind === "text") {
      return `<details class="file"><summary>${label}</summary><pre>${esc(a.data)}</pre></details>`;
    }
    return `<p class="file">${label}</p>`;
  });
  return `<div class="files"><p class="files-label">Attached</p>${items.join("")}</div>`;
}

/** The files a participant made in a turn: drawings shown, every file's contents in a section you click to open. */
function madeHtml(e: Entry): string {
  const files = e.made ?? [];
  if (!files.length) return "";
  const items = files.map((f) => {
    const label = esc(describeMadeFile(f));
    if (f.removed) return `<p class="file">${label} <span class="gone">removed</span></p>`;
    if (f.data === undefined) return `<p class="file">${label} <span class="gone">no longer available</span></p>`;
    const picture =
      f.kind === "svg" ? `<figure class="file"><img src="${esc("data:image/svg+xml;charset=utf-8," + encodeURIComponent(f.data))}" alt="${esc(f.name)}"></figure>` : "";
    const note = f.incomplete ? " (may be incomplete)" : "";
    return `${picture}<details class="file"><summary>${label}${note}</summary><pre>${esc(f.data)}</pre></details>`;
  });
  return `<div class="files"><p class="files-label">Files made</p>${items.join("")}</div>`;
}

function sourcesHtml(e: Entry): string {
  const links = (e.citations ?? []).filter((c) => /^https?:\/\//i.test(c.url));
  if (!links.length) return "";
  const lis = links.map((c) => `<li><a href="${esc(c.url)}">${esc(c.title || c.url)}</a></li>`).join("");
  return `<div class="sources">Sources:<ul>${lis}</ul></div>`;
}

/** A reply's cost and speed: two lines in the margin, under its name, as on screen. */
function glanceHtml(e: Entry): string {
  const lines: string[] = [];
  if (e.cost !== undefined) lines.push(`<span>${formatCost(e.cost)}</span>`);
  const speed = turnSpeed(e);
  if (speed) lines.push(`<span title="${esc(speedDetails(e, speed))}">${speedLabel(speed)}</span>`);
  return lines.length ? `<span class="glance">${lines.join("")}</span>` : "";
}

/** After the text: the full particulars if they were open on screen, or else whether the reply was cut short. */
function footHtml(e: Entry, opts: ExportOptions): string {
  if (opts.details?.has(e.id)) {
    const lines = turnDetails(e, opts.models);
    if (lines.length) return `<div class="foot details">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
  }
  return e.status === "stopped" ? `<div class="foot"><span>stopped early</span></div>` : "";
}

/** One turn, set like the page: name in the margin, speech beside it. */
function turnHtml(e: Entry, settings: Settings, opts: ExportOptions, showTime: boolean): string {
  const isHuman = e.speaker === "human";
  const color = seatColor(e, settings);
  const cls = ["turn", isHuman ? "human" : "bot", e.privateWith ? "private" : "", e.status === "stopped" ? "stopped" : ""]
    .filter(Boolean)
    .join(" ");
  const dir = direction(e, settings);
  const model = modelNote(e, settings, opts.models);
  const body = e.text.trim() ? `<div class="body">${opts.render(e.text, isHuman)}</div>` : "";
  return [
    `<article class="${cls}"${color ? ` style="--seat-color: ${esc(color)}"` : ""}>`,
    `<div class="who">`,
    showTime ? `<span class="time">${formatTime(new Date(e.time))}</span>` : "",
    `<span class="name">${esc(e.speakerName)}</span>`,
    dir ? `<span class="direction">${esc(dir)}</span>` : "",
    model ? `<span class="model">${esc(model)}</span>` : "",
    glanceHtml(e),
    `</div>`,
    `<div class="speech">${body}${filesHtml(e.attachments ?? [])}${madeHtml(e)}${sourcesHtml(e)}${footHtml(e, opts)}</div>`,
    `</article>`,
  ].join("");
}

function page(title: string, inner: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style>${EXPORT_CSS}${inner.includes("<math") ? "\n" + MATH_CSS : ""}</style>`,
    "</head>",
    `<body><main>${inner}</main></body>`,
    "</html>",
    "",
  ].join("\n");
}

function heading(title: string, lines: string[], opts: ExportOptions): string {
  const logo = opts.logo ? `<img class="medallion" src="${esc(opts.logo)}" alt="">` : "";
  const sub = lines.map((l) => `<p>${l}</p>`).join("");
  return `<header class="doc-head">${logo}<div><h1>${title}</h1>${sub}</div></header>`;
}

const when = (d: Date) => `${formatDate(d)} at ${formatTime(d)}`;

// ---------------------------------------------------------------------------
// The two kinds of file

/**
 * The conversation as a page: participants and settings, then the turns. Normally every
 * turn and every seat; with `opts.only`, just those turns and the people who speak in them.
 * Failed replies are always left out. Of "About you", only the first sentence is shown.
 */
export function conversationHtml(session: Session, settings: Settings, opts: ExportOptions): string {
  const savedAt = opts.savedAt ?? new Date();
  const started = new Date(session.startedAt);
  const only = opts.only && opts.only.size ? opts.only : undefined;

  const entries = session.entries.filter((e) => isSettled(e) && (!only || only.has(e.id)));
  const speakers = new Set(entries.map((e) => e.speaker));
  const seats = only ? settings.seats.filter((s) => speakers.has(s.id)) : settings.seats;
  const showHuman = !only || speakers.has("human");
  const about = firstSentence(settings.aboutHuman);

  const people: string[] = [];
  const notes = [
    "Models, settings and roles are as of the time of saving; a reply given with a different model or thinking level is marked with the one it used.",
    "Participants could search the web and read web pages unless noted.",
  ];
  if (showHuman) {
    people.push(
      `<li><span class="name">${esc(settings.humanName)}</span>, human moderator` +
        (about.sentence ? `<blockquote>${opts.render(about.sentence, true)}</blockquote>` : "") +
        `</li>`,
    );
    if (about.sentence) {
      const who = esc(settings.humanName);
      notes.push(`Quoted under ${who}: ${about.more ? "the first sentence of " : ""}what every participant was told about ${who}.`);
    }
  }
  for (const s of seats) {
    const m = opts.models?.find((x) => x.id === s.model);
    const facts = [`<code>${esc(s.model)}</code>`, `thinking: ${esc(thinkingLabel(s, m))}`];
    if (m?.tools === false) facts.push("no web search or page reading");
    const role = s.role.trim() ? `<blockquote>${opts.render(s.role, true)}</blockquote>` : "";
    people.push(
      `<li style="--seat-color: ${esc(s.color)}"><span class="name">${esc(s.name)}</span>, ${facts.join(", ")}${role}</li>`,
    );
  }
  if (seats.some((s) => s.role.trim())) notes.push("Quoted under a participant: its role.");

  const turns = entries.map((e) => turnHtml(e, settings, opts, false));
  const n = entries.length;
  const dates = only
    ? `${n} ${n === 1 ? "turn" : "turns"} chosen from a conversation started ${when(started)}. Saved ${when(savedAt)}.`
    : `Started ${when(started)}. Saved ${when(savedAt)}.`;
  const cost = only
    ? `Reported cost of these turns: ${formatCost(totalCost(entries))}`
    : `Total reported cost: ${formatCost(totalCost(session.entries))}`;

  const inner = [
    heading("Dialog", [dates], opts),
    `<section class="participants"><h2>Participants</h2><ul>${people.join("")}</ul>`,
    `<p class="note">${notes.join(" ")}</p></section>`,
    `<section class="conversation"><h2>Conversation</h2>${turns.join("")}</section>`,
    `<footer>${cost}, as reported by OpenRouter, before its fee on credit purchases.</footer>`,
  ].join("");
  return page(`Dialog, ${formatDate(started)}${only ? " (selected turns)" : ""}`, inner);
}

// ---------------------------------------------------------------------------
// Copying turns, for pasting into an email

/** What of one turn a copy took: the turn, and the parts of it that were selected. */
export interface CopiedTurn {
  entry: Entry;
  /** The selected part of its text, as HTML and as plain text ("" if none of it). */
  html: string;
  text: string;
  /** The selected part of its thinking, as HTML, when the thinking was open and selected. */
  thinking?: string;
  sources: boolean;
  files: boolean;
  made: boolean;
}

// The page's colors and type, written into every element: mail programs drop style sheets.
const INK = "#1e1d1b";
const MUTED = "#6a6c67";
const LINE = "#d3d5cf";
const PANEL = "#f8f8f5";
const ASIDE = "#f2e8cb";
const ASIDE_LINE = "#c2a04a";
const FONT_UI = `Optima, 'Optima Nova', Candara, 'Segoe UI', 'Gill Sans', sans-serif`;
const FONT_TEXT = `'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif`;

/** `a` mixed with `b`, `share` of it `a` (as CSS's color-mix, which mail programs don't know). */
function mix(a: string, b: string, share: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  if (![a, b].every((c) => /^#[0-9a-f]{6}$/i.test(c))) return a;
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(v * share + y[i]! * (1 - share)).toString(16).padStart(2, "0")).join("");
}

// The tags of a reply's text that need more than the mail program's defaults to look as on screen.
const TEXT_STYLES: Record<string, string> = {
  p: "margin: 0 0 0.8em;",
  pre: `background: ${PANEL}; border: 1px solid ${LINE}; padding: 0.6em 0.8em; border-radius: 6px; font-size: 0.85em; white-space: pre-wrap;`,
  code: "font-family: ui-monospace, Menlo, monospace; font-size: 0.88em;",
  table: "border-collapse: collapse;",
  th: `border: 1px solid ${LINE}; padding: 0.25em 0.55em;`,
  td: `border: 1px solid ${LINE}; padding: 0.25em 0.55em;`,
  blockquote: `margin: 0 0 0.8em; padding-left: 0.9em; border-left: 2px solid ${LINE}; color: ${MUTED};`,
  h1: `font-family: ${FONT_UI}; font-size: 1.2em; margin: 1.2em 0 0.4em;`,
  h2: `font-family: ${FONT_UI}; font-size: 1.1em; margin: 1.2em 0 0.4em;`,
  h3: `font-family: ${FONT_UI}; font-size: 1em; margin: 1.2em 0 0.4em;`,
  h4: `font-family: ${FONT_UI}; font-size: 1em; margin: 1.2em 0 0.4em;`,
};

/** A reply's text (sanitized HTML) with those styles written into its tags. */
function styleText(html: string): string {
  return html.replace(/<(p|pre|code|table|th|td|blockquote|h[1-4])(?=[\s>])/g, (_, tag: string) => `<${tag} style="${TEXT_STYLES[tag]}"`);
}

/**
 * The copied turns as HTML that pastes into an email looking as on screen: a table with each
 * turn's time, name, direction and model in the margin and what was selected of it beside.
 * No cost, speed or other particulars, and none of the page's buttons or tick boxes.
 */
export function copiedHtml(turns: CopiedTurn[], settings: Settings): string {
  const small = `font-family: ${FONT_UI}; font-size: 0.85em; color: ${MUTED};`;
  const rows = turns.map((t) => {
    const e = t.entry;
    const seat = seatColor(e, settings);
    const nameColor = seat ? mix(seat, INK, 0.78) : INK;
    const rule = e.privateWith ? ASIDE_LINE : seat ? mix(seat, "#ffffff", 0.45) : mix(INK, "#ffffff", 0.22);
    const dir = direction(e, settings);
    const model = e.speaker === "human" ? "" : (e.model ?? e.seatModel ?? "");
    const margin = [
      `<div style="font-size: 0.85em; color: ${MUTED};">${formatTime(new Date(e.time))}</div>`,
      `<div style="font-weight: 600; color: ${nameColor};">${esc(e.speakerName)}</div>`,
      dir ? `<div style="font-family: ${FONT_TEXT}; font-style: italic; font-size: 0.9em; color: ${MUTED};">${esc(dir)}</div>` : "",
      // A long model id wraps only after its maker ("anthropic/" above "claude-opus-5.5"), never mid-name.
      model ? `<div style="font-size: 0.8em; color: ${MUTED};">${esc(model).replace(/^([^/]*\/)?(.*)$/, '$1<wbr><span style="white-space: nowrap;">$2</span>')}</div>` : "",
    ].join("");

    const parts: string[] = [];
    if (t.thinking) parts.push(`<div style="${small} margin-bottom: 0.4em;"><div>Thinking</div>${styleText(t.thinking)}</div>`);
    if (t.html) parts.push(`<div style="padding-left: 1em; border-left: 2px solid ${rule};">${styleText(t.html)}</div>`);
    const files = t.files ? (e.attachments ?? []) : [];
    if (files.length) {
      const items = files.map((a) => {
        const picture = a.kind === "image" && a.data ? `<img src="${esc(a.data)}" alt="${esc(a.name)}" style="display: block; max-width: 320px; max-height: 256px;">` : "";
        return `<div>${picture}${esc(describeAttachment(a))}${a.data ? "" : " (no longer available)"}</div>`;
      });
      parts.push(`<div style="${small} margin-top: 0.5em; padding-left: 1em;">Attached${items.join("")}</div>`);
    }
    const made = t.made ? (e.made ?? []) : [];
    if (made.length) {
      const items = made.map((f) => {
        const gone = f.removed || f.data === undefined;
        const picture =
          f.kind === "svg" && !gone
            ? `<img src="${esc("data:image/svg+xml;charset=utf-8," + encodeURIComponent(f.data!))}" alt="${esc(f.name)}" style="display: block; max-width: 320px; max-height: 256px;">`
            : "";
        return `<div>${picture}${esc(describeMadeFile(f))}${f.removed ? " (removed)" : gone ? " (no longer available)" : ""}</div>`;
      });
      parts.push(`<div style="${small} margin-top: 0.5em; padding-left: 1em;">Files made${items.join("")}</div>`);
    }
    const links = t.sources ? (e.citations ?? []).filter((c) => /^https?:\/\//i.test(c.url)) : [];
    if (links.length) {
      const lis = links.map((c) => `<li><a href="${esc(c.url)}" style="color: inherit;">${esc(c.title || c.url)}</a></li>`).join("");
      parts.push(`<div style="${small} margin-top: 0.5em; padding-left: 1em;">Sources:<ul style="margin: 0.15em 0 0; padding-left: 1.1em;">${lis}</ul></div>`);
    }

    const tint = e.privateWith ? ` style="background: ${ASIDE};"` : "";
    return (
      `<tr${tint}>` +
      `<td style="width: 8.5em; padding: 0.4em 1.25em 1.2em 0.4em; vertical-align: top; text-align: right; font-family: ${FONT_UI}; line-height: 1.3;">${margin}</td>` +
      `<td style="padding: 0.4em 0.4em 1.2em 0; vertical-align: top; font-family: ${FONT_TEXT}; font-size: 1.0625em; line-height: 1.55;">${parts.join("")}</td>` +
      `</tr>`
    );
  });
  return `<table style="border-collapse: collapse; color: ${INK};">${rows.join("")}</table>`;
}

/** The copied turns as plain text, for places that don't take HTML: a heading line for each turn, then its text. */
export function copiedText(turns: CopiedTurn[], settings: Settings): string {
  return turns
    .map((t) => {
      const e = t.entry;
      const model = e.speaker === "human" ? "" : (e.model ?? e.seatModel ?? "");
      const head = [formatTime(new Date(e.time)), e.speakerName, direction(e, settings)].filter(Boolean).join(" ");
      return [head, model, t.text.trim().replace(/\n{3,}/g, "\n\n")].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Appearance (a compact version of Dialog's own)

const EXPORT_CSS = `
:root {
  --paper: #edeeea; --panel: #f8f8f5; --ink: #1e1d1b; --muted: #6a6c67; --line: #d3d5cf;
  --aside: #f2e8cb; --aside-line: #c2a04a;
  --font-ui: Optima, "Optima Nova", Candara, "Segoe UI", "Gill Sans", sans-serif;
  --font-text: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #181917; --panel: #20211f; --ink: #e7e5df; --muted: #9c9d97; --line: #363833; --aside: #2d2919; --aside-line: #9c8240; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--font-text); line-height: 1.62; -webkit-font-smoothing: antialiased; }
main { max-width: 58rem; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
h1, h2, .name, .participants li, .time, .direction, .model, .glance, .foot, .files-label, .note, footer { font-family: var(--font-ui); }
.doc-head { display: flex; align-items: center; gap: 1rem; margin-bottom: 2.25rem; }
.doc-head h1 { font-weight: 400; font-size: 2.2rem; margin: 0; line-height: 1.1; }
.doc-head p { margin: 0.2rem 0 0; color: var(--muted); font-family: var(--font-ui); font-size: 0.95rem; }
.medallion { width: 64px; height: 64px; border-radius: 50%; box-shadow: 0 0 0 1px var(--line); }
h2 { font-weight: 400; font-size: 1.35rem; margin: 2rem 0 1rem; }
.participants ul { list-style: none; padding: 0; margin: 0; }
.participants li { margin: 0 0 0.6rem; font-size: 0.95rem; }
.participants li .name { font-weight: 600; color: color-mix(in srgb, var(--seat-color, var(--ink)) 78%, var(--ink)); }
.participants blockquote { margin: 0.25rem 0 0 1rem; padding-left: 0.8rem; border-left: 2px solid var(--line); font-family: var(--font-text); color: var(--muted); }
.participants blockquote > :first-child { margin-top: 0; } .participants blockquote > :last-child { margin-bottom: 0; }
code { font-family: ui-monospace, Menlo, monospace; font-size: 0.86em; }
.note { color: var(--muted); font-size: 0.82rem; }
.turn {
  display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); column-gap: 1.25rem; margin: 0 0 1.75rem;
  --seat-color: var(--ink); --name-color: color-mix(in srgb, var(--seat-color) 78%, var(--ink));
}
.who { display: flex; flex-direction: column; align-items: flex-end; text-align: right; padding-top: 0.1rem; }
.who .time { font-size: 0.72rem; color: var(--muted); }
.who .name { font-weight: 600; color: var(--name-color); line-height: 1.3; overflow-wrap: anywhere; }
.who .direction { font-family: var(--font-text); font-style: italic; font-size: 0.85rem; color: var(--muted); line-height: 1.3; }
.who .model { font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
.who .glance { display: flex; flex-direction: column; align-items: flex-end; margin-top: 0.3rem; font-size: 0.72rem; line-height: 1.35; color: var(--muted); font-variant-numeric: tabular-nums; }
.speech { min-width: 0; }
.body { font-size: 1.0625rem; padding-left: 1.1rem; border-left: 2px solid color-mix(in srgb, var(--seat-color) 45%, transparent); overflow-wrap: anywhere; }
.human .body { border-left-color: color-mix(in srgb, var(--ink) 22%, transparent); }
.body > :first-child { margin-top: 0; } .body > :last-child { margin-bottom: 0; }
.body p { margin: 0 0 0.8em; }
.body h1, .body h2, .body h3, .body h4 { font-family: var(--font-ui); font-weight: 600; line-height: 1.3; margin: 1.2em 0 0.4em; font-size: 1.1rem; }
.body pre, .file pre { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); padding: 0.6rem 0.8rem; border-radius: 6px; font-size: 0.85rem; }
.body table { border-collapse: collapse; } .body th, .body td { border: 1px solid var(--line); padding: 0.25rem 0.55rem; }
.body blockquote { margin-left: 0; padding-left: 0.9rem; border-left: 2px solid var(--line); color: var(--muted); }
.body a, .sources a { color: inherit; }
.body math[display="block"] { overflow-x: auto; overflow-y: hidden; padding: 0.15em 0; }
.body .math-error { color: #a3261b; }
.private { background: var(--aside); box-shadow: 0 0 0 0.6rem var(--aside); border-radius: 2px; }
.private .body { border-left-color: var(--aside-line); }
.files { padding-left: 1.2rem; margin-top: 0.5rem; font-size: 0.85rem; color: var(--muted); }
.files-label { margin: 0 0 0.2rem; font-size: 0.72rem; }
.file { margin: 0 0 0.5rem; }
.file img { display: block; max-width: min(100%, 20rem); max-height: 16rem; border-radius: 4px; border: 1px solid var(--line); }
.file figcaption { margin-top: 0.2rem; }
figure.file { margin: 0 0 0.6rem; }
details.file summary { cursor: pointer; }
.gone { color: #a3261b; }
.sources { padding-left: 1.2rem; margin-top: 0.5rem; font-size: 0.85rem; color: var(--muted); }
.sources ul { margin: 0.15rem 0 0; padding-left: 1.1rem; }
.foot { display: flex; gap: 1rem; justify-content: flex-end; font-size: 0.78rem; color: var(--muted); margin-top: 0.35rem; }
.foot.details { display: block; margin-top: 0.45rem; padding: 0.45rem 0.7rem; font-size: 0.82rem; line-height: 1.5; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; }
.foot.details p { margin: 0; }
footer { margin-top: 2.5rem; color: var(--muted); font-size: 0.85rem; border-top: 1px solid var(--line); padding-top: 0.8rem; }
@media (max-width: 640px) {
  .turn { grid-template-columns: 1fr; }
  .who { flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; text-align: left; }
  .who .glance { flex-direction: row; gap: 0.6rem; margin-top: 0; }
}
@media print {
  body { background: #fff; }
  .private { box-shadow: none; background: none; border-left: 3px solid var(--aside-line); padding-left: 0.5rem; }
  details.file[open] summary, details.file summary { list-style: none; }
}
`.trim();
