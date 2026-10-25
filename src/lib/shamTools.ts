// Gives Sham the SAME tools Nova has (GitHub, the private VM / terminal, web, memory, schedules, sub-agents, connectors...), through Nova's engine.
// Sham has no OpenAI-style tool calling and its vocabulary is fixed (a live model), so the bridge is plain text in both directions:
//   - the engine shows Sham the tools that are LOADED in the conversation (Nova's own groups: a short list, never all ~80 at once) and the call format;
//   - Sham writes a call as text:  <tool_call>{"name": "...", "arguments": {...}}</tool_call>  (also accepted: a ```json fence, or a bare JSON object whose "name" is a loaded tool);
//   - the engine runs it exactly like a Nova call (same permissions, same sandbox, same stall guard) and shows Sham the result next turn.
// Nothing is decided here by rule: if Sham writes no call, its words are the answer. Off until SHAM_TOOLS=on or SHAM_LIMITS=open (an untrained Sham should not be
// shown a format it cannot follow); SHAM_TOOLS=off always wins. The training side is ai-system/colab/sham_small/sham_tools_data.py (same text format).
import type { CoderMessage, CoderTool, CoderToolCall } from "@/lib/openCoderStudio";

export function shamToolsEnabled(): boolean {
  const t = (process.env.SHAM_TOOLS || "").trim().toLowerCase();
  if (t === "off" || t === "0") return false;
  return t === "on" || t === "1" || (process.env.SHAM_LIMITS || "").trim().toLowerCase() === "open";
}

const FORMAT_LINE = 'لاستعمال أداة اكتب سطراً واحداً بهذا الشكل ثم انتظر النتيجة: <tool_call>{"name": "اسم_الأداة", "arguments": {...}}</tool_call>. إن لم تحتج أداة فأجب مباشرة.';

/** The loaded tools as short lines: name(arg, optional?) — the first words of what it does. */
export function shamToolBlock(tools: CoderTool[], maxChars = 2400): string {
  const lines: string[] = [];
  let used = 0;
  for (const t of tools) {
    const f = t.function;
    const props = ((f.parameters as { properties?: Record<string, unknown> })?.properties || {}) as Record<string, unknown>;
    const req = new Set(((f.parameters as { required?: string[] })?.required || []) as string[]);
    const args = Object.keys(props).map((k) => (req.has(k) ? k : `${k}?`)).join(", ");
    const line = `- ${f.name}(${args}) — ${String(f.description || "").split(/[.\n]/)[0].slice(0, 70)}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  return `الأدوات المتاحة لك:\n${lines.join("\n")}\n${FORMAT_LINE}`;
}

/** Sham's text → a tool call, only for a tool that is really loaded. Returns the words around the call too. */
export function parseShamToolCalls(text: string, tools: CoderTool[]): { text: string; calls: CoderToolCall[] } {
  const known = new Set(tools.map((t) => t.function.name));
  const calls: CoderToolCall[] = [];
  let rest = text;
  const take = (raw: string): boolean => {
    try {
      const o = JSON.parse(raw);
      const name = String(o?.name ?? o?.tool ?? "");
      if (!known.has(name)) return false;
      const a = o.arguments ?? o.args ?? o.parameters ?? {};
      calls.push({ id: `sham_${Date.now().toString(36)}_${calls.length}`, type: "function", function: { name, arguments: typeof a === "string" ? a : JSON.stringify(a) } });
      return true;
    } catch { return false; }
  };
  rest = rest.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (m, raw) => (take(raw) ? "" : m));
  if (!calls.length) rest = rest.replace(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g, (m, raw) => (take(raw) ? "" : m));
  if (!calls.length && /^\s*\{[\s\S]*\}\s*$/.test(rest) && take(rest.trim())) rest = "";
  return { text: rest.trim(), calls: calls.slice(0, 4) };
}

/** The conversation as Sham reads it, with the tool block first and earlier calls / results as plain lines. Bounded by `maxChars` (the END is kept). */
export function shamToolConversation(messages: CoderMessage[], tools: CoderTool[], opts: { turns: number; turnChars: number; maxChars: number }): string {
  const lines: string[] = [];
  for (const m of messages.filter((x) => x.role !== "system").slice(-(opts.turns * 2 + 4))) {
    const c = String((m as { content?: string }).content || "").trim();
    if (m.role === "user" && c.startsWith("[harness]")) continue;
    if (m.role === "user") lines.push(`المستخدم: ${c.slice(0, opts.turnChars)}`);
    else if (m.role === "tool") lines.push(`نتيجة الأداة ${(m as { name?: string }).name || ""}:\n${c.slice(0, Math.max(opts.turnChars, 1200))}`);
    else if (m.role === "assistant") {
      const calls = ((m as { tool_calls?: CoderToolCall[] }).tool_calls || []).map((k) => `<tool_call>{"name": "${k.function.name}", "arguments": ${k.function.arguments || "{}"}}</tool_call>`);
      if (c || calls.length) lines.push(`شام: ${[c.slice(0, opts.turnChars), ...calls].filter(Boolean).join(" ")}`);
    }
  }
  const head = tools.length ? shamToolBlock(tools) + "\n\n" : "";
  const body = lines.join("\n");
  const room = Math.max(400, opts.maxChars - head.length - 6);
  return `${head}${body.length > room ? body.slice(-room) : body}\nشام:`;
}
