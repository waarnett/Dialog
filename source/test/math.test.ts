import { test } from "node:test";
import assert from "node:assert/strict";
import { Marked } from "marked";
import { MATH_CSS, mathExtension, mathHtml, mathSource, readMath } from "../src/math";

const md = new Marked(mathExtension(mathHtml));
const render = (text: string) => md.parse(text, { async: false, gfm: true }) as string;
const arriving = new Marked(mathExtension(mathSource));

test("math: Bill's examples, inline and display", () => {
  const inline = render("The square root $\\sqrt{2}$ is irrational.");
  assert.match(inline, /^<p>The square root <math><msqrt><mn>2<\/mn><\/msqrt><\/math> is irrational\.<\/p>/);

  const both = render(
    "It cannot be written as a ratio of two integers ($p/q$ where $p, q \\in \\mathbb{Z}$ and $q \\neq 0$). " +
      "It can, however, be represented exactly as an infinite continued fraction: " +
      "$$\\sqrt{2} = 1 + \\cfrac{1}{2 + \\cfrac{1}{2 + \\cfrac{1}{2 + \\cdots}}}$$",
  );
  assert.equal((both.match(/<math/g) ?? []).length, 4);
  assert.ok(both.includes("ℤ"), "\\mathbb{Z}");
  assert.ok(both.includes("≠"), "\\neq");
  assert.ok(both.includes('<math display="block"'), "$$ … $$ is a display formula, even within a paragraph");
  assert.equal((both.match(/<mfrac>/g) ?? []).length, 3, "the continued fraction");
  assert.ok(!both.includes("$"), "no dollar signs left");
});

test("math: \\( \\) inline, \\[ \\] display; a formula on lines of its own", () => {
  assert.match(render("so \\(x^2\\) grows"), /so <math><msup><mi>x<\/mi><mn[^>]*>2<\/mn><\/msup><\/math> grows/);
  assert.match(render("\\[E = mc^2\\]"), /^<p><math display="block"/);
  const own = render("Before:\n\n$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2}\n$$\n\nAfter.");
  assert.match(own, /<p>Before:<\/p>\n<p><math display="block"[^]*<\/math><\/p>\n<p>After\.<\/p>/);
});

test("math: dollar amounts stay money", () => {
  for (const text of ["It costs $5 and $10.", "Between $5-$10 a month.", "About $3.50, or $4 with tax.", "Save $20 now", "Escaped \\$x\\$ too.", "It costs $10, and `$x$` is code."]) {
    assert.ok(!render(text).includes("<math"), text);
  }
  assert.equal(readMath("$5 and $10"), undefined);
  assert.equal(readMath("$ x$"), undefined, "space after the opening $");
  assert.equal(readMath("$x $"), undefined, "space before the closing $");
  assert.deepEqual(readMath("$x$, then"), { raw: "$x$", tex: "x", display: false });
});

test("math: underscores and asterisks inside math aren't taken for emphasis; code is left alone", () => {
  const sub = render("Let $a_1 * b_2 * c_3$ be given.");
  assert.ok(!sub.includes("<em>") && sub.includes("<msub>"));
  assert.equal(render("Write `$x$` for math."), "<p>Write <code>$x$</code> for math.</p>\n");
  assert.ok(!render("```\n$$x$$\n```").includes("<math"));
});

test("math: LaTeX that can't be read is shown as written, in red, with the reason", () => {
  const html = render("Oops $\\frac{1$ here.");
  assert.match(html, /<span class="math-error" title="[^"]*expected[^"]*">\$\\frac\{1\$<\/span>/);
  // Nothing in the source gets through as HTML.
  assert.ok(!render("$\\frac{<img src=x onerror=alert(1)>$").includes("<img"));
});

test("math: while a reply arrives, its math is shown as written, with its markup intact", () => {
  const html = arriving.parse("So $a_1 * b_2$ and $$\\frac{1}{2}$$.", { async: false }) as string;
  assert.equal(html, '<p>So <span class="math-source">$a_1 * b_2$</span> and <span class="math-source">$$\\frac{1}{2}$$</span>.</p>\n');
});

test("math: the stylesheet comes with its font embedded, nothing fetched", () => {
  assert.ok(MATH_CSS.includes("math.tml-display"));
  assert.ok(MATH_CSS.includes("url('data:font/woff2;base64,"));
  assert.ok(!MATH_CSS.includes("url('Temml.woff2')"));
});
