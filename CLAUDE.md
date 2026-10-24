# Dialog — notes for Claude

A single-page web app (TypeScript) published on GitHub Pages at
https://waarnett.github.io/Dialog/. Bill's general preferences live in his global
~/.claude/CLAUDE.md; this file only adds what is specific to this project.

## Layout

- `source/` holds everything that gets edited: `src/` (code, stylesheet, HTML template, images),
  `test/`, `build.mjs`, and `README.md` (the user guide).
- `index.html` and `README.html` at the top level are build output, committed so GitHub Pages
  can serve them. Never edit them by hand.
- There are two READMEs:
  - `source/README.md` is the user guide (becomes `README.html`). When a change is visible to
    users, update this one, written from the user's point of view.
  - `README.md` at the top level is the short repository overview (links, folder layout, how to
    build). Update it only when the layout or build steps change.

## Build, test, publish

Run from `source/`:

```sh
npm install          # first time, or after package.json changes
npm run build        # type-checks, then writes dist/index.html and dist/README.html
npm test             # needs a build first
npm run release      # publish: build, then copy dist/index.html and dist/README.html up to ..
```

`release` is defined in the `scripts` section of `source/package.json`. It does not run the
tests. After any code or guide change: test, then release, so the committed top-level pages
always match the source. The build and the tests must finish with no errors and no warnings.

Then commit (only when Bill asks). Pushing to `main` updates the live site within a minute or
two, so confirm with Bill before pushing.

Version numbers: `VERSION` in `source/src/main.ts` (shown on the welcome screen and in
Settings). The public only ever sees two numbers; between pushes there is a third, so Bill
sees a different version after every turn that changes the code.

- Every push gets a new two-number version (2.0 → 2.1 → 2.2 …). Bill says when to change the
  first number.
- Each turn that changes anything under `source/src/` (the code, stylesheet, HTML template or
  images; not the README, tests or build script) raises the third number by one, once per
  turn. The working version always leads to the next public one: if `VERSION` is still the
  two-number version on `origin/main` (`git show origin/main:source/src/main.ts`), the first
  change goes to the next second number with a third of 1 (on origin 2.2 → 2.3.1, 2.3.2 …).
- Before pushing, drop the third number (2.3.4 → 2.3), make sure the result is above the
  version on `origin/main`, then test, release and commit that before the push.

## Gotchas

- npm asks for each package's install script to be approved; the approvals are in
  `allowScripts` in `source/package.json`, pinned to exact versions, so upgrading such a
  package (currently only esbuild) needs the entry updated.
- `source/dist/`, `source/test/.compiled/` and `node_modules/` are git-ignored.
