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
