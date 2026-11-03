// Tiny, safe Markdown renderer (no dependencies).
// All text is HTML-escaped first, so model output can never inject HTML or scripts.
// Supports: fenced code blocks, inline code, headings, bold, italic, links,
// bullet & numbered lists, blockquotes, horizontal rules and paragraphs.

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function inline(text) {
  const codes = [];
  let out = escapeHtml(text).replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

export function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let para = [];
  let list = null; // { type: "ul" | "ol", items: [] }

  const flushPara = () => {
    if (para.length) html.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
    if (fence) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      const lang = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      html.push(`<pre><code${lang}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue; // an unclosed fence (still streaming) simply runs to the end
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 2, 6); // keep headings small in chat
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); html.push("<hr>"); continue; }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flush(); html.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }

    if (!line.trim()) { flush(); continue; }
    flushList();
    para.push(line);
  }
  flush();
  return html.join("");
}
