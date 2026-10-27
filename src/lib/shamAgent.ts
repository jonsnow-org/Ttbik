// Sham's OWN agent loop (owner, 2026-10-26: "Sham must own everything"). It lives with Sham, not with Nova's engine:
//   - its own conversation format (shamTools.ts: the tool block + "المستخدم: … / شام: <tool_call>… / نتيجة الأداة …"),
//   - its own tool selection (SHAM_TOOL_NAMES below: what Sham may use, chosen here, not by Nova's tool-group loader),
//   - its own correction rounds (a wrong call goes back to Sham with the reason: validateShamCall), its own time budget and step limit,
//   - its own Studio (shamGenerateAny: the old or the new body, whichever the chat chose; its thinking / accuracy / speed settings ride with every call).
// Its tools and their executors are Sham's own too (shamExec.ts): the guarded web fetch, the VM driver, memory and schedules are called as plain libraries,
// GitHub is spoken to directly; the VM, memory scope and run id are Sham's (`sham:<chat>` / `sham-<chat>`), never Nova's. No Nova engine, prompt, Studio or run state is touched.
// A write to the user's repository (push, open / merge a pull request) ends the round with kind "confirm": the user taps before anything runs.
import type { CoderMessage, CoderTool, CoderToolCall } from "@/lib/openCoderStudio";
import { SHAM_NEEDS_OK, SHAM_TOOLS, shamContext, shamRunTool, shamTools, type ShamCtx } from "@/lib/shamExec";
import { shamMediaRoute, type ShamMediaRoute } from "@/lib/shamExec";
import { shamGenerateAny, shamGenerateMedia, shamNoteFailure, shamVariant, type ShamReply } from "@/lib/shamStudio";
import { SHAM_CODE_NOTE, brokenCallAttempt, codeNotTried, parseShamToolCalls, shamCorrectionNote, shamToolConversation, validateShamCall } from "@/lib/shamTools";
import { shamKnobs, type ShamMode } from "@/lib/shamModes";

/** What Sham may use: its own tools (shamExec.ts). */
export const SHAM_TOOL_NAMES = SHAM_TOOLS.map((t) => t.function.name);
/** The tool definitions Sham is shown: GitHub ones only when this chat can use it. */
export const shamToolDefs = shamTools;

export type ShamAgentResult =
  | { kind: "text"; text: string; used: string[]; steps: number }
  | { kind: "ask"; question: string; used: string[]; steps: number }
  | { kind: "reply"; reply: ShamReply; used: string[]; steps: number }       // Sham answered with a picture / sound / clip of its own: the caller sends it
  | { kind: "confirm"; call: CoderToolCall; used: string[]; steps: number }   // a write to the user's repository: the user is asked before it runs
  | { kind: "more"; messages: CoderMessage[]; used: string[]; steps: number }   // not finished inside this leg: the state goes to the next leg (the shared background runner)
  | { kind: "none"; used: string[]; steps: number };                          // the Studio did not answer in the time left

