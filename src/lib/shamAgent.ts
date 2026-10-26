// Sham's OWN agent loop (owner, 2026-10-26: "Sham must own everything"). It lives with Sham, not with Nova's engine:
//   - its own conversation format (shamTools.ts: the tool block + "المستخدم: … / شام: <tool_call>… / نتيجة الأداة …"),
//   - its own tool selection (SHAM_TOOL_NAMES below: what Sham may use, chosen here, not by Nova's tool-group loader),
//   - its own correction rounds (a wrong call goes back to Sham with the reason: validateShamCall), its own time budget and step limit,
//   - its own Studio (shamGenerateAny: the old or the new body, whichever the chat chose; its thinking / accuracy / speed settings ride with every call).
// What it shares with Nova is only the plain executor functions that actually fetch a web page, read a GitHub file or write a memory (runTool in coderAgent.ts):
// library code, like `fetch`; no Nova model, no Nova prompt, no Nova Studio and no Nova run state is touched.
// Phase 1: web, GitHub reading, memory, schedules and "ask the user". Phase 2 (here): Sham's own virtual computer (its own VM per chat, named `sham:…`, never Nova's):
// clone, run, write, edit, search, read. Pushing / opening PRs needs the user's approval flow and comes with the continuation phase.
import { GITHUB_TOOLS, ASK_USER_TOOL, githubClient, runTool, toolGroups, type ToolCtx } from "@/lib/coderAgent";
import { prismaDb, resolveConnections, tierFor, coderChatKey, type Db } from "@/lib/coderAuth";
import type { CoderMessage, CoderTool, CoderToolCall } from "@/lib/openCoderStudio";
import { shamGenerateAny, shamVariant, type ShamReply } from "@/lib/shamStudio";
import { SHAM_CODE_NOTE, brokenCallAttempt, codeNotTried, parseShamToolCalls, shamCorrectionNote, shamToolConversation, validateShamCall } from "@/lib/shamTools";
import { shamKnobs, type ShamMode } from "@/lib/shamModes";

/** What Sham may use in this phase. */
export const SHAM_TOOL_NAMES = [
  "web_search", "fetch_page", "web_fetch", "deep_research",
  "github_read_file", "github_list_files", "github_repo_scan", "github_search_code",
  "memory_save", "memory_search", "memory_note",
  "schedule_create", "schedule_list", "schedule_delete",
  "sandbox_clone", "sandbox_exec", "sandbox_wait", "sandbox_write_file", "sandbox_edit_file", "sandbox_search", "sandbox_read_file",
  "ask_user",
] as const;

/** The tool definitions Sham is shown: the names above that exist, GitHub only when this chat can read it. */
export function shamToolDefs(github: boolean): CoderTool[] {
  const all = [...Object.values(toolGroups(github, false)).flat(), ...(github ? GITHUB_TOOLS : []), ASK_USER_TOOL];
  const seen = new Set<string>();
  const out: CoderTool[] = [];
  for (const n of SHAM_TOOL_NAMES) {
    const t = all.find((x) => x.function.name === n);
    if (t && !seen.has(n)) { seen.add(n); out.push(t); }
  }
  return out;
}

export type ShamAgentResult =
  | { kind: "text"; text: string; used: string[]; steps: number }
  | { kind: "ask"; question: string; used: string[]; steps: number }
  | { kind: "reply"; reply: ShamReply; used: string[]; steps: number }       // Sham answered with a picture / sound / clip of its own: the caller sends it
  | { kind: "none"; used: string[]; steps: number };                          // the Studio did not answer in the time left

