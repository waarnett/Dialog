// Talking to OpenRouter: one endpoint for every model.
//
// Replies are "streamed": OpenRouter sends the reply in small pieces as the model
// writes it, using a simple text format called Server-Sent Events (SSE): lines that
// start with "data: " followed by a JSON object, ending with "data: [DONE]".
// The last piece before [DONE] carries the token counts and the cost.
//
// Models running in LM Studio on this computer ("lmstudio/…", see lmstudio.ts) are asked
// here too: LM Studio answers the same kind of request, streamed the same way.

import { isLocalModel, localBase, localErrorText, localRequestBody, localUnreachableText, LOCAL_PREFIX } from "./lmstudio";
import type { ChatMessage, Citation, Effort, Usage } from "./types";

const BASE = "https://openrouter.ai/api/v1";

export class OpenRouterError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OpenRouterError";
  }
}

// ---------------------------------------------------------------------------
// SSE parsing (kept separate so it can be tested without a network)

/** Splits incoming text into complete "data:" payloads, holding back partial lines. */
export class SSEParser {
  private buffer = "";

  /**
   * Feed more text; returns, in order, the payloads (the text after "data: ") completed so
   * far, and each keep-alive comment OpenRouter sends while nothing else is coming, as the
   * line itself (starting with ":", which no payload does).
   */
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    for (;;) {
      const nl = this.buffer.indexOf("\n");
      if (nl === -1) break;
      const line = this.buffer.slice(0, nl).replace(/\r$/, "");
      this.buffer = this.buffer.slice(nl + 1);
      if (line === "") continue; // blank separator
      if (line.startsWith(":")) out.push(line); // keep-alive comment
      else if (line.startsWith("data:")) out.push(line.slice(5).trimStart());
    }
    return out;
  }
}

/** What one streamed piece contributes. */
export interface StreamPiece {
  text?: string;
  /** More of the model's thinking. */
  thinking?: string;
  citations?: Citation[];
  usage?: Usage;
  cost?: number;
  model?: string;
  /** OpenRouter's id for this request ("gen-..."), carried on each piece. */
  id?: string;
  /** The host running the model, e.g. "Alibaba" (OpenRouter includes it, though its documentation doesn't promise to). */
  provider?: string;
  error?: string;
  done?: boolean;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Pull url_citation annotations out of whatever shape they arrive in. */
export function citationsFrom(annotations: unknown): Citation[] {
  if (!Array.isArray(annotations)) return [];
  const out: Citation[] = [];
  for (const a of annotations) {
    if (!isObj(a) || a.type !== "url_citation") continue;
    const inner = isObj(a.url_citation) ? a.url_citation : a;
    if (typeof inner.url === "string" && inner.url) {
      out.push({ url: inner.url, title: typeof inner.title === "string" ? inner.title : undefined });
    }
  }
  return out;
}

/**
 * The thinking in one streamed piece. OpenRouter sends it as `reasoning`, and the same again
 * as `reasoning_details`, so the second is read only when the first is missing.
 * LM Studio sends `reasoning` (or, before version 0.3.23, `reasoning_content`). Encrypted
 * thinking, which some models send instead, can't be shown and is skipped.
 */
export function thinkingFrom(delta: Json): string {
  for (const key of ["reasoning", "reasoning_content"]) {
    const v = delta[key];
    if (typeof v === "string" && v) return v;
  }
  if (!Array.isArray(delta.reasoning_details)) return "";
  let out = "";
  for (const d of delta.reasoning_details) {
    if (!isObj(d)) continue;
    if (d.type === "reasoning.text" && typeof d.text === "string") out += d.text;
    else if (d.type === "reasoning.summary" && typeof d.summary === "string") out += d.summary;
  }
  return out;
}

/**
 * The particulars OpenRouter attaches to an error, as one line: which host failed, its own
 * error code, and the request id (look it up on OpenRouter's Activity page). OpenRouter
 * replaces the message itself with a generic one when the host fails with a server error,
 * so these are often the only real clues.
 */
export function errorDetails(error: Json, requestId?: string): string {
  const meta = isObj(error.metadata) ? error.metadata : {};
  const bits: string[] = [];
  if (typeof meta.provider_name === "string") bits.push(`host: ${meta.provider_name}`);
  const code = meta.provider_code ?? error.code;
  if (typeof code === "string" || typeof code === "number") bits.push(`code: ${code}`);
  if (meta.raw !== undefined) {
    const raw = typeof meta.raw === "string" ? meta.raw : JSON.stringify(meta.raw);
    bits.push(`host said: ${raw.length > 300 ? raw.slice(0, 300) + "…" : raw}`);
  }
  if (requestId) bits.push(`request ${requestId}`);
  return bits.length ? `(${bits.join("; ")})` : "";
}

/**
 * Interpret one SSE payload. From LM Studio (`local`), an error is passed on as LM Studio
 * worded it, for streamChat to put in plain words.
 */
export function interpretPayload(payload: string, local = false): StreamPiece {
  if (payload === "[DONE]") return { done: true };
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return {}; // ignore anything malformed
  }
  if (!isObj(json)) return {};
  const piece: StreamPiece = {};

