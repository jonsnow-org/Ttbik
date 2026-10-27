// Gives Sham the SAME tools Nova has (GitHub, the private VM / terminal, web, memory, schedules, sub-agents, connectors...), through Nova's engine.
// Sham has no OpenAI-style tool calling and its vocabulary is fixed (a live model), so the bridge is plain text in both directions:
//   - the engine shows Sham the tools that are LOADED in the conversation (Nova's own groups: a short list, never all ~80 at once) and the call format;
//   - Sham writes a call as text:  <tool_call>{"name": "...", "arguments": {...}}</tool_call>  (also accepted: a ```json fence, or a bare JSON object whose "name" is a loaded tool);
//   - the engine runs it exactly like a Nova call (same permissions, same sandbox, same stall guard) and shows Sham the result next turn.
// Nothing is decided here by rule: if Sham writes no call, its words are the answer. Off until SHAM_TOOLS=on or SHAM_LIMITS=open (an untrained Sham should not be
// shown a format it cannot follow); SHAM_TOOLS=off always wins. The training side is ai-system/colab/sham_small/sham_tools_data.py (same text format).
import type { ShamMessage as CoderMessage, ShamTool as CoderTool, ShamToolCall as CoderToolCall } from "@/lib/shamTypes";
import { shamVariant } from "@/lib/shamStudio";

export function shamToolsEnabled(): boolean {
  const t = (process.env.SHAM_TOOLS || "").trim().toLowerCase();
  if (t === "off" || t === "0") return false;
  if (shamVariant.getStore() === "v2") return true;             // the new body is made for tools: on whenever it is the model in use. The old body: SHAM_TOOLS=on (its untrained format following would otherwise hide the research sources the engine hands it)
  return t === "on" || t === "1" || (process.env.SHAM_LIMITS || "").trim().toLowerCase() === "open";
}

const FORMAT_LINE = 'لاستعمال أداة اكتب سطراً واحداً بهذا الشكل ثم انتظر النتيجة: <tool_call>{"name": "اسم_الأداة", "arguments": {...}}</tool_call>. إن لم تحتج أداة فأجب مباشرة. إن كانت معلومة ناقصة عند المستخدم (أي مستودع؟ أي فرع؟ أي ملف؟) فاسأله بـ ask_user ولا تخمّن. وإذا كتبت كوداً فجرّبه في الجهاز الافتراضي (sandbox_write_file ثم sandbox_exec) وأصلح ما يفشل قبل أن تجيب.';

/** The loaded tools as short lines: name(arg, optional?) — the first words of what it does. */
/** Which tool fits which request (measured on the new body: it read a GitHub file with the VM tool, did not save a memory, and opened a PR instead of pushing). Shown only for tools that are loaded. */
const EXAMPLES: [string, string][] = [
  ["github_read_file", "قراءة ملف من مستودع GitHub ← github_read_file(repo, path)"],
  ["memory_save", "«تذكّر أن…» ← memory_save(text)"],
  ["sandbox_push", "رفع التعديلات إلى GitHub ← sandbox_push(repo, branch, message)"],
  ["web_search", "معلومة حديثة ← web_search(query)"],
  ["sandbox_write_file", "كود يُكتب ويُجرَّب ← sandbox_write_file ثم sandbox_exec"],
  ["make_media", "صورة أو صوت أو فيديو ← make_media(kind, prompt)"],
];

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
  const has = new Set(tools.map((t) => t.function.name));
  const ex = EXAMPLES.filter(([n]) => has.has(n)).map(([, text]) => text);
  // the new body (room for ~1200 prompt tokens) also gets the two details its real CPU run got wrong; the old 384-token body has no spare room
  if (shamVariant.getStore() === "v2") {
    const i = ex.findIndex((t) => t.includes("github_read_file")), j = ex.findIndex((t) => t.includes("sandbox_write_file"));
    if (i >= 0) ex[i] += ' (repo="owner/name")';
    if (j >= 0) ex[j] += "؛ الاختبارات: python3 -m unittest -v f (اسم الوحدة بلا .py)";
  }
  return `الأدوات المتاحة لك:\n${lines.join("\n")}\n${FORMAT_LINE}${ex.length ? `\nأمثلة على اختيار الأداة: ${ex.join("؛ ")}.` : ""}`;
}

