// Talking to LM Studio: models running on this computer, through LM Studio's own server.
//
// LM Studio answers the same kind of chat request as OpenRouter and streams its replies the
// same way, so openrouter.ts sends both. This file holds what differs: how Dialog marks a
// local model, where its requests go, what goes in them, and LM Studio's list of models.

import type { ChatMessage } from "./types";
import type { ModelInfo } from "./openrouter";

/** Marks a seat's model as one of LM Studio's: "lmstudio/google/gemma-4-31b-qat". */
export const LOCAL_PREFIX = "lmstudio/";

/** The address LM Studio's server usually has; shown in Settings as an example. */
export const LOCAL_EXAMPLE = "http://localhost:1234";

export const isLocalModel = (model: string): boolean => model.trim().startsWith(LOCAL_PREFIX);

/** The id LM Studio knows the model by: "google/gemma-4-31b-qat". */
export const localId = (model: string): string => model.trim().slice(LOCAL_PREFIX.length);

/**
 * The address from Settings as the base of LM Studio's OpenAI-style requests: "localhost:1234",
 * "http://localhost:1234/" and "http://localhost:1234/v1" all give "http://localhost:1234/v1".
 */
export function localBase(address: string): string {
  let a = address.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(a)) a = `http://${a}`;
  return a.replace(/\/v1$/, "") + "/v1";
}

/** The server's own address, for LM Studio's detailed model list (which isn't under /v1). */
const serverRoot = (address: string): string => localBase(address).replace(/\/v1$/, "");

/**
 * The JSON body sent to LM Studio: the request without OpenRouter's extras (web search, page
 * reading, the PDF converter, caching, the host-routing label), and without a thinking level,
 * since LM Studio doesn't say which levels a model takes.
 */
export function localRequestBody(req: { model: string; messages: ChatMessage[] }): Record<string, unknown> {
  return { model: localId(req.model), messages: req.messages, stream: true, stream_options: { include_usage: true } };
}

/** "gemma-4-31b-qat" -> "Gemma 4 31B QAT": words capitalized; sizes ("31b", "e4b") and short tags in capitals. */
export function localModelName(id: string): string {
  const base = id.slice(id.lastIndexOf("/") + 1);
  return base
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (/^[a-z]?\d+(\.\d+)?[a-z]?$/i.test(w) || /^[a-z]{1,3}$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Plain words for an error LM Studio reported, with what to do about it where Dialog knows. */
export function localErrorText(message: string, address: string): string {
  const m = /request \((\d+) tokens\) exceeds the available context size \((\d+) tokens\)/.exec(message);
  if (m) {
    const [, need, have] = m;
    return (
      `This conversation is too long for the model as LM Studio has it loaded: it needs ${Number(need).toLocaleString("en-US")} tokens, ` +
      `and the model's window is ${Number(have).toLocaleString("en-US")}. In LM Studio, load the model again with a larger context length, ` +
      "or start a new conversation."
    );
  }
  if (/context (size|length)|n_ctx/i.test(message)) {
    return `This conversation may be too long for the model as LM Studio has it loaded. In LM Studio, load the model again with a larger context length. (LM Studio: ${message})`;
  }
  return `LM Studio, at ${address.trim()}, reported a problem: ${message}`;
}

/** Why Dialog couldn't reach LM Studio, and what to check. */
export function localUnreachableText(address: string): string {
  return (
    `Couldn't reach LM Studio at ${address.trim()}. Check that its server is running and was started with CORS on ` +
    "(in Terminal: lms server start --cors). In Chrome, allow this page to reach devices on your local network if it asks. " +
    "Safari doesn't let the online Dialog reach a server on this computer: use Chrome, or open Dialog from a copy on your disk."
  );
}

/**
 * LM Studio's chat models (embedding models left out), from its detailed list, which says
 * which models can look at images, which are loaded now, and their context length.
 * Throws an Error in plain words if LM Studio can't be reached.
 */
export async function fetchLocalModels(address: string): Promise<ModelInfo[]> {
  let res: Response;
  try {
    res = await fetch(`${serverRoot(address)}/api/v0/models`, { cache: "no-store" });
  } catch {
    throw new Error(localUnreachableText(address));
  }
  if (!res.ok) throw new Error(`LM Studio answered with an error (HTTP ${res.status}).`);
  const j: unknown = await res.json();
  const data = typeof j === "object" && j !== null && Array.isArray((j as { data?: unknown }).data) ? (j as { data: unknown[] }).data : [];
  const out: ModelInfo[] = [];
  for (const m of data) {
    if (typeof m !== "object" || m === null) continue;
    const v = m as Record<string, unknown>;
    if (typeof v.id !== "string" || (v.type !== "llm" && v.type !== "vlm")) continue;
    const context = typeof v.loaded_context_length === "number" ? v.loaded_context_length : typeof v.max_context_length === "number" ? v.max_context_length : 0;
    out.push({
      id: LOCAL_PREFIX + v.id,
      name: `${localModelName(v.id)} (LM Studio)`,
      inputPrice: 0,
      outputPrice: 0,
      contextLength: context,
      inputModalities: v.type === "vlm" ? ["text", "image"] : ["text"],
      tools: false, // OpenRouter's web search and page reading aren't available here
      local: { loaded: v.state === "loaded" },
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