  if (local && (typeof json.error === "string" || isObj(json.error))) {
    piece.error = typeof json.error === "string" ? json.error : typeof json.error.message === "string" ? json.error.message : "Unknown error";
  } else if (isObj(json.error)) {
    const message = typeof json.error.message === "string" ? json.error.message : "Unknown error from OpenRouter";
    const details = errorDetails(json.error, typeof json.id === "string" ? json.id : undefined);
    piece.error = `The model's host failed partway through. OpenRouter says: “${message}” ${details}`.trim();
  }
  if (typeof json.model === "string") piece.model = json.model;
  if (typeof json.id === "string") piece.id = json.id;
  if (typeof json.provider === "string" && json.provider) piece.provider = json.provider;

  const choice = Array.isArray(json.choices) && isObj(json.choices[0]) ? json.choices[0] : undefined;
  if (choice) {
    const delta = isObj(choice.delta) ? choice.delta : undefined;
    const message = isObj(choice.message) ? choice.message : undefined;
    if (delta && typeof delta.content === "string" && delta.content) piece.text = delta.content;
    const thinking = delta && thinkingFrom(delta);
    if (thinking) piece.thinking = thinking;
    const cites = [...citationsFrom(delta?.annotations), ...citationsFrom(message?.annotations)];
    if (cites.length) piece.citations = cites;
  }

  if (isObj(json.usage)) {
    const u = json.usage;
    const ptd = isObj(u.prompt_tokens_details) ? u.prompt_tokens_details : {};
    const ctd = isObj(u.completion_tokens_details) ? u.completion_tokens_details : {};
    piece.usage = {
      promptTokens: num(u.prompt_tokens),
      completionTokens: num(u.completion_tokens),
      reasoningTokens: num(u.reasoning_tokens) || num(ctd.reasoning_tokens),
      cachedTokens: num(u.cached_tokens) || num(ptd.cached_tokens),
      cacheWriteTokens: num(ptd.cache_write_tokens),
    };
    // Web use: OpenRouter's documentation names it server_tool_use; its replies say server_tool_use_details.
    const web = isObj(u.server_tool_use_details) ? u.server_tool_use_details : isObj(u.server_tool_use) ? u.server_tool_use : {};
    if (typeof web.web_search_requests === "number") piece.usage.webSearches = web.web_search_requests;
    if (typeof web.tool_calls_executed === "number") piece.usage.webToolsUsed = web.tool_calls_executed;
    if (typeof u.cost === "number") piece.cost = u.cost;
  }
  return piece;
}

// ---------------------------------------------------------------------------
// Requests

export interface ChatRequest {
  apiKey: string;
  model: string;
  /**
   * A label unique to the seat. OpenRouter uses it to keep sending this seat's requests
   * to the same host, where its earlier text is already cached.
   */
  sessionId: string;
  messages: ChatMessage[];
  effort: Effort;
  /**
   * Offer the model web search and page reading, which OpenRouter runs for it ("server
   * tools"). Off for models that can't use tools at all.
   */
  tools: boolean;
  /**
   * For PDFs sent to a model that can't read them itself: OpenRouter's converter to use.
   * Left unset, OpenRouter would pick a paid one ($2 per 1,000 pages, every turn).
   */
  pdfEngine?: "cloudflare-ai";
  /** For an LM Studio model ("lmstudio/…"): the server's address, from Settings. */
  localServer?: string;
  signal?: AbortSignal;
  /**
   * Called with each new piece of reply text as it arrives; `afterPause` when the text
   * resumes after a pause of a second or so (OpenRouter's keep-alive comments meanwhile),
   * as when the model has been searching or reading a page.
   */
  onText: (text: string, afterPause: boolean) => void;
  /** Called with each new piece of the model's thinking as it arrives. */
  onThinking?: (text: string) => void;
  /**
   * Called (for OpenRouter, not LM Studio) when the request's id or host first arrives, so
   * they are known even for a reply that is stopped or fails.
   */
  onMeta?: (meta: { requestId?: string; host?: string }) => void;
}

