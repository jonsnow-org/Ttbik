// Sham's OWN agent loop (owner, 2026-10-26: "Sham must own everything"). It lives with Sham, not with Nova's engine:
//   - its own conversation format (shamTools.ts: the tool block + "المستخدم: … / شام: <tool_call>… / نتيجة الأداة …"),
//   - its own tool selection (SHAM_TOOL_NAMES below: what Sham may use, chosen here, not by Nova's tool-group loader),
//   - its own correction rounds (a wrong call goes back to Sham with the reason: validateShamCall), its own time budget and step limit,
//   - its own Studio (shamGenerateAny: the old or the new body, whichever the chat chose; its thinking / accuracy / speed settings ride with every call).
// Its tools and their executors are Sham's own too (shamExec.ts): the guarded web fetch, the VM driver, memory and schedules are called as plain libraries,
// GitHub is spoken to directly; the VM, memory scope and run id are Sham's (`sham:<chat>` / `sham-<chat>`), never Nova's. No Nova engine, prompt, Studio or run state is touched.
// A write to the user's repository (push, open / merge a pull request) ends the round with kind "confirm": the user taps before anything runs.
import type { ShamMessage as CoderMessage, ShamTool as CoderTool, ShamToolCall as CoderToolCall } from "@/lib/shamTypes";
import { SHAM_NEEDS_OK, shamNeedsOk, SHAM_TOOLS, shamContext, shamRunTool, shamTools, type ShamCtx } from "@/lib/shamExec";
import { shamGenerateAny, shamModeCtx, shamNoteFailure, shamVariant, type ShamReply } from "@/lib/shamStudio";
import { resolveProfile } from "@/lib/modes";
import { forcedMode } from "@/lib/modeForce";
import { generateShamMediaThroughRoute } from "@/lib/shamMediaRoutes";
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
  media?: (kind: "image" | "audio" | "video", prompt: string, opts?: { scenes?: string[]; narration?: string }) => Promise<ShamReply | null>;      // injectable override; default uses the selected three-route router
  exec?: (call: CoderToolCall, ctx: ShamCtx) => Promise<string>;
  now?: () => number;
  resume?: CoderMessage[];                  // the earlier legs' conversation (tool calls and results so far)
  onEvent?: (kind: "tool" | "info" | "text", text: string) => void;   // what the terminal shows of this run (the shared task log)
  askMs?: number;                           // the longest wait for one Studio answer (default 30 s inside the webhook; the background legs wait much longer)
  queueNote?: (attempt: number) => Promise<string | null>;   // the line shown while every Studio is busy with others (queue position / estimate)
  continuable?: boolean;                    // true: out of time / steps with work still going = hand over to the next leg instead of answering now
}): Promise<ShamAgentResult> {
  const now = opts.now || Date.now;
  const t0 = now();
  const left = () => opts.budgetMs - (now() - t0);
  // ONE mode system (src/lib/modes.ts): this request's class (greeting / chat / code / agent / media) and the user's mode + Auto decide the answer budget, sampling, correction
  // rounds and whether the body writes a thought first. A greeting or a media request never thinks; the user's "thinking" switch applies to code / agent work, first step.
  const variant = shamVariant.getStore();
  const prof = resolveProfile({ model: variant === "v2" ? "sham_v2" : "sham", pref: opts.mode?.accuracy, auto: opts.mode?.auto, thinkSwitch: opts.mode?.think, text: opts.text, force: forcedMode(variant === "v2" ? "sham_v2" : "sham"), canThink: variant === "v2" });
  const effMode: ShamMode = { ...(opts.mode || {}), accuracy: prof.mode, think: prof.think, thinkCap: prof.thinkTokens * 3 || undefined, temperature: opts.mode?.temperature };
  const k = shamKnobs(effMode, variant);
  const maxNew = Math.max(20, opts.maxNew || 160);
  const ask: ShamAsk = opts.ask || ((p, n, t) => shamModeCtx.run(effMode, () => shamGenerateAny(p, n, t)));
  const exec = opts.exec || ((c, x) => shamRunTool(c, x));
  const maxSteps = opts.maxSteps ?? 4;
  const used: string[] = [];
  const messages: CoderMessage[] = opts.resume ? [...opts.resume] : [];
  if (!opts.resume) {
    for (const h of (opts.history || []).slice(-4)) { messages.push({ role: "user", content: h.q }, { role: "assistant", content: h.a }); }
    messages.push({ role: "user", content: opts.text });
  }
  // the old body has a ~384-token window; the new body (Qwen3, Studio with SHAM_LIMITS=open) holds ~1200 prompt tokens (~3.6 chars/token): a longer conversation, longer tool results
  const v2 = shamVariant.getStore() === "v2";
  const lim = v2 ? { turns: 8, turnChars: 900, maxChars: 4600 } : { turns: 6, turnChars: 400, maxChars: 3600 };
  const toolClip = v2 ? 2600 : 1800;
  let recoveries = 0;
  let steps = 0;
  const runMedia = async (call: CoderToolCall, usedNow: string[], stepNow: number): Promise<ShamAgentResult> => {
    let a: { kind?: string; prompt?: string; scenes?: unknown; narration?: unknown } = {};
    try { a = JSON.parse(call.function.arguments || "{}"); } catch { /* validated already */ }
    const kind = (["image", "audio", "video"].includes(String(a.kind)) ? a.kind : "image") as "image" | "audio" | "video";
    const scenes = Array.isArray(a.scenes) ? a.scenes.map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 6) : undefined;
    const narration = String(a.narration || "").trim().slice(0, 1500) || undefined;
    opts.onEvent?.("tool", "make_media " + kind + " via selected route: " + String(a.prompt || "").slice(0, 80));
    const r = await (opts.media || defaultMedia)(kind, String(a.prompt || "").slice(0, 600), { scenes, narration });
    if (r?.type === "error") {
      opts.onEvent?.("info", "Media route " + (r.route || "unknown") + " FAILED: " + String(r.text || "unknown error").slice(0, 220));
      return { kind: "text", text: "Media generation failed on selected route " + (r.route || "unknown") + ": " + (r.text || "no details") + ". No automatic route switch was performed.", used: usedNow, steps: stepNow };
    }
    if (r && (r.type === "image" || r.type === "audio" || r.type === "video") && r.b64) {
      opts.onEvent?.("info", "Media route " + (r.route || "unknown") + " SUCCEEDED (" + r.type + ").");
      return { kind: "reply", reply: r, used: usedNow, steps: stepNow };
    }
    return { kind: "text", text: "Selected media route " + (r?.route || "unknown") + " did not return a usable file (" + (r?.text || r?.type || "no answer") + "). No automatic route switch was performed.", used: usedNow, steps: stepNow };
  };
  const defaultMedia = async (k: "image" | "audio" | "video", pr: string, mediaOpts: { scenes?: string[]; narration?: string } = {}): Promise<ShamReply | null> =>
    generateShamMediaThroughRoute(k, pr, { ...mediaOpts, timeoutMs: Math.min(240000, Math.max(20000, left() - 3000)) });
  const tail = messages[messages.length - 1] as { role?: string; tool_calls?: CoderToolCall[] } | undefined;
  const pendingMedia = opts.resume && tail?.role === "assistant" ? tail.tool_calls?.find((c) => c.function.name === "make_media") : undefined;
  if (pendingMedia) return runMedia(pendingMedia, ["make_media"], 1);       // the earlier leg asked for it: run it now, with the long wait

  for (; steps < maxSteps; steps++) {
    if (left() < 6000) break;
    // a greeting or a plain code question: no tool block in the prompt (about 1,000 tokens fewer to read); only on the very first step of a fresh request
    const bare = prof.lite && steps === 0 && !opts.resume && recoveries === 0;
    const toolsNow = bare ? [] : opts.tools;
    const prompt = k.note ? `${k.note}\n${shamToolConversation(messages, toolsNow, lim)}` : shamToolConversation(messages, toolsNow, lim);
    let reply = await ask(prompt, maxNew, Math.min(opts.askMs ?? 30000, left() - 1000));
    // every Studio is on other people's work: the request WAITS in line (the user sees the position, never "busy") and is asked again; out of time it moves to the next background leg
    for (let q = 1; (reply?.type === "busy" || reply?.type === "loading") && left() > 14000 && q <= 12; q++) {
      const info = opts.queueNote ? await opts.queueNote(q).catch(() => null) : null;
      opts.onEvent?.("info", info || `⏳ طلبك في الدور وسيبدأ تلقائياً (محاولة ${q})`);
      await new Promise((res) => setTimeout(res, process.env.NODE_ENV === "test" ? 0 : 4000 + Math.floor(Math.random() * 3000)));
      reply = await ask(prompt, maxNew, Math.min(opts.askMs ?? 30000, left() - 1000));
    }
    if (opts.continuable && (reply?.type === "busy" || reply?.type === "loading")) return { kind: "more", messages, used, steps };
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
    // the last tool answered with an error and the model now writes prose with no call: give it the error back (twice at most) instead of ending the task on an apology
    const lastMsg = messages[messages.length - 1] as { role?: string; content?: string } | undefined;
    if (lastMsg?.role === "tool" && /^error/i.test(String(lastMsg.content || "")) && !p.calls.some((c) => !validateShamCall(c, opts.tools)) && recoveries < 2 && left() > 10000) {
      recoveries++;
      const again = await ask(`${prompt.replace(/\nشام:$/, "")}\nشام: ${text.slice(0, 300)}\n[تصحيح من المحرك] الأداة أعادت خطأً (انظر نتيجة الأداة أعلاه). أعد الاستدعاء بمعاملات صحيحة بالصيغة <tool_call>{"name": "...", "arguments": {...}}</tool_call>، أو اسأل المستخدم بـ ask_user إن كانت المعلومة ناقصة.\nشام:`, maxNew, Math.min(opts.askMs ?? 30000, left() - 1000));
      if (again && again.type === "text" && (again.text || "").trim()) { text = String(again.text); p = parseShamToolCalls(text, opts.tools); }
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
    const write = valid.find((c) => shamNeedsOk(c));
    if (write) return { kind: "confirm", call: write, used, steps: steps + 1 };
    messages.push({ role: "assistant", content: p.text, tool_calls: valid.slice(0, 3) } as CoderMessage);
    for (const c of valid.slice(0, 3)) {
      used.push(c.function.name);
      opts.onEvent?.("tool", `${c.function.name} ${String(c.function.arguments || "").slice(0, 200)}`);
      let result: string;
      try { result = await exec(c, opts.ctx); } catch (e) { result = `error: ${(e as Error).message || "tool failed"}`; }
      opts.onEvent?.("info", clip(String(result), 300));
      messages.push({ role: "tool", name: c.function.name, tool_call_id: c.id, content: clip(String(result), toolClip) } as CoderMessage);
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
