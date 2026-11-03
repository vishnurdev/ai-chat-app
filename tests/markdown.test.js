import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../markdown.js";

test("escapes HTML so model output can't inject scripts", () => {
  const out = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.ok(!out.includes("<script>"));
  assert.ok(!out.includes("<img"));
  assert.ok(out.includes("&lt;script&gt;"));
});

test("renders code blocks without formatting their contents", () => {
  const out = renderMarkdown("```python\nx = **not bold**\n```");
  assert.equal(out, '<pre><code class="language-python">x = **not bold**</code></pre>');
});

test("unclosed code fence while streaming still renders as code", () => {
  assert.match(renderMarkdown("```js\nconst a = 1;"), /^<pre><code class="language-js">const a = 1;<\/code><\/pre>$/);
});

test("inline formatting", () => {
  const out = renderMarkdown("Use **bold**, *italic* and `a < b` here");
  assert.equal(out, "<p>Use <strong>bold</strong>, <em>italic</em> and <code>a &lt; b</code> here</p>");
});

test("lists, headings and links", () => {
  const out = renderMarkdown("## Steps\n1. One\n2. Two\n\n- a\n- b\n\n[site](https://example.com)");
  assert.match(out, /<h4>Steps<\/h4>/);
  assert.match(out, /<ol><li>One<\/li><li>Two<\/li><\/ol>/);
  assert.match(out, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(out, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">site<\/a>/);
});

test("javascript: links are not turned into links", () => {
  assert.ok(!renderMarkdown("[x](javascript:alert(1))").includes("<a"));
});
