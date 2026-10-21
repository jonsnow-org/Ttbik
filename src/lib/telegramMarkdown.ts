// The coding model writes Markdown (**bold**, ### headings, `code`, ``` blocks, [links](url), lists). Telegram shows that raw unless it is
// sent with a parse mode, and its own MarkdownV2 rejects most model output. So a reply is converted to Telegram's HTML subset
// (b, i, s, code, pre, a, blockquote), with everything else escaped; when that fails the plain text goes out with the marks removed.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

/** Inline Markdown of one line (already outside code blocks) as Telegram HTML. */
function inline(line: string): string {
  const codes: string[] = [];
  // inline code first: its content is literal
  let s = line.replace(/`([^`\n]+)`/g, (_m, c: string) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  const links: string[] = [];
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t: string, u: string) => {
    links.push(`<a href="${escAttr(u)}">${esc(t)}</a>`);
    return `\u0001${links.length - 1}\u0001`;
  });
  s = esc(s);
  s = s.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, "<b>$1</b>").replace(/__(?=\S)([^_\n]*?\S)__/g, "<b>$1</b>");
  s = s.replace(/~~(?=\S)([^~\n]*?\S)~~/g, "<s>$1</s>");
  s = s.replace(/(^|[\s(])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?=[\s).,!?؟،:;]|$)/g, "$1<i>$2</i>");
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => links[Number(i)]);
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]);
}

/** Model Markdown → Telegram HTML (parse_mode "HTML"). Unbalanced fences are closed. */
export function markdownToTelegramHtml(md: string): string {
  const out: string[] = [];
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  let inCode = false;
  let lang = "";
  let code: string[] = [];
  let quote: string[] = [];
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.join("\n")}</blockquote>`);
    quote = [];
  };
  for (const line of lines) {
    const fence = /^\s*```\s*([\w#+.-]*)\s*$/.exec(line);
    if (inCode) {
      if (fence && !fence[1]) {
        out.push(lang ? `<pre><code class="language-${escAttr(lang)}">${esc(code.join("\n"))}</code></pre>` : `<pre>${esc(code.join("\n"))}</pre>`);
        inCode = false;
        code = [];
      } else code.push(line);
      continue;
    }
    if (fence) {
      flushQuote();
      inCode = true;
      lang = fence[1] || "";
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      quote.push(inline(q[1]));
      continue;
    }
    flushQuote();
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      out.push(`<b>${inline(h[1].replace(/^\*\*(.*)\*\*$/, "$1"))}</b>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("──────────");
      continue;
    }
    const li = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (li) {
      out.push(`${li[1]}• ${inline(li[2])}`);
      continue;
    }
    out.push(inline(line));
  }
  flushQuote();
  if (inCode) out.push(lang ? `<pre><code class="language-${escAttr(lang)}">${esc(code.join("\n"))}</code></pre>` : `<pre>${esc(code.join("\n"))}</pre>`);
  return out.join("\n");
}

/** The same reply as plain text with the Markdown marks removed (the fallback when Telegram refuses the HTML). */
export function stripMarkdown(md: string): string {
  return String(md || "")
    .replace(/^\s*```[\w#+.-]*\s*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, "$1")
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");
}
