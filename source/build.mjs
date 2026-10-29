// Builds Dialog into two self-contained files:
//   dist/index.html   the page itself
//   dist/README.html  the instructions (from README.md), linked from the page's welcome screen
//
// Steps:
//   1. esbuild translates the TypeScript in src/ to JavaScript and bundles it into one script.
//      The libraries it uses (marked, Temml, DOMPurify, js-beautify) go in minified, in a
//      script of their own that the pretty-printer leaves alone: they are large, and nobody
//      needs to read them. Temml's stylesheet goes in as text, and its font as a data: URL.
//   2. The script, the stylesheet and the images are pasted into src/index.html.
//   3. README.md is turned into a web page in the same style.
//   4. Both pages go through the HTML pretty-printer (src/pretty.ts), and a check confirms the
//      pretty-printing changed only the layout of the page's script and styles, not their meaning.
//
// Run with:  npm run build      (type-checks first, then builds)

import { build, transform } from "esbuild";
import { marked } from "marked";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";

// The libraries, minified, in a script of their own that sets `dialogLibraries` for the page's
// script to use. The markers tell the pretty-printer to leave it as it is.
const librariesBuild = await build({
  stdin: {
    contents: `import temml from "temml"; import { Marked } from "marked"; import DOMPurify from "dompurify"; import beautify from "js-beautify";
globalThis.dialogLibraries = { temml, Marked, DOMPurify, beautify };`,
    resolveDir: ".",
  },
  bundle: true,
  format: "iife",
  target: ["safari16"],
  minify: true,
  write: false,
  legalComments: "inline",
});
const librariesJs = `/* beautify ignore:start */\n${librariesBuild.outputFiles[0].text.trim()}\n/* beautify ignore:end */`;

/** What the page's script gets when it imports each library: the one that script sets. */
const FROM_LIBRARIES = {
  temml: "export default dialogLibraries.temml;",
  marked: "export const Marked = dialogLibraries.Marked;",
  dompurify: "export default dialogLibraries.DOMPurify;",
  "js-beautify": "export default dialogLibraries.beautify;",
};
const librariesFromPage = {
  name: "libraries-from-page",
  setup(b) {
    b.onResolve({ filter: /^(temml|marked|dompurify|js-beautify)$/ }, (args) => ({ path: args.path, namespace: "libraries-from-page" }));
    b.onLoad({ filter: /.*/, namespace: "libraries-from-page" }, (args) => ({ contents: FROM_LIBRARIES[args.path], loader: "js" }));
  },
};

const result = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: ["safari16"],
  minify: false, // keep it readable
  write: false,
  legalComments: "inline",
  loader: { ".css": "text", ".woff2": "dataurl" },
  plugins: [librariesFromPage],
});

const js = result.outputFiles[0].text;
const css = await readFile("src/styles.css", "utf8");
const template = await readFile("src/index.html", "utf8");

// The images (all from the Socrates engraving), embedded so the page stays a single file.
// Note: Safari ignores an embedded tab icon (a long-standing WebKit bug); Chrome shows it.
const dataUri = async (file) => "data:image/png;base64," + (await readFile(file)).toString("base64");
const images = {
  __FAVICON_SRC__: await dataUri("src/icons/favicon-64.png"),
  __MEDALLION_SRC__: await dataUri("src/icons/socrates-medallion.png"),
  __BUST_SRC__: await dataUri("src/icons/socrates-bust.png"),
};
const fillImages = (text) => {
  for (const [placeholder, uri] of Object.entries(images)) text = text.split(placeholder).join(uri);
  return text;
};

// Function replacements so "$" sequences in the code are not treated specially.
const page = fillImages(template)
  .replace("/*__STYLES__*/", () => css)
  .replace("/*__LIBRARIES__*/", () => librariesJs.replace(/<\/script/gi, "<\\/script"))
  .replace("/*__SCRIPT__*/", () => js.replace(/<\/script/gi, "<\\/script"));

