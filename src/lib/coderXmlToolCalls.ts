/**
 * Some Nova Studio answers write the tool call as text in the Qwen XML form instead of returning it as a structured call:
 *   <tool_call><function=computer_repo><parameter=url>https://github.com/a/b</parameter></function></tool_call>
 * (seen live 2026-11-15: the run ended with that text shown to the owner and the call never ran). This rescues such calls.
 */
import type { CoderToolCall } from "@/lib/openCoderStudio";

export function rescueXmlToolCalls(text: string): { text: string; calls: CoderToolCall[] } {
  const calls: CoderToolCall[] = [];
  const rest = text.replace(/<tool_call>\s*<function=([\w.-]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g, (_m, name: string, body: string) => {
    const args: Record<string, unknown> = {};
    for (const p of body.matchAll(/<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g)) {
      const raw = p[2].replace(/^\n/, "").replace(/\n$/, "");
      let v: unknown = raw;
      if (/^(?:-?\d+(?:\.\d+)?|true|false|null|\[[\s\S]*\]|\{[\s\S]*\})$/.test(raw.trim())) { try { v = JSON.parse(raw.trim()); } catch { v = raw; } }
      args[p[1]] = v;
    }
    calls.push({ id: `xml_${calls.length}_${Date.now().toString(36)}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
    return "";
  });
  return calls.length ? { text: rest.trim(), calls } : { text, calls: [] };
}