export interface ChatResult {
  model?: string;
  usage?: Usage;
  cost?: number;
  citations: Citation[];
}

/**
 * Most web searches per reply. OpenRouter enforces this for Claude and wherever it runs the
 * search itself; models using their maker's own search (OpenAI, Google, xAI) ignore it.
 */
export const MAX_SEARCHES = 10;

/** Claude models, which cache only when asked to (the others cache automatically). */
export function isClaudeModel(model: string): boolean {
  return /^~?anthropic\//.test(model.trim());
}

/** The JSON body sent to OpenRouter (exported so tests can check it). */
export function requestBody(req: Omit<ChatRequest, "apiKey" | "signal" | "onText" | "onThinking">): Json {
  const body: Json = { model: req.model, messages: req.messages, stream: true, session_id: req.sessionId };
  // Ask Claude to cache the conversation so the next turn re-reads it at the discount.
  // The 1-hour cache costs more to store than the 5-minute one, but a seat often waits
  // more than 5 minutes between turns, and an expired cache costs more than none at all.
  if (isClaudeModel(req.model)) body.cache_control = { type: "ephemeral", ttl: "1h" };
  // The thinking comes back with the reply (OpenRouter's default), to be shown under "Thinking".
  if (req.effort !== "default") body.reasoning = { effort: req.effort };
  if (req.tools) {
    body.tools = [
      { type: "openrouter:web_search", parameters: { max_uses: MAX_SEARCHES } },
      { type: "openrouter:web_fetch" }, // reads a web page or online PDF by its address
    ];
  }
  if (req.pdfEngine) body.plugins = [{ id: "file-parser", pdf: { engine: req.pdfEngine } }];
  return body;
}

function friendlyHttpError(status: number, detail: string): string {
  const hint =
    status === 401
      ? "OpenRouter didn't accept the API key. Check it in Settings."
      : status === 402
        ? "Not enough OpenRouter credit, or this key's spending limit has been reached."
        : status === 429
          ? "OpenRouter says too many requests; wait a moment and try again."
          : status === 404
            ? "OpenRouter found nowhere to run this model. Either it has been withdrawn (choose another with " +
              "the seat's model button) or all its hosts are down for the moment (try again later)."
            : status === 400 && /not a valid model|model.*(not found|does not exist)/i.test(detail)
              ? "OpenRouter doesn't recognize this model id; choose another with the seat's model button."
              : "";
  return [hint, detail && `(OpenRouter: ${detail})`].filter(Boolean).join(" ") || `HTTP error ${status}`;
}

const NETWORK_HINT = "Couldn't reach OpenRouter. Check the internet connection and try again.";

async function send(url: string, init: RequestInit, unreachable = NETWORK_HINT): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new OpenRouterError(unreachable);
  }
}

/** Ask one model for a reply, streaming the text through onText. */
/** The message from a failed request, and its particulars (LM Studio's error is just a message). */
async function failure(res: Response): Promise<{ detail: string; extra: string }> {
  let detail = "";
  let extra = "";
  try {
    const j: unknown = await res.json();
    if (isObj(j) && typeof j.error === "string") detail = j.error;
    else if (isObj(j) && isObj(j.error)) {
      if (typeof j.error.message === "string") detail = j.error.message;
      extra = errorDetails(j.error, typeof j.id === "string" ? j.id : undefined);
    }
  } catch {
    /* body wasn't JSON */
  }
  return { detail, extra };
}

