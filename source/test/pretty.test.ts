import { test } from "node:test";
import assert from "node:assert/strict";
import { prettyHtml } from "../src/pretty";

test("the pretty-printer lays HTML out without changing what it shows", () => {
  const src =
    '<!doctype html><html><head><title>T</title><style>p{color:red}</style></head><body><main><p>One <b>bold</b>, ' +
    'then <span class="x">a span</span>.</p><pre>  keep\n    this   exactly</pre><textarea>  and\nthis</textarea>' +
    "<p>{{not a template}}</p><script>if(a<b){go()}</script></main></body></html>";
  const out = prettyHtml(src);
  assert.ok(out.split("\n").length > 10, "one element per line");
  assert.match(out, /\n {4}<main>\n {6}<p>One <b>bold<\/b>, then <span class="x">a span<\/span>\.<\/p>\n/, "indented two spaces; inline text kept together");
  assert.ok(out.includes("<pre>  keep\n    this   exactly</pre>"), "preformatted text untouched");
  assert.ok(out.includes("<textarea>  and\nthis</textarea>"));
  assert.ok(out.includes("<p>{{not a template}}</p>"));
  assert.match(out, /if \(a < b\) \{\n\s+go\(\)\n\s+\}/, "the script is laid out too");
  assert.ok(out.endsWith("</html>\n"));
  assert.equal(prettyHtml(out), out, "printing it again changes nothing");
});