/** Harmless spelling of an argument the model gets "almost" right is fixed here instead of failing the call: a GitHub URL / `.git` / trailing slash in `repo`. */
export function normaliseShamArgs(a: unknown): unknown {
  if (!a || typeof a !== "object" || Array.isArray(a)) return a;
  const o = { ...(a as Record<string, unknown>) };
  // `python3 -m unittest -v stack.py` runs nothing (unittest wants the module name): the real CPU run showed the model writing it that way every time
  if (typeof o.command === "string") o.command = o.command.replace(/(-m\s+unittest(?:\s+-[\w-]+)*\s+)((?:[\w-]+\/)*[\w-]+)\.py\b/g, (_m, pre: string, mod: string) => pre + mod.replace(/\//g, "."));
  if (typeof o.repo === "string") o.repo = o.repo.trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "").split("/").slice(0, 2).join("/");
  // the owner and the repo name split across `repo` and `path` ("octocat" + "Hello-World/README.md") are put back together
  if (typeof o.repo === "string" && /^[\w.-]+$/.test(o.repo) && typeof o.path === "string" && /^[\w.-]+\/.+/.test(o.path)) {
    const i = o.path.indexOf("/");
    o.repo = `${o.repo}/${o.path.slice(0, i)}`;
    o.path = o.path.slice(i + 1);
  }
  return o;
}

/** Sham's text → a tool call, only for a tool that is really loaded. Returns the words around the call too. */
export function parseShamToolCalls(text: string, tools: CoderTool[]): { text: string; calls: CoderToolCall[] } {
  const known = new Set(tools.map((t) => t.function.name));
  const calls: CoderToolCall[] = [];
  // the body goes on to INVENT the tool's result ("نتيجة الأداة x: ...") and even further calls after a real one: everything after the first such line is its own fiction, never real
  const inv = text.search(/\n\s*نتيجة الأداة/);
  let rest = inv > 0 ? text.slice(0, inv) : text;
  const take = (raw: string): boolean => {
    try {
      const o = JSON.parse(raw);
      const name = String(o?.name ?? o?.tool ?? "");
      if (!known.has(name)) return false;
      const a = normaliseShamArgs(o.arguments ?? o.args ?? o.parameters ?? {});
      calls.push({ id: `sham_${Date.now().toString(36)}_${calls.length}`, type: "function", function: { name, arguments: typeof a === "string" ? a : JSON.stringify(a) } });
      return true;
    } catch { return false; }
  };
  rest = rest.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (m, raw) => (take(raw) ? "" : m));
  if (!calls.length) rest = rest.replace(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g, (m, raw) => (take(raw) ? "" : m));
  // the body often echoes its own speaker label in front of a bare call ("شام: {"name": ...}"): the label is not part of the call
  if (!calls.length) { const bare = rest.replace(/^\s*(?:شام|sham)\s*[:：]\s*/i, ""); if (/^\s*\{[\s\S]*\}\s*$/.test(bare) && take(bare.trim())) rest = ""; }
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


type Schema = { type?: string; enum?: unknown[]; pattern?: string };
const typeOk = (v: unknown, t?: string): boolean => {
  if (!t) return true;
  if (t === "string") return typeof v === "string";
  if (t === "number" || t === "integer") return typeof v === "number" && (t === "number" || Number.isInteger(v));
  if (t === "boolean") return typeof v === "boolean";
  if (t === "array") return Array.isArray(v);
  if (t === "object") return typeof v === "object" && v !== null && !Array.isArray(v);
  return true;
};

/** Checks a call BEFORE it runs: a loaded tool, a JSON object of arguments, every required argument present and non-empty, types and enums right, no unknown names.
 *  Returns the error to hand back to Sham (it corrects itself) or null when the call is sound. */
export function validateShamCall(call: CoderToolCall, tools: CoderTool[]): string | null {
  const tool = tools.find((t) => t.function.name === call.function.name);
  if (!tool) return `الأداة ${call.function.name} غير محمّلة.`;
  let args: unknown;
  try { args = JSON.parse(call.function.arguments || "{}"); } catch { return `معاملات ${call.function.name} ليست JSON صحيحاً.`; }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return `معاملات ${call.function.name} يجب أن تكون كائناً {…}.`;
  const a = args as Record<string, unknown>;
  const params = tool.function.parameters as { properties?: Record<string, Schema>; required?: string[] } | undefined;
  const props = params?.properties || {};
  const problems: string[] = [];
  for (const k of params?.required || []) {
    const v = a[k];
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) problems.push(`المعامل المطلوب «${k}» ناقص`);
  }
  for (const [k, v] of Object.entries(a)) {
    const sch = props[k];
    if (!sch) { if (Object.keys(props).length) problems.push(`المعامل «${k}» غير موجود في ${call.function.name}`); continue; }
    if (!typeOk(v, sch.type)) problems.push(`المعامل «${k}» يجب أن يكون من نوع ${sch.type}`);
    else if (sch.enum && !sch.enum.includes(v)) problems.push(`المعامل «${k}» يقبل فقط: ${sch.enum.join(" | ")}`);
    else if (sch.pattern && typeof v === "string" && !new RegExp(sch.pattern).test(v)) problems.push(`المعامل «${k}» غير صحيح («${v.slice(0, 40)}»): الصيغة المطلوبة ${k === "repo" ? "owner/name مثل octocat/Hello-World" : sch.pattern}`);
  }
  return problems.length ? `${call.function.name}: ${problems.join("؛ ")}.` : null;
}

