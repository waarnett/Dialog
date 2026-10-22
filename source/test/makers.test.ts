import { test } from "node:test";
import assert from "node:assert/strict";
import { makerOf, MAKER_LOGOS } from "../src/makers";

test("a model's maker and logo come from its id; OpenRouter's name supplies the maker's name", () => {
  const claude = makerOf("anthropic/claude-opus-5.5", "Anthropic: Claude Opus 5.5");
  assert.deepEqual(claude, { slug: "anthropic", name: "Anthropic", logo: "https://openrouter.ai/images/icons/Anthropic.svg", initial: "A" });
  assert.equal(makerOf("~google/gemini-pro-latest").logo, "https://openrouter.ai/images/icons/GoogleGemini.svg", "a ~latest id too");
  const grok = makerOf("x-ai/grok-4.7", "SpaceXAI: Grok 4.7");
  assert.equal(grok.name, "SpaceXAI");
  assert.equal(grok.logo, "https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://x.ai/&size=64");
  assert.equal(makerOf("meta-llama/llama-4-maverick").logo, makerOf("meta/muse-spark-1.3").logo, "Meta under either name");
  const unknown = makerOf("inception/mercury-2.5", "Inception: Mercury 2.5");
  assert.equal(unknown.logo, undefined);
  assert.equal(unknown.initial, "I");
  assert.equal(makerOf("z-ai/glm-5.3", "Z.ai: GLM 5.3").name, "Z.ai");
  assert.equal(makerOf("brand-new/model-x").initial, "B", "no name: the id's first part");
  assert.equal(makerOf("typed-without-slash").initial, "?");
  const local = makerOf("lmstudio/google/gemma-4-31b-qat", "Gemma 4 31B QAT (LM Studio)");
  assert.equal(local.slug, "google", "LM Studio's: the maker named after lmstudio/");
  assert.equal(local.logo, MAKER_LOGOS.google);
  for (const url of Object.values(MAKER_LOGOS)) assert.match(url, /^https:\/\/(openrouter\.ai\/images\/icons\/|t0\.gstatic\.com\/faviconV2\?)/);
});