export type ShamAsk = (prompt: string, maxNew: number, timeoutMs: number) => Promise<ShamReply | null>;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export async function shamAgentRun(opts: {
  text: string;
  history?: { q: string; a: string }[];
  ctx: ShamCtx;
  tools: CoderTool[];
  budgetMs: number;
  maxSteps?: number;
  maxNew?: number;
  mode?: ShamMode;
  ask?: ShamAsk;
  media?: (kind: "image" | "audio" | "video", prompt: string) => Promise<ShamReply | null>;      // Sham's own media models (default: shamGenerateMedia)
  exec?: (call: CoderToolCall, ctx: ShamCtx) => Promise<string>;
  now?: () => number;
  resume?: CoderMessage[];                  // the earlier legs' conversation (tool calls and results so far)
  onEvent?: (kind: "tool" | "info" | "text", text: string) => void;   // what the terminal shows of this run (the shared task log)
  askMs?: number;                           // the longest wait for one Studio answer (default 30 s inside the webhook; the background legs wait much longer)
  continuable?: boolean;                    // true: out of time / steps with work still going = hand over to the next leg instead of answering now
}): Promise<ShamAgentResult> {
  const now = opts.now || Date.now;
  const t0 = now();
  const left = () => opts.budgetMs - (now() - t0);
  const k = shamKnobs(opts.mode, shamVariant.getStore());
  const maxNew = Math.max(20, opts.maxNew || 160);
  const ask: ShamAsk = opts.ask || ((p, n, t) => shamGenerateAny(p, n, t));
  const exec = opts.exec || ((c, x) => shamRunTool(c, x));
  const maxSteps = opts.maxSteps ?? 4;
  const used: string[] = [];
  const messages: CoderMessage[] = opts.resume ? [...opts.resume] : [];
  if (!opts.resume) {
    for (const h of (opts.history || []).slice(-4)) { messages.push({ role: "user", content: h.q }, { role: "assistant", content: h.a }); }
    messages.push({ role: "user", content: opts.text });
  }
  const lim = { turns: 6, turnChars: 400, maxChars: 3600 };
  let steps = 0;
  const runMedia = async (call: CoderToolCall, usedNow: string[], stepNow: number): Promise<ShamAgentResult> => {
    let a: { kind?: string; prompt?: string } = {};
    try { a = JSON.parse(call.function.arguments || "{}"); } catch { /* validated already */ }
    const kind = (["image", "audio", "video"].includes(String(a.kind)) ? a.kind : "image") as "image" | "audio" | "video";
    opts.onEvent?.("tool", `make_media ${kind}: ${String(a.prompt || "").slice(0, 80)}`);
    const r = await (opts.media || defaultMedia)(kind, String(a.prompt || "").slice(0, 600));
    return r ? { kind: "reply", reply: r, used: usedNow, steps: stepNow } : { kind: "none", used: usedNow, steps: stepNow };
  };
  // Three independently selectable paths: the original Sham Studio, Sham v2's donor-weight Studio,
  // and the dedicated Media Studio. The panel-selected route runs first; only an unavailable or
  // failed route falls through to the remaining configured routes.
  const defaultMedia = async (k: "image" | "audio" | "video", pr: string): Promise<ShamReply | null> => {
    const total = Math.min(240000, Math.max(20000, left() - 3000));
    const nm = await import("@/lib/novaMedia");
    const selected = await shamMediaRoute();
    const order: ShamMediaRoute[] =
      selected === "sham_v1" ? ["sham_v1", "sham_v2", "nova_media"] :
      selected === "nova_media" ? ["nova_media", "sham_v2", "sham_v1"] :
      ["sham_v2", "sham_v1", "nova_media"];
    const good = (r: ShamReply | null): r is ShamReply =>
      Boolean(r && (r.type === "image" || r.type === "audio" || r.type === "video") && r.b64);
    const started = Date.now();
    let last: ShamReply | null = null;
    for (let i = 0; i < order.length; i++) {
      const remaining = total - (Date.now() - started);
      if (remaining < 8000) break;
      const reserveMs = (order.length - i - 1) * 20000;
      const capMs = i === 0 ? 150000 : i === 1 ? 90000 : 240000;
      const timeoutMs = Math.max(8000, Math.min(capMs, remaining - reserveMs));
      let reply: ShamReply | null = null;
      if (order[i] === "nova_media") {
        if (!nm.novaMediaEnabled()) continue;
        const result = await nm.novaMakeMedia(k, pr, { timeoutMs });
        reply = result ? (result as ShamReply) : null;
      } else {
        const variant = order[i] === "sham_v1" ? "v1" : "v2";
        reply = await shamVariant.run(variant, () => shamGenerateMedia(k, pr, timeoutMs));
      }
      if (good(reply)) return reply;
      if (reply) last = reply;
    }
    return last;
  };
  const tail = messages[messages.length - 1] as { role?: string; tool_calls?: CoderToolCall[] } | undefined;
  const pendingMedia = opts.resume && tail?.role === "assistant" ? tail.tool_calls?.find((c) => c.function.name === "make_media") : undefined;
  if (pendingMedia) return runMedia(pendingMedia, ["make_media"], 1);       // the earlier leg asked for it: run it now, with the long wait

  for (; steps < maxSteps; steps++) {
    if (left() < 6000) break;
    const prompt = k.note ? `${k.note}\n${shamToolConversation(messages, opts.tools, lim)}` : shamToolConversation(messages, opts.tools, lim);
    let reply = await ask(prompt, maxNew, Math.min(opts.askMs ?? 30000, left() - 1000));
    if (!reply) return opts.continuable && steps === 0 ? { kind: "more", messages, used, steps } : { kind: "none", used, steps };      // the Studio is slow (CPU): the background leg waits longer instead of giving up
    if (reply.type !== "text") return { kind: "reply", reply, used, steps };
    let text = String(reply.text || "");
    let p = parseShamToolCalls(text, opts.tools);
    // a wrong or incomplete call goes back to Sham with the reason (its own correction rounds, set by the user's accuracy mode)
    for (let fix = 0; fix < k.corrections && left() > 8000; fix++) {
      const problems = p.calls.map((c) => validateShamCall(c, opts.tools)).filter((e): e is string => Boolean(e));
      if (!p.calls.length && brokenCallAttempt(p.text)) problems.push("الصيغة غير صحيحة (JSON مكسور أو أداة غير محمّلة).");
      const note = problems.length ? shamCorrectionNote(problems) : !p.calls.length && codeNotTried(p.text, messages, opts.tools) ? SHAM_CODE_NOTE : "";
      if (!note) break;
      const again = await ask(`${prompt.replace(/\nشام:$/, "")}\nشام: ${text.slice(0, 600)}\n${note}\nشام:`, maxNew, Math.min(opts.askMs ?? 30000, left() - 1000));
      if (!again || again.type !== "text" || !(again.text || "").trim()) break;
      text = String(again.text);
      p = parseShamToolCalls(text, opts.tools);
    }
    const valid = p.calls.filter((c) => !validateShamCall(c, opts.tools));
    if (!valid.length) {
      const final = (p.text || text).trim();
      if (!final) shamNoteFailure(`the Studio answered with empty text (raw: ${JSON.stringify(text).slice(0, 80)})`);
      return final ? { kind: "text", text: final, used, steps: steps + 1 } : { kind: "none", used, steps: steps + 1 };
    }
    const made = valid.find((c) => c.function.name === "make_media");
    if (made) {
      // a picture / sound / clip takes minutes on the CPU Studio (measured: 123 s for a 256x256 picture): inside the webhook it goes to the background leg, which waits long
      if (opts.continuable && left() < 160000) {
        messages.push({ role: "assistant", content: p.text, tool_calls: [made] } as CoderMessage);
        return { kind: "more", messages, used: [...used, "make_media"], steps: steps + 1 };
      }
      return runMedia(made, [...used, "make_media"], steps + 1);
    }
    const asked = valid.find((c) => c.function.name === "ask_user");
    if (asked) {
      let q = "";
      try { q = String((JSON.parse(asked.function.arguments || "{}") as { question?: string }).question || ""); } catch { /* the validator already checked it */ }
      return { kind: "ask", question: q, used, steps: steps + 1 };
    }
    const write = valid.find((c) => SHAM_NEEDS_OK.has(c.function.name));
    if (write) return { kind: "confirm", call: write, used, steps: steps + 1 };
    messages.push({ role: "assistant", content: p.text, tool_calls: valid.slice(0, 3) } as CoderMessage);
    for (const c of valid.slice(0, 3)) {
      used.push(c.function.name);
      opts.onEvent?.("tool", `${c.function.name} ${String(c.function.arguments || "").slice(0, 200)}`);
      let result: string;
      try { result = await exec(c, opts.ctx); } catch (e) { result = `error: ${(e as Error).message || "tool failed"}`; }
      opts.onEvent?.("info", clip(String(result), 300));
      messages.push({ role: "tool", name: c.function.name, tool_call_id: c.id, content: clip(String(result), 1800) } as CoderMessage);
    }
  }

  // out of steps or time with the work still going: the next leg continues it (long tasks, many steps), instead of cutting it short
  if (opts.continuable && used.length) return { kind: "more", messages, used, steps };
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

/** The executor context for this chat: its own linked GitHub token (the owner's for the owner), its own VM and memory scope. */
export const shamToolCtx = shamContext;
