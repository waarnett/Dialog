// Mathematics written in LaTeX, as the models often write it, shown as mathematics. The
// LaTeX becomes MathML, which browsers draw themselves, so it needs no fonts or scripts and
// saved conversations show it too. (Temml does the conversion.)
//
// What counts as math:
// - $$ … $$ and \[ … \]: a formula on its own line ("display").
// - \( … \) and $ … $: math within the sentence. Since replies also mention money, a single $
//   counts only as Pandoc has it: the opening $ followed at once by something other than a
//   space, the closing one preceded by something other than a space and not followed by a
//   digit; and with no backtick between them, so it can't reach into code. So "$5 and $10"
//   stays money, and "$p/q$" is math.
// Math inside code (backticks, code blocks) is left alone, as Markdown leaves code alone.

import type { MarkedExtension, Tokens } from "marked";
import temml from "temml";
import temmlCss from "temml/dist/Temml-Local.css";
import temmlFont from "temml/dist/Temml.woff2";
import { escapeHtml } from "./export";

/**
 * Temml's stylesheet, which math needs in every browser (Safari, for one, puts a display
 * formula on its own line only with it), with its small font for primes and script
 * letters embedded. For the page, and for saved conversations that contain math.
 */
export const MATH_CSS = temmlCss.replace("url('Temml.woff2')", `url('${temmlFont}')`);

/** The LaTeX as MathML, or, if it can't be read, as written, marked in red with the reason. */
export function mathHtml(tex: string, display: boolean, source: string): string {
  try {
    return temml.renderToString(tex, { displayMode: display, throwOnError: true });
  } catch (err) {
    const why = err instanceof Error ? err.message.trim() : String(err);
    return `<span class="math-error" title="${escapeHtml(why)}">${escapeHtml(source)}</span>`;
  }
}

/** The math as written, delimiters and all: for a reply still arriving, before it is drawn. */
export function mathSource(_tex: string, _display: boolean, source: string): string {
  return `<span class="math-source">${escapeHtml(source)}</span>`;
}

type MathToken = Tokens.Generic & { tex: string; display: boolean };

/** Where math might begin in some text: at a $, \( or \[. */
function mathStart(src: string): number | undefined {
  const i = src.search(/\$|\\[([]/);
  return i === -1 ? undefined : i;
}

/** Math at the very start of `src` (within a paragraph), if any. */
export function readMath(src: string): { raw: string; tex: string; display: boolean } | undefined {
  let m = /^\$\$([\s\S]+?)\$\$/.exec(src) ?? /^\\\[([\s\S]+?)\\\]/.exec(src);
  if (m) return { raw: m[0], tex: m[1]!, display: true };
  m = /^\\\(([\s\S]+?)\\\)/.exec(src);
  if (m) return { raw: m[0], tex: m[1]!, display: false };
  m = /^\$(?!\$)((?:\\[\s\S]|[^\\$`])+?)\$(?!\d)/.exec(src);
  if (m && !/^\s/.test(m[1]!) && !/\s$/.test(m[1]!)) return { raw: m[0], tex: m[1]!, display: false };
  return undefined;
}

/**
 * Teaches Markdown (marked) to recognize math and hand it to `render` (mathHtml, or
 * mathSource while a reply is arriving), before anything else touches its backslashes and
 * underscores. A formula on lines of its own may contain blank lines; one within a paragraph
 * may not.
 */
export function mathExtension(render: (tex: string, display: boolean, source: string) => string): MarkedExtension {
  return {
    extensions: [
      {
        name: "mathBlock",
        level: "block",
        start: (src) => src.match(/^ {0,3}(\$\$|\\\[)/m)?.index,
        tokenizer(src): MathToken | undefined {
          const m = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/.exec(src);
          if (!m) return undefined;
          return { type: "mathBlock", raw: m[0], tex: (m[1] ?? m[2])!, display: true };
        },
        renderer: (t) => `<p>${render((t as MathToken).tex, true, (t as MathToken).raw.trim())}</p>\n`,
      },
      {
        name: "math",
        level: "inline",
        start: mathStart,
        tokenizer(src): MathToken | undefined {
          const m = readMath(src);
          return m ? { type: "math", raw: m.raw, tex: m.tex, display: m.display } : undefined;
        },
        renderer: (t) => render((t as MathToken).tex, (t as MathToken).display, (t as MathToken).raw),
      },
    ],
  };
}