export async function streamChat(req: ChatRequest): Promise<ChatResult> {
  const local = isLocalModel(req.model);
  const server = req.localServer ?? "";
  const post = (r: ChatRequest) =>
    local
      ? send(
          `${localBase(server)}/chat/completions`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(localRequestBody(r)), signal: r.signal },
          localUnreachableText(server),
        )
      : send(`${BASE}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${r.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestBody(r)),
          signal: r.signal,
        });

  let res = await post(req);
  if (!res.ok && local) {
    const f = await failure(res);
    throw new OpenRouterError(localErrorText(f.detail || `HTTP error ${res.status}`, server), res.status);
  }
  if (!res.ok) {
    let f = await failure(res);
    // No host for this model can use tools ("No endpoints found that support tool use"):
    // ask again without web search and page reading rather than fail.
    if (req.tools && res.status === 404 && /tool/i.test(f.detail)) {
      res = await post({ ...req, tools: false });
      if (!res.ok) f = await failure(res);
    }
    if (!res.ok) throw new OpenRouterError([friendlyHttpError(res.status, f.detail), f.extra].filter(Boolean).join(" "), res.status);
  }
  if (!res.body) throw new OpenRouterError(`${local ? "LM Studio" : "OpenRouter"} sent an empty response.`);

  const result: ChatResult = { citations: [] };
  const seen = new Set<string>();
  let requestId: string | undefined;
  const parser = new SSEParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let host: string | undefined;
  let quietNotes = 0; // keep-alive comments since the last reply text
  const handle = (payload: string): boolean => {
    if (payload.startsWith(":")) {
      quietNotes++;
      return false;
    }
    const p = interpretPayload(payload, local);
    if (!local && ((p.id && p.id !== requestId) || (p.provider && p.provider !== host))) {
      req.onMeta?.({ requestId: p.id ?? requestId, host: p.provider ?? host });
    }
    if (p.id) requestId = p.id;
    if (p.provider) host = p.provider;
    if (p.error && local) throw new OpenRouterError(localErrorText(p.error, server));
    if (p.error) {
      // Make sure the request id is there to look up on OpenRouter's Activity page.
      throw new OpenRouterError(p.error.includes("request ") || !requestId ? p.error : `${p.error} (request ${requestId})`);
    }
    if (p.thinking) req.onThinking?.(p.thinking);
    if (p.text) {
      req.onText(p.text, quietNotes >= 2); // they come about every 0.4 s
      quietNotes = 0;
    }
    if (p.model) result.model = local ? LOCAL_PREFIX + p.model : p.model; // local: as the seat's model is written
    if (p.usage) result.usage = p.usage;
    if (p.cost !== undefined) result.cost = p.cost;
    for (const c of p.citations ?? []) {
      if (!seen.has(c.url)) {
        seen.add(c.url);
        result.citations.push(c);
      }
    }
    return p.done === true;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const payload of parser.push(decoder.decode(value, { stream: true }))) {
      if (handle(payload)) return result;
    }
  }
  for (const payload of parser.push(decoder.decode() + "\n")) handle(payload);
  return result;
}

// ---------------------------------------------------------------------------
// Model list and key usage

/** A model's thinking ("reasoning") options, as listed on its OpenRouter page. */
export interface ReasoningInfo {
  /** Levels the model accepts, highest first, e.g. ["max", "xhigh", "high", "medium", "low"]. */
  efforts: string[];
  /** The level used when none is specified. */
  defaultEffort?: string;
  /** True if the model always thinks (it can't be switched off). */
  mandatory: boolean;
  /** For models where thinking is optional: is it on unless switched off? */
  defaultEnabled?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** Dollars per million tokens. */
  inputPrice: number;
  outputPrice: number;
  contextLength: number;
  /** What the model takes in directly, e.g. ["text", "image", "file"]. */
  inputModalities: string[];
  /** Absent if the model has no thinking setting at all. */
  reasoning?: ReasoningInfo;
  /** Can it use tools (and so web search and page reading)? */
  tools: boolean;
  /** For a model in LM Studio (see lmstudio.ts): is it loaded now? */
  local?: { loaded: boolean };
  /**
   * For an id that always follows a family's newest model ("~openai/gpt-astra-latest"): the
   * model it stands for now.
   */
  aliasOf?: { id: string; name: string };
}

function parseReasoning(r: unknown): ReasoningInfo | undefined {
  if (!isObj(r)) return undefined;
  const efforts = Array.isArray(r.supported_efforts)
    ? r.supported_efforts.filter((e): e is string => typeof e === "string")
    : [];
  return {
    efforts,
    defaultEffort: typeof r.default_effort === "string" ? r.default_effort : undefined,
    mandatory: r.mandatory === true,
    defaultEnabled: typeof r.default_enabled === "boolean" ? r.default_enabled : undefined,
  };
}

/**
 * OpenRouter's current model list. Public; no key needed. Always fetched from OpenRouter
 * itself, past the browser's own store of pages it has downloaded before ("no-store"), so a
 * copy the browser kept from an earlier visit can't hide a newly added model. (Dialog keeps
 * its own copy, in storage.ts, and decides when to ask again.)
 */
export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await send(`${BASE}/models`, { cache: "no-store" });
  if (!res.ok) throw new OpenRouterError(`OpenRouter answered with an error (HTTP ${res.status}).`, res.status);
  const j: unknown = await res.json();
  const data = isObj(j) && Array.isArray(j.data) ? j.data : [];
  const out: ModelInfo[] = [];
  for (const m of data) {
    if (!isObj(m) || typeof m.id !== "string" || m.id.endsWith(":batch")) continue;
    const arch = isObj(m.architecture) ? m.architecture : {};
    const outs = Array.isArray(arch.output_modalities) ? arch.output_modalities : ["text"];
    if (!outs.includes("text")) continue;
    const ins = Array.isArray(arch.input_modalities)
      ? arch.input_modalities.filter((x): x is string => typeof x === "string")
      : ["text"];
    const pricing = isObj(m.pricing) ? m.pricing : {};
    const target = isObj(m.alias_target) ? m.alias_target : undefined;
    out.push({
      id: m.id,
      name: typeof m.name === "string" ? m.name : m.id,
      inputPrice: Number(pricing.prompt ?? 0) * 1e6,
      outputPrice: Number(pricing.completion ?? 0) * 1e6,
      contextLength: num(m.context_length),
      inputModalities: ins,
      reasoning: parseReasoning(m.reasoning),
      // Listed among its supported parameters; assume so if OpenRouter doesn't say.
      tools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes("tools") : true,
      ...(target && typeof target.slug === "string"
        ? { aliasOf: { id: target.slug, name: typeof target.name === "string" ? target.name : target.slug } }
        : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface KeyInfo {
  /** Total spent with this key, all time, in dollars. */
  usage: number;
  /** Spent with this key in the current calendar month (UTC). */
  usageMonthly: number;
  /** Spending limit set on the key, or null if none. */
  limit: number | null;
  /** Remaining under the limit, or null if the key has no limit. */
  remaining: number | null;
  /** "daily", "weekly" or "monthly" if the limit resets; null if it never does. */
  limitReset: string | null;
}

/** Spending and limit for the key itself (an ordinary key can see this much, no more). */
export async function fetchKeyInfo(apiKey: string): Promise<KeyInfo> {
  const res = await send(`${BASE}/key`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new OpenRouterError(friendlyHttpError(res.status, ""), res.status);
  const j: unknown = await res.json();
  const d = isObj(j) && isObj(j.data) ? j.data : {};
  return {
    usage: num(d.usage),
    usageMonthly: typeof d.usage_monthly === "number" ? d.usage_monthly : num(d.usage),
    limit: typeof d.limit === "number" ? d.limit : null,
    remaining: typeof d.limit_remaining === "number" ? d.limit_remaining : null,
    limitReset: typeof d.limit_reset === "string" ? d.limit_reset : null,
  };
}

/**
 * The host that ran a request ("gen-…"), from OpenRouter's record of it; null if OpenRouter
 * doesn't say (the record may not be ready just after the reply, or belong to another account).
 */
export async function fetchHost(apiKey: string, requestId: string): Promise<string | null> {
  const res = await send(`${BASE}/generation?id=${encodeURIComponent(requestId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return null;
  const j: unknown = await res.json();
  const d = isObj(j) && isObj(j.data) ? j.data : {};
  return typeof d.provider_name === "string" && d.provider_name ? d.provider_name : null;
}

export interface CreditInfo {
  /** Credit bought, all time. */
  purchased: number;
  /** Credit used, all time, by every key on the account. */
  used: number;
  remaining: number;
}

/**
 * The account's remaining credit. OpenRouter shows this only to a management key, which
 * can manage keys but can't talk to models; Dialog uses it for nothing else.
 */
export async function fetchCredits(managementKey: string): Promise<CreditInfo> {
  const res = await send(`${BASE}/credits`, { headers: { Authorization: `Bearer ${managementKey}` } });
  if (!res.ok) {
    let detail = "";
    try {
      const j: unknown = await res.json();
      if (isObj(j) && isObj(j.error) && typeof j.error.message === "string") detail = j.error.message;
    } catch {
      /* not JSON */
    }
    const hint =
      res.status === 401 || res.status === 403
        ? "OpenRouter didn't accept the management key (it may be mistyped, expired, or an ordinary key)."
        : `HTTP error ${res.status}.`;
    throw new OpenRouterError([hint, detail && `(OpenRouter: ${detail})`].filter(Boolean).join(" "), res.status);
  }
  const j: unknown = await res.json();
  const d = isObj(j) && isObj(j.data) ? j.data : {};
  const purchased = num(d.total_credits);
  const used = num(d.total_usage);
  return { purchased, used, remaining: purchased - used };
}
