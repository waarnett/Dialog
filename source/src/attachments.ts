// Turning files you drop or pick into attachments the models can read.
//
//   text files (Markdown, plain text, CSV, code, ...)  -> sent as text
//   conversations saved by Dialog                      -> sent as their turns in plain text
//   images (PNG, JPEG, WebP, GIF)                      -> sent as images; large ones scaled down
//   PDFs                                               -> sent as files
// Anything else is refused with a suggestion.

import { formatBytes, newId } from "./engine";
import { savedConversationText } from "./export";
import { savedConversationData } from "./storage";
import type { Attachment } from "./types";

/** Above this many tokens, ask before attaching a text file. */
export const LARGE_TEXT_TOKENS = 50_000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** A saved conversation's page holds its pictures and files too, so it may be this large. */
const MAX_SAVED_BYTES = 100 * 1024 * 1024;
/** Images are scaled so their longer side is at most this (models downscale anyway). */
const IMAGE_MAX_SIDE = 2000;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const TEXT_EXTENSIONS = new Set(
  ("txt md markdown text csv tsv json jsonl xml yaml yml toml ini cfg conf log html htm css js mjs ts tsx jsx " +
    "py swift c h cpp hpp m mm java kt go rs rb php pl sh zsh bash sql r tex bib rtf srt vtt").split(" "),
);
const OFFICE_EXTENSIONS = new Set("doc docx pages odt xls xlsx numbers ods ppt pptx key odp".split(" "));

export class AttachError extends Error {}

const extOf = (name: string) => (/\.([^.]+)$/.exec(name)?.[1] ?? "").toLowerCase();

export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function readAs<T extends string | ArrayBuffer>(file: Blob, how: "text" | "dataURL" | "buffer"): Promise<T> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as T);
    r.onerror = () => reject(new AttachError(`Couldn't read ${(file as File).name ?? "the file"}.`));
    if (how === "text") r.readAsText(file);
    else if (how === "dataURL") r.readAsDataURL(file);
    else r.readAsArrayBuffer(file);
  });
}

/** Is this file text? Decide by type and extension, then by checking the bytes really are text. */
async function asText(file: File): Promise<string | null> {
  const ext = extOf(file.name);
  const typed = file.type.startsWith("text/") || /json|xml|javascript|yaml|x-sh|x-python/.test(file.type);
  if (!typed && !TEXT_EXTENSIONS.has(ext) && file.type !== "") return null;
  const bytes = new Uint8Array(await readAs<ArrayBuffer>(file, "buffer"));
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\u0000") ? null : text;
  } catch {
    return null; // not valid UTF-8: probably not text
  }
}

/** Scale a large image down and re-encode it; returns a data: URL and its byte size. */
async function prepareImage(file: File): Promise<{ data: string; mime: string; size: number }> {
  const original = async () => ({ data: await readAs<string>(file, "dataURL"), mime: file.type, size: file.size });
  if (file.type === "image/gif") return original(); // keep animation
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024) return original();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return original();
    const keepPng = file.type === "image/png"; // may have transparency or sharp text
    if (!keepPng) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const mime = keepPng ? "image/png" : "image/jpeg";
    const data = canvas.toDataURL(mime, 0.85);
    const size = Math.round(((data.length - data.indexOf(",") - 1) * 3) / 4);
    return size < file.size || scale < 1 ? { data, mime, size } : original();
  } catch {
    return original();
  }
}

/** The text parts of an attachment, once a very large text has been confirmed (or AttachError if declined). */
function textFile(name: string, text: string, confirmLarge: (message: string) => boolean): { name: string; kind: "text"; tokens: number; data: string } {
  const tokens = estimateTokens(text);
  if (
    tokens > LARGE_TEXT_TOKENS &&
    !confirmLarge(
      `${name} is about ${tokens.toLocaleString("en-US")} tokens. Every participant re-reads attached files ` +
        `each time it speaks, so a file this size adds noticeably to the cost of every turn. Attach it anyway?`,
    )
  ) {
    throw new AttachError(""); // declined; nothing to report
  }
  return { name, kind: "text", tokens, data: text };
}

/**
 * Read one file into an attachment, or throw AttachError with a plain explanation.
 * A conversation saved by Dialog (Save All or Save Selected) is attached as its turns in plain
 * text, without the page and data around them.
 * `confirmLarge` is asked before a very large text file is accepted.
 */
export async function readAttachment(file: File, confirmLarge: (message: string) => boolean): Promise<Attachment> {
  const ext = extOf(file.name);
  const base = { id: newId(), name: file.name || "unnamed" };

  if (IMAGE_TYPES.includes(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) throw new AttachError(`${file.name} is too large (${formatBytes(file.size)}).`);
    const img = await prepareImage(file);
    return { ...base, kind: "image", mime: img.mime, size: img.size, data: img.data };
  }

  if (file.type === "application/pdf" || ext === "pdf") {
    if (file.size > MAX_PDF_BYTES) throw new AttachError(`${file.name} is too large (${formatBytes(file.size)}); the limit for PDFs is ${formatBytes(MAX_PDF_BYTES)}.`);
    const raw = await readAs<string>(file, "dataURL");
    const data = raw.replace(/^data:[^;,]*/, "data:application/pdf");
    return { ...base, kind: "pdf", mime: "application/pdf", size: file.size, data };
  }

  if (OFFICE_EXTENSIONS.has(ext)) {
    throw new AttachError(`Dialog can't read .${ext} files. Export ${file.name} as a PDF and attach that instead.`);
  }

  // A page saved by Dialog may be large with the pictures in it; only its turns are attached.
  const mayBeSaved = (ext === "html" || ext === "htm") && file.size <= MAX_SAVED_BYTES;
  if (file.size <= MAX_TEXT_BYTES || mayBeSaved) {
    const text = await asText(file);
    const saved = text === null || !mayBeSaved ? null : savedConversationData(text);
    if (saved) {
      const transcript = savedConversationText(saved);
      const name = `${file.name.replace(/\.html?$/i, "")} (transcript).txt`;
      return { ...base, ...textFile(name, transcript, confirmLarge), mime: "text/plain", size: new TextEncoder().encode(transcript).length };
    }
    if (text !== null && file.size <= MAX_TEXT_BYTES) {
      return { ...base, ...textFile(file.name, text, confirmLarge), mime: file.type || "text/plain", size: file.size };
    }
  }
  if (file.size > MAX_TEXT_BYTES && (TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/"))) {
    throw new AttachError(`${file.name} is too large (${formatBytes(file.size)}); the limit for text files is ${formatBytes(MAX_TEXT_BYTES)}.`);
  }

  throw new AttachError(
    `Dialog can attach text files, PDFs and images (PNG, JPEG, WebP, GIF), but not ${file.name}.`,
  );
}