export type ShamAsk = (prompt: string, maxNew: number, timeoutMs: number) => Promise<ShamReply | null>;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export async function shamAgentRun(opts: {
  text: string;
  history?: { q: string; a: string }[];
  ctx: ToolCtx;
  tools: CoderTool[];
  budgetMs: number;
  maxSteps?: number;
  maxNew?: number;
  mode?: ShamMode;
  ask?: ShamAsk;
  exec?: (call: CoderToolCall, ctx: ToolCtx) => Promise<string>;
  now?: () => number;
}): Promise<ShamAgentResult> {
  const now = opts.now || Date.now;
  const t0 = now();
  const left = () => opts.budgetMs - (now() - t0);
  const k = shamKnobs(opts.mode, shamVariant.getStore());
  const maxNew = Math.max(20, opts.maxNew || 160);
  const ask: ShamAsk = opts.ask || ((p, n, t) => shamGenerateAny(p, n, t));
  const exec = opts.exec || runTool;
  const maxSteps = opts.maxSteps ?? 4;
  const used: string[] = [];
  const messages: CoderMessage[] = [];
  for (const h of (opts.history || []).slice(-4)) { messages.push({ role: "user", content: h.q }, { role: "assistant", content: h.a }); }
  messages.push({ role: "user", content: opts.text });
  const lim = { turns: 6, turnChars: 400, maxChars: 3600 };
  let steps = 0;

  for (; steps < maxSteps; steps++) {
    if (left() < 6000) break;
    const prompt = k.note ? `${k.note}\n${shamToolConversation(messages, opts.tools, lim)}` : shamToolConversation(messages, opts.tools, lim);
    let reply = await ask(prompt, maxNew, Math.min(30000, left() - 1000));
    if (!reply) return { kind: "none", used, steps };
    if (reply.type !== "text") return { kind: "reply", reply, used, steps };
    let text = String(reply.text || "");
    let p = parseShamToolCalls(text, opts.tools);
    // a wrong or incomplete call goes back to Sham with the reason (its own correction rounds, set by the user's accuracy mode)
    for (let fix = 0; fix < k.corrections && left() > 8000; fix++) {
      const problems = p.calls.map((c) => validateShamCall(c, opts.tools)).filter((e): e is string => Boolean(e));
      if (!p.calls.length && brokenCallAttempt(p.text)) problems.push("الصيغة غير صحيحة (JSON مكسور أو أداة غير محمّلة).");
      const note = problems.length ? shamCorrectionNote(problems) : !p.calls.length && codeNotTried(p.text, messages, opts.tools) ? SHAM_CODE_NOTE : "";
      if (!note) break;
      const again = await ask(`${prompt.replace(/\nشام:$/, "")}\nشام: ${text.slice(0, 600)}\n${note}\nشام:`, maxNew, Math.min(30000, left() - 1000));
      if (!again || again.type !== "text" || !(again.text || "").trim()) break;
      text = String(again.text);
      p = parseShamToolCalls(text, opts.tools);
    }
    const valid = p.calls.filter((c) => !validateShamCall(c, opts.tools));
    if (!valid.length) {
      const final = (p.text || text).trim();
      return final ? { kind: "text", text: final, used, steps: steps + 1 } : { kind: "none", used, steps: steps + 1 };
    }
    const asked = valid.find((c) => c.function.name === "ask_user");
    if (asked) {
      let q = "";
      try { q = String((JSON.parse(asked.function.arguments || "{}") as { question?: string }).question || ""); } catch { /* the validator already checked it */ }
      return { kind: "ask", question: q, used, steps: steps + 1 };
    }
    messages.push({ role: "assistant", content: p.text, tool_calls: valid.slice(0, 3) } as CoderMessage);
    for (const c of valid.slice(0, 3)) {
      used.push(c.function.name);
      let result: string;
      try { result = await exec(c, opts.ctx); } catch (e) { result = `error: ${(e as Error).message || "tool failed"}`; }
      messages.push({ role: "tool", name: c.function.name, tool_call_id: c.id, content: clip(String(result), 1800) } as CoderMessage);
    }
  }

  // out of steps or time: ask for the final answer from what was found, with no tools shown
  if (left() > 5000 && used.length) {
    const prompt = shamToolConversation(messages, [], lim).replace(/\nشام:$/, "\n[اكتب الجواب النهائي الآن مما وجدتَه، بلا استدعاء أدوات.]\nشام:");
    const r = await ask(prompt, maxNew, Math.min(25000, left() - 500));
    if (r && r.type === "text" && (r.text || "").trim()) return { kind: "text", text: String(r.text).trim(), used, steps };
  }
  return { kind: "none", used, steps };
}


/** Is Sham's agent loop on for the Sham in use? SHAM_AGENT=on / off; unset = the new body only (the old body is switched on once its tool calls prove reliable). */
export function shamAgentOn(): boolean {
  const e = (process.env.SHAM_AGENT || "").trim().toLowerCase();
  if (e === "off" || e === "0") return false;
  if (e === "on" || e === "1") return true;
  return shamVariant.getStore() === "v2";
}

/** The executor context for this chat: its own linked GitHub token (the owner's for the owner), its memory, its time zone. */
export async function shamToolCtx(chatId: number, botId?: string, db: Db = prismaDb): Promise<ToolCtx> {
  const conn = await resolveConnections(chatId, db);
  return {
    tier: tierFor(chatId), runId: `sham-${chatId}`, chatKey: `sham:${coderChatKey(chatId)}`, userId: chatId, botId, db,
    githubToken: conn.github?.token || null, gh: conn.github ? githubClient(conn.github.token) : null, addNote: () => undefined,
  } as ToolCtx;
}
