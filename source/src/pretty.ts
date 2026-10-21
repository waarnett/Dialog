// The pretty-printer for every HTML file Dialog writes: this page and README.html when they
// are built (build.mjs), and, in the browser, saved conversations and the HTML files the
// participants make. It only lays the source out (line breaks and two-space indenting);
// what a browser shows is unchanged. Text inside <pre> and <textarea> is left exactly as is.

import beautify from "js-beautify";

export const PRETTY_OPTIONS = {
  indent_size: 2,
  indent_inner_html: true, // indent <head> and <body> inside <html>
  wrap_line_length: 100, // long lines are broken at spaces, never inside a word
  max_preserve_newlines: 1, // at most one blank line in a row
  end_with_newline: true,
  templating: ["none"], // text like {{name}} is ordinary text, not a template language
  // Scripts and styles inside a page: laid out the same way, without a blank line at the end.
  js: { end_with_newline: false },
  css: { end_with_newline: false },
} as const;

/** The same HTML, laid out for reading. If the formatter fails, the HTML comes back as it was. */
export function prettyHtml(html: string): string {
  try {
    return beautify.html(html, { ...PRETTY_OPTIONS, templating: [...PRETTY_OPTIONS.templating] });
  } catch {
    return html;
  }
}