/** A `<tool_call>` that is still in the words after parsing is a call Sham tried to write and did not get right (bad JSON, unknown tool). */
export function brokenCallAttempt(leftover: string): boolean {
  // also a call that was CUT OFF by the Studio's answer limit (`{"name": "sandbox_write_file", "arguments": {"path": ...` with no end): it is shown to the user as raw JSON otherwise
  return /<tool_call>/.test(leftover) || /^\s*(?:```(?:json)?\s*)?\{\s*"name"\s*:\s*"[A-Za-z_]+"/.test(leftover);
}

/** What the engine tells Sham when its call cannot run. Not an answer to the user: only the reason, so the model rewrites the call (or asks the user for what is missing). */
export function shamCorrectionNote(problems: string[]): string {
  return `[تصحيح من المحرك] لم يُنفَّذ الاستدعاء: ${problems.join(" ")} أعد كتابته صحيحاً بالصيغة <tool_call>{"name": "...", "arguments": {...}}</tool_call>. وإن كانت المعلومة الناقصة عند المستخدم فاسأله بـ ask_user بدل التخمين.`;
}

const CODE_FENCE = /```(?:python|py|js|javascript|ts|typescript|bash|sh|java|c|cpp|go|rust)\b[\s\S]{20,}?```/i;

/** Sham wrote code in its answer but never ran it in the computer during this request, although the computer's tools are loaded. */
export function codeNotTried(text: string, messages: CoderMessage[], tools: CoderTool[]): boolean {
  if (!CODE_FENCE.test(text)) return false;
  const names = new Set(tools.map((t) => t.function.name));
  if (!names.has("sandbox_exec") || !names.has("sandbox_write_file")) return false;
  let i = messages.length - 1;
  while (i >= 0 && !(messages[i].role === "user" && !String((messages[i] as { content?: string }).content || "").startsWith("[harness]"))) i--;
  return !messages.slice(Math.max(0, i)).some((m) => m.role === "tool" && (m as { name?: string }).name === "sandbox_exec");
}

export const SHAM_CODE_NOTE = "[تصحيح من المحرك] كتبتَ كوداً ولم تجرّبه، وكتابة الكود في الرد لا تُشغّله. اكتب سطراً واحداً بالصيغة الحرفية هكذا ثم انتظر: <tool_call>{\"name\": \"sandbox_write_file\", \"arguments\": {\"path\": \"main.py\", \"content\": \"...الكود...\"}}</tool_call> وبعده شغّله بـ sandbox_exec وأصلح ما يفشل، ثم أجب.";
