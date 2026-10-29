# Dialog

A moderated group conversation between you and several AI models (Claude, ChatGPT, Gemini,
Grok, DeepSeek, or any other model OpenRouter offers), running as a single web page in your
browser. You decide who speaks next; every participant sees the same conversation, except for
private exchanges you have with one of them.

- **Use it:** <https://waarnett.github.io/Dialog/>
- **User guide:** <https://waarnett.github.io/Dialog/README.html>

To run it offline, download `index.html` and `README.html` into the same folder and open
`index.html` in Safari or Chrome.

## What's in this repository

| Path | What it is |
| --- | --- |
| `index.html` | The finished page, served by GitHub Pages. Built from `source/`. |
| `README.html` | The user guide, linked from the page's welcome screen. Built from `source/README.md`. |
| `source/src/` | The page's TypeScript code, stylesheet, HTML template and images. |
| `source/test/` | Unit tests and a simulated run of the whole page. |
| `source/README.md` | The user guide's text. |
| `source/build.mjs` | Packs everything into the two self-contained pages. |

## The source

TypeScript sources are in `source/src/`:

| File                       | What it does                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `types.ts`                 | The data: seats, entries, settings                                                                               |
| `engine.ts`                | The rules: each seat's view of the conversation, house rules, files the participants make, seat names and colors |
| `export.ts`                | Saving the whole conversation, or the ticked turns, as an HTML page                                              |
| `pretty.ts`                | The pretty-printer every HTML file goes through                                                                  |
| `openrouter.ts`            | Talking to OpenRouter: streaming replies, costs, citations, model list, key and credit                           |
| `lmstudio.ts`              | Talking to LM Studio: models running on this computer                                                            |
| `math.ts`                  | LaTeX in messages shown as mathematics (MathML, via Temml)                                                       |
| `storage.ts`               | Saving to and loading from the browser's storage                                                                 |
| `recent.ts`                | The last 25 conversations, kept in the browser's database for Restore…                                           |
| `attachments.ts`           | Reading dropped or picked files into attachments                                                                 |
| `makers.ts`                | Who made each model, and where its logo comes from                                                               |
| `main.ts`                  | The page: drawing everything and handling clicks                                                                 |
| `index.html`, `styles.css` | Page skeleton and appearance                                                                                     |
| `assets.d.ts`              | Type declarations for the files the build bundles as data                                                        |
| `icons/`                   | The Socrates engraving and the welcome picture, medallion and tab icon made from it                              |

The user guide is `source/README.md`; the build turns it into `README.html`, in Dialog's style.

`npm run build` writes `dist/index.html` and `dist/README.html`, both pretty-printed (every
element on its own line, indented, long lines broken near 100 characters); the build stops if
the pretty-printer changed what the page's script or styles do. `npm test` runs unit tests, a
simulated run of the whole page against a fake OpenRouter, and checks of `README.html`: that it
shows everything `README.md` says (Markdown would strike out text between two `~` and drop a
word in angle brackets, so `README.md` writes them `\~` and `\<name\>`), and that its contents
list links to every section.

## Building and publishing

Requires Node.js.

```sh
cd source
npm install          # first time only: downloads the libraries
npm run build        # type-checks, then writes dist/index.html and dist/README.html
npm test             # runs the tests (build first)
npm run release      # publish: builds, then replaces the pages at the top level
```

`npm run release` is a shortcut defined in the `scripts` section of `source/package.json`; it
runs `npm run build` and then `cp dist/index.html dist/README.html ..`.

Then commit and push; GitHub Pages updates the site within a minute or two.
