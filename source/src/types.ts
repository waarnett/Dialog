// The data Dialog keeps. Everything here is plain data (no behavior), so it can be
// saved to the browser's storage as JSON and read back.

/** A participant slot: one AI model with a name and a role. */
export interface Seat {
  id: string;
  /** The name other participants see, e.g. "Claude" or "Claude-Skeptic". */
  name: string;
  /** OpenRouter model identifier, e.g. "anthropic/claude-opus-5.5", or "lmstudio/…" for one in LM Studio. */
  model: string;
  /** Standing instructions for this seat (sent as its system prompt). */
  role: string;
  /**
   * How hard the model "thinks" before replying: one of the levels its OpenRouter page
   * lists (e.g. "max", "xhigh", "high", "medium", "low", "minimal", "none"), or
   * "default" to leave it to the model.
   */
  effort: Effort;
  /** Display color for this seat's entries. */
  color: string;
  /** Asleep: sits out "team" rounds and isn't the default next speaker; its card is folded up at the end of the list. */
  asleep?: boolean;
}

export type Effort = string;

/** Token counts and cost OpenRouter reports for one reply. */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** Tokens re-read from the cache at the discount. */
  cachedTokens: number;
  /** Tokens stored in the cache for later re-reading (Claude charges a premium for this). */
  cacheWriteTokens: number;
  /** Web searches the reply made, when its host reports them. */
  webSearches?: number;
  /** Web tools used in all (searches and pages read), when the host reports it; some report only searches. */
  webToolsUsed?: number;
  /** Pages read, from OpenRouter's record of the request (looked up when the particulars are opened). */
  pagesRead?: number;
  /** What reading and writing cost, in dollars, when OpenRouter reports it (it doesn't always). */
  readCost?: number;
  writeCost?: number;
}

export interface Citation {
  url: string;
  title?: string;
}

/** Who said something: the human ("human") or a seat (its id). */
export type Speaker = "human" | string;

/**
 * Whom a message of yours was addressed to by its last words: one participant ("…, Grok")
 * or everyone ("…, team", "…independently, team"). Dialog acts on those words and leaves
 * them out of the message; the participants are told the addressee instead.
 */
export type Addressee =
  | { seatId: string; name: string }
  | { seats: { id: string; name: string }[]; how: "in turn" | "independently" }
  | { everyone: "in turn" | "independently" };

/** A file added to the conversation with one of the human's entries. */
export interface Attachment {
  id: string;
  name: string;
  kind: "text" | "image" | "pdf";
  /** e.g. "text/markdown", "image/jpeg", "application/pdf". */
  mime: string;
  /** Size in bytes of what is sent (after any image downscaling). */
  size: number;
  /** For text files: a rough token count (about 4 characters per token). */
  tokens?: number;
  /**
   * The content: the text itself, or a data: URL for images and PDFs. Kept in its own
   * storage slot, not in the saved conversation; absent if it could not be restored.
   */
  data?: string;
  /** Set if the browser would not store it, so it will be lost when the page closes. */
  unsaved?: boolean;
}

/** What a participant's file is: a web page, a drawing, Markdown, or plain text. */
export type MadeKind = "html" | "svg" | "md" | "txt";

/**
 * A file a participant made in a reply, by writing it between <file name="…"> and </file>.
 * Its contents are stored like attachments, in their own storage slot.
 */
export interface MadeFile {
  id: string;
  /** e.g. "plan.md", "orbit.svg", "calculator.html". */
  name: string;
  kind: MadeKind;
  /** Size in bytes. */
  size: number;
  /** The contents; absent once removed, or if it could not be restored. */
  data?: string;
  /** Set if the browser would not store it, so it will be lost when the page closes. */
  unsaved?: boolean;
  /** You removed it: no participant sees it from then on. */
  removed?: boolean;
  /** The reply ended (or was stopped) before the file's closing tag. */
  incomplete?: boolean;
}

/** One entry in the conversation. */
export interface Entry {
  id: string;
  speaker: Speaker;
  /** Name shown for the speaker, captured when the entry was made. */
  speakerName: string;
  /**
   * If set, this entry is part of a private exchange: only that seat (an id), or those seats
   * (a list of ids, for a private exchange with several), ever see it, besides the human.
   * Unset means everyone sees it.
   */
  privateWith?: string | string[];
  text: string;
  /** Files the human added with this entry. */
  attachments?: Attachment[];
  /** Files a participant made in this reply (taken out of `text`). */
  made?: MadeFile[];
  /** ISO timestamp. */
  time: string;

  // The fields below apply only to AI replies.
  /** The model OpenRouter actually used (an alias like "~google/gemini-pro-latest" resolves to a specific one). */
  model?: string;
  /** OpenRouter's id for the request ("gen-…"), for looking up the host later. */
  requestId?: string;
  /** The company whose servers ran the model (e.g. "Alibaba"), as OpenRouter names it. */
  host?: string;
  /** The seat's model setting when this reply was requested. */
  seatModel?: string;
  /** Your message's addressee, from the words at its end (which are not part of `text`). */
  addressedTo?: Addressee;
  /** Written in an independent round ("…independently, team"), without seeing the others' replies from that round. */
  independent?: boolean;
  /** The seat's thinking level when this reply was requested (absent in replies saved before it was recorded). */
  seatEffort?: Effort;
  /** Dollars, as reported by OpenRouter (before its credit-purchase fee). */
  cost?: number;
  usage?: Usage;
  /** How long the reply took, measured in the page (milliseconds from pressing Speak). */
  timing?: { totalMs: number; firstTextMs?: number };
  citations?: Citation[];
  /**
   * The model's thinking, as far as its host sends it (often a summary, sometimes nothing).
   * Kept only while the page is open: never stored in the browser or put in a saved file.
   */
  thinking?: string;
  /**
   * streaming: arriving now; done: complete; stopped: you pressed Stop
   * (partial text is kept); error: failed (never shown to any bot).
   */
  status?: "streaming" | "done" | "stopped" | "error";
  error?: string;
}

export interface Session {
  startedAt: string;
  entries: Entry[];
}

export interface Settings {
  apiKey: string;
  /** Optional OpenRouter management key, used only to read the account's remaining credit. */
  managementKey: string;
  /** The address of LM Studio's server on this computer, e.g. "http://localhost:1234"; "" for none. */
  localServer: string;
  humanName: string;
  /** What the human wrote about himself; given to every seat with the house rules. */
  aboutHuman: string;
  /** Template for the instructions every seat gets; see engine.ts for the {placeholders}. */
  houseRules: string;
  seats: Seat[];
}

/** One piece of a message: text, an image, or a file (PDF). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

/** A message in the two-speaker format the model APIs use. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** Plain text, or a list of parts when images or files are included. */
  content: string | ContentPart[];
}
