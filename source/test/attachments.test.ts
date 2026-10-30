// Attaching files, with the browser's File and FileReader taken from jsdom.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { defaultSettings, formatTime, turnStamp } from "../src/engine";
import { readAttachment } from "../src/attachments";
import { withConversationData } from "../src/storage";
import type { Entry } from "../src/types";

const { window } = new JSDOM("");
Object.assign(globalThis, { FileReader: window.FileReader });
const file = (text: string, name: string, type = "text/html") => new window.File([text], name, { type }) as unknown as File;
const never = () => assert.fail("no confirmation expected");

const T = "2026-10-07T22:03:00.000Z";
const settings = defaultSettings();
settings.humanName = "Bill";
settings.seats = [{ id: "A", name: "Claude", model: "anthropic/claude-opus-5.5", role: "", effort: "default", color: "#c96442" }];
const entries: Entry[] = [
  { id: "h1", speaker: "human", speakerName: "Bill", text: "What is time?", time: T },
  { id: "b1", speaker: "A", speakerName: "Claude", text: "Change.", time: T, status: "done", model: "anthropic/claude-opus-5.5" },
];
const page = `<!doctype html><html><head><style>body { color: red; }</style></head><body><header class="doc-head">Dialog</header></body></html>`;
// The first turn has the date with its time.
const transcript = `${turnStamp({ time: T })} Bill\nWhat is time?\n\n${formatTime(new Date(T))} Claude\nanthropic/claude-opus-5.5\nChange.`;

test("a conversation saved with Save All goes in as its turns in plain text", async () => {
  const saved = withConversationData(page, { startedAt: T, entries }, settings);
  const a = await readAttachment(file(saved, "Dialog 2026 Oct 07 2203 time.html"), never);
  assert.equal(a.name, "Dialog 2026 Oct 07 2203 time (transcript).txt");
  assert.equal(a.kind, "text");
  assert.equal(a.mime, "text/plain");
  assert.equal(a.data, transcript);
  assert.equal(a.size, new TextEncoder().encode(transcript).length);
  assert.equal(a.tokens, Math.round(transcript.length / 4));
});

test("Save Selected: just the turns chosen", async () => {
  const saved = withConversationData(page, { startedAt: T, entries }, settings, new Set(["b1"]));
  const a = await readAttachment(file(saved, "Dialog 2026 Oct 07 2203 selected.html"), never);
  assert.equal(a.data, `${turnStamp({ time: T })} Claude\nanthropic/claude-opus-5.5\nChange.`);
});

test("a saved conversation too large for a text file is still attached", async () => {
  const pictures = `<img src="data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}">`;
  const saved = withConversationData(page.replace("</header>", `</header>${pictures}`), { startedAt: T, entries }, settings);
  const a = await readAttachment(file(saved, "big.html"), never);
  assert.equal(a.data, transcript);
});

test("any other web page is attached as it is, or refused when too large", async () => {
  const a = await readAttachment(file(page, "page.html"), never);
  assert.equal(a.name, "page.html");
  assert.equal(a.data, page);
  assert.equal(a.mime, "text/html");
  await assert.rejects(readAttachment(file("x".repeat(3 * 1024 * 1024), "huge.html"), never), /huge\.html is too large/);
});
