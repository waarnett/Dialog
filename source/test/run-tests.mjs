// Compiles the TypeScript tests with esbuild and runs them with Node's built-in test runner.
// The page test (page.test.mjs) loads the built dist/index.html, so run `npm run build` first.

import { build } from "esbuild";
import { readdir, rm, mkdir, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const out = "test/.compiled";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const files = (await readdir("test")).filter((f) => f.endsWith(".test.ts"));
await build({
  entryPoints: files.map((f) => `test/${f}`),
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: out,
  outExtension: { ".js": ".mjs" },
  external: ["jsdom"],
  logLevel: "warning",
});
for (const f of (await readdir("test")).filter((f) => f.endsWith(".test.mjs"))) {
  await copyFile(`test/${f}`, `${out}/${f}`);
}

const tests = (await readdir(out)).filter((f) => f.endsWith(".mjs")).map((f) => `${out}/${f}`);
const r = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
process.exit(r.status ?? 1);