// The pretty-printer, the same one the page uses for the files it saves.
const prettyModule = await build({ entryPoints: ["src/pretty.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { prettyHtml } = await import("data:text/javascript;base64," + Buffer.from(prettyModule.outputFiles[0].text).toString("base64"));

/** The contents of every <tag>…</tag> in a page. */
const blocks = (html, tag) => [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1]);

/** Minified, so two versions that differ only in layout come out identical. */
const minified = async (code, loader) => (await transform(code, { loader, minify: true })).code;

/** Stop the build if pretty-printing changed what the page's script or styles do. */
async function checkSameMeaning(before, after, name) {
  for (const [tag, loader] of [["script", "js"], ["style", "css"]]) {
    // (Styles are looked for outside the scripts: the script itself writes <style> into saved files.)
    const outside = (html) => (tag === "style" ? html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") : html);
    const a = blocks(outside(before), tag);
    const b = blocks(outside(after), tag);
    if (a.length !== b.length) throw new Error(`${name}: pretty-printing changed the number of <${tag}> blocks`);
    for (let i = 0; i < a.length; i++) {
      if ((await minified(a[i], loader)) !== (await minified(b[i], loader))) {
        throw new Error(`${name}: pretty-printing changed the meaning of <${tag}> block ${i + 1}`);
      }
    }
  }
}

const html = prettyHtml(page);
await checkSameMeaning(page, html, "index.html");

// README.html: the README in Dialog's style, with a link back to the page.
const readmeCss = `
:root {
  --paper: #edeeea; --panel: #f8f8f5; --ink: #1e1d1b; --muted: #6a6c67; --line: #d3d5cf; --accent: #4d6630;
  --font-ui: Optima, "Optima Nova", Candara, "Segoe UI", "Gill Sans", sans-serif;
  --font-text: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #181917; --panel: #20211f; --ink: #e7e5df; --muted: #9c9d97; --line: #363833; --accent: #a7bd7c; }
}
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--font-text); font-size: 1.0625rem; line-height: 1.6; }
header { display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 1.25rem; border-bottom: 1px solid var(--line); background: var(--panel); font-family: var(--font-ui); }
header img { width: 40px; height: 40px; border-radius: 50%; box-shadow: 0 0 0 1px var(--line); }
header .wordmark { font-size: 1.5rem; letter-spacing: 0.02em; line-height: 1; }
header .brand-name { display: flex; flex-direction: column; }
header .version { font-size: 0.72rem; color: var(--muted); margin-top: 0.2rem; font-variant-numeric: tabular-nums; }
header .back { margin-left: auto; color: var(--accent); }
main { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1.5rem 4rem; }
h1, h2, h3, h4 { font-family: var(--font-ui); font-weight: 600; line-height: 1.25; }
h1 { font-weight: 400; font-size: 2.2rem; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.45rem; margin: 2.2rem 0 0.6rem; padding-top: 1rem; border-top: 1px solid var(--line); }
h3 { font-size: 1.15rem; margin: 1.6rem 0 0.4rem; }
a { color: inherit; text-decoration-color: var(--accent); text-underline-offset: 2px; }
li { margin: 0.25rem 0; }
code { font-family: ui-monospace, Menlo, monospace; font-size: 0.85em; background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 0 0.25em; }
pre { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 0.6rem 0.8rem; }
pre code { border: none; padding: 0; }
table { border-collapse: collapse; font-size: 0.95em; margin: 0.8rem 0; }
th, td { border: 1px solid var(--line); padding: 0.3rem 0.6rem; text-align: left; vertical-align: top; }
th { font-family: var(--font-ui); background: var(--panel); }
`;
// Each heading gets an id made the way GitHub makes them, so the guide's contents links
// work in README.html and on GitHub alike.
marked.use({
  renderer: {
    heading({ tokens, depth, text }) {
      const id = text.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");
      return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});
// The version, as the page shows it under its name.
const version = /const VERSION = "([^"]+)"/.exec(await readFile("src/main.ts", "utf8"))?.[1];
if (!version) throw new Error("build: no VERSION in src/main.ts");
const readmeBody = marked.parse(await readFile("README.md", "utf8"), { gfm: true });
const readme = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dialog: README</title>
<link rel="icon" type="image/png" sizes="64x64" href="${images.__FAVICON_SRC__}">
<style>${readmeCss}</style>
</head>
<body>
<header><img src="${images.__MEDALLION_SRC__}" alt=""><span class="brand-name"><span class="wordmark">Dialog</span><span class="version">Version ${version}</span></span><a class="back" href="index.html">Open Dialog</a></header>
<main>
${readmeBody}
</main>
</body>
</html>
`;
const readmeHtml = prettyHtml(readme);
await checkSameMeaning(readme, readmeHtml, "README.html");

await mkdir("dist", { recursive: true });
await rm("dist/dialog.html", { force: true }); // the page's name before 2026 Oct 11
await writeFile("dist/index.html", html);
await writeFile("dist/README.html", readmeHtml);
console.log(`Built dist/index.html (${(html.length / 1024).toFixed(0)} KB) and dist/README.html (${(readmeHtml.length / 1024).toFixed(0)} KB)`);
