// The company or lab that made a model, and where to get its logo.
//
// Dialog doesn't carry the logos itself: it shows the ones OpenRouter shows beside each model
// on its own pages, loaded from the same places when a seat card is drawn. OpenRouter hosts
// some itself; for others it uses Google's service for a website's icon, given the maker's
// site. (Looked up on OpenRouter's model pages, 2026 Oct 19.) A maker not listed here, or a
// logo that doesn't load, gets the maker's initial in a circle instead.

import { isLocalModel, localId } from "./lmstudio";

const OPENROUTER_ICON = (file: string) => `https://openrouter.ai/images/icons/${file}`;
const SITE_ICON = (site: string) =>
  `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${site}&size=64`;

/** Logos by the first part of the model id ("anthropic" in "anthropic/claude-opus-5.5"). */
export const MAKER_LOGOS: Record<string, string> = {
  anthropic: OPENROUTER_ICON("Anthropic.svg"),
  openai: OPENROUTER_ICON("OpenAI.svg"),
  google: OPENROUTER_ICON("GoogleGemini.svg"),
  "x-ai": SITE_ICON("https://x.ai/"),
  deepseek: OPENROUTER_ICON("DeepSeek.png"),
  qwen: OPENROUTER_ICON("Qwen.png"),
  mistralai: OPENROUTER_ICON("Mistral.png"),
  meta: OPENROUTER_ICON("Meta.png"),
  "meta-llama": OPENROUTER_ICON("Meta.png"),
  moonshotai: OPENROUTER_ICON("MoonshotAI.png"),
  "z-ai": SITE_ICON("https://z.ai/"),
  xiaomi: SITE_ICON("https://www.mi.com"),
  cohere: OPENROUTER_ICON("Cohere.png"),
  perplexity: OPENROUTER_ICON("Perplexity.png"),
  microsoft: OPENROUTER_ICON("Microsoft.svg"),
  nvidia: SITE_ICON("https://nvidia.com/"),
  amazon: SITE_ICON("https://nova.amazon.com/"),
  minimax: SITE_ICON("https://minimaxi.com/"),
  stepfun: SITE_ICON("https://platform.stepfun.ai/"),
};

export interface Maker {
  /** The first part of the model id, e.g. "x-ai". */
  slug: string;
  /** For people, e.g. "SpaceXAI" (from OpenRouter's name for the model), or the slug. */
  name: string;
  /** The logo's address, if Dialog knows one. */
  logo?: string;
  /** What to show if there is no logo: the name's first letter or digit. */
  initial: string;
}

/**
 * Who made a model, from its id ("~google/gemini-pro-latest") and OpenRouter's name for it
 * ("Google: Gemini Pro Latest"). For a model in LM Studio, the maker in the id after
 * "lmstudio/" ("lmstudio/google/gemma-4-31b-qat": Google).
 */
export function makerOf(modelId: string, modelName?: string): Maker {
  const id = isLocalModel(modelId) ? localId(modelId) : modelId.trim();
  const slug = (/^~?([^/]+)\//.exec(id)?.[1] ?? "").toLowerCase();
  const fromName = modelName && modelName.includes(":") ? modelName.slice(0, modelName.indexOf(":")).trim() : "";
  const name = fromName || slug;
  const initial = (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? "?").toUpperCase();
  return { slug, name, logo: MAKER_LOGOS[slug], initial };
}
