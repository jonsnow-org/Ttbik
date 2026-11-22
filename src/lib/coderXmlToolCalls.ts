/**
 * Some Nova Studio answers write the tool call as text in the Qwen XML form instead of returning it as a structured call:
 *   <tool_call><function=computer_repo><parameter=url>https://github.com/a/b</parameter></function></tool_call>
 * Live 2026-11-15/16: the Studio often cuts the text in the middle of the closing tags (`…</parameter>\n</` or `…</function`), so the closers are
 * missing, and the raw markup was shown to the owner while the call never ran. This rescues such calls and strips the markup from the visible text.
 * A call is run only when every parameter it opened was closed (a half-written parameter, e.g. file content, is never executed).
 */
import type { CoderToolCall } from "@/lib/openCoderStudio";

const START = /<tool_call>|<function=/g;

export function rescueXmlToolCalls(text: string): { text: string; calls: CoderToolCall[] } {
  const calls: CoderToolCall[] = [];
  let out = "";
  let pos = 0;
  START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = START.exec(text))) {
    const from = m.index;
    if (from < pos) continue;
    // the call runs to its </tool_call>, else to the next call, else to the end of the text
    const closer = text.indexOf("</tool_call>", from);
    const nextOpen = text.indexOf("<tool_call>", from + 1);
    let to = text.length;
    if (closer >= 0) to = closer + "</tool_call>".length;
    if (nextOpen >= 0 && nextOpen < to && (closer < 0 || nextOpen < closer)) to = nextOpen;
    const block = text.slice(from, to);
    const fn = /<function=([\w.-]+)>/.exec(block);
    if (!fn) { continue; }
    const body = block.slice(fn.index + fn[0].length);
    const opened = (body.match(/<parameter=/g) || []).length;
    const params = [...body.matchAll(/<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g)];
    out += text.slice(pos, from);
    pos = to;
    START.lastIndex = to;
    if (params.length === opened) {      // every opened parameter is closed: safe to run
      const args: Record<string, unknown> = {};
      for (const p of params) {
        const raw = p[2].replace(/^\n/, "").replace(/\n$/, "");
        let v: unknown = raw;
        if (/^(?:-?\d+(?:\.\d+)?|true|false|null|\[[\s\S]*\]|\{[\s\S]*\})$/.test(raw.trim())) { try { v = JSON.parse(raw.trim()); } catch { v = raw; } }
        args[p[1]] = v;
      }
      calls.push({ id: `xml_${calls.length}_${Date.now().toString(36)}`, type: "function", function: { name: fn[1], arguments: JSON.stringify(args) } });
    }
  }
  if (!calls.length && pos === 0) return { text, calls: [] };
  out += text.slice(pos);
  // what the Studio's cut left behind: a dangling "</", "</function", "</tool_call"
  out = out.replace(/<\/?(?:tool_call|function|parameter)?[^>\n]{0,12}$/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text: out, calls };
}

/** What may be shown to the user while the model is still writing: everything before the first tool-call markup (a complete one, or the start of one
 *  such as "<tool_c" cut mid-token). Live 2026-11-22: Nova 2's call was streamed to Telegram as raw "<tool_call><function=delegate>…" before it was rescued and run. */
export function hideToolMarkup(text: string): string {
  const i = text.search(/<tool_call>|<function=/);
  let out = i >= 0 ? text.slice(0, i) : text;
  const tail = /<[a-z_/=]{0,11}$/.exec(out);
  let cut = i >= 0;
  if (tail && ("<tool_call>".startsWith(tail[0]) || "<function=".startsWith(tail[0]))) { out = out.slice(0, tail.index); cut = true; }
  return cut ? out.trimEnd() : out;
}
