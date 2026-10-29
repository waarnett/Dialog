// Checks the built guide (dist/README.html), so run `npm run build` first: everything
// README.md says reaches the page as text. Markdown gives some characters a meaning of its
// own: a pair of "~" strikes the text between them out (and the "~" vanish), and a word in
// angle brackets, like "<name>", is taken for an HTML tag and vanishes. README.md writes
// them "\~" and "\<name\>" so they show as typed; these checks catch one that doesn't.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const md = readFileSync("README.md", "utf8");
const { window } = new JSDOM(readFileSync("dist/README.html", "utf8"));
const main = window.document.querySelector("main");

test("README.html: nothing is struck through, and every ~ shows", () => {
  assert.deepEqual([...main.querySelectorAll("del, s")].map((e) => e.textContent.slice(0, 60)), []);
  const tildes = (s) => (s.match(/~/g) ?? []).length;
  assert.equal(tildes(main.textContent), tildes(md));
});

test("README.html: no word in angle brackets is taken for an HTML tag", () => {
  const unknown = [...main.querySelectorAll("*")].filter((e) => e instanceof window.HTMLUnknownElement).map((e) => `<${e.localName}>`);
  assert.deepEqual(unknown, []);
  assert.match(main.textContent, /To: Privately: <name>/);
  assert.match(main.textContent, /Send privately to <name>/);
});

test("README.html: the contents list links to every top-level section", () => {
  const sections = [...main.querySelectorAll("h2")].map((h) => `#${h.id}`);
  const links = [...main.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href"));
  assert.deepEqual(links, sections);
});

test("README.html: the version under the name at the top, the same as the page's", () => {
  const version = /const VERSION = "([^"]+)"/.exec(readFileSync("src/main.ts", "utf8"))[1];
  assert.equal(window.document.querySelector("header .version").textContent, `Version ${version}`);
});
