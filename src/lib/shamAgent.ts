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
import { shamGenerateAgentStep, shamGenerateAny, shamModeCtx, shamNoteFailure, shamVariant, type ShamReply } from "@/lib/shamStudio";
import { needsFreshFacts, resolveProfile } from "@/lib/modes";
import { forcedMode } from "@/lib/modeForce";
import { generateShamMediaThroughRoute } from "@/lib/shamMediaRoutes";
import { SHAM_CODE_NOTE, brokenCallAttempt, codeNotTried, normaliseShamArgs, parseShamToolCalls, shamCorrectionNote, shamToolConversation, validateShamCall } from "@/lib/shamTools";
import { shamKnobs, type ShamMode } from "@/lib/shamModes";

/** What Sham may use: its own tools (shamExec.ts). */
export const SHAM_TOOL_NAMES = SHAM_TOOLS.map((t) => t.function.name);
/** What a helper agent may use: reading and research only (no writes, no VM, no media, no user questions, no further delegation). Enforced here, not only in the prompt. */
export const SHAM_HELPER_TOOLS: ReadonlySet<string> = new Set(["web_search", "fetch_page", "deep_research", "github_list_files", "github_read_file", "github_search_code", "github_repo_scan", "github_prs", "github_ci", "memory_search"]);
export const SHAM_HELPERS_MAX = 3;
/** The tool definitions Sham is shown: GitHub ones only when this chat can use it. */
export const shamToolDefs = shamTools;

export type ShamAgentResult =
  | { kind: "text"; text: string; used: string[]; steps: number }
  | { kind: "ask"; question: string; used: string[]; steps: number }
  | { kind: "reply"; reply: ShamReply; used: string[]; steps: number }       // Sham answered with a picture / sound / clip of its own: the caller sends it
  | { kind: "confirm"; call: CoderToolCall; used: string[]; steps: number }   // a write to the user's repository: the user is asked before it runs
  | { kind: "more"; messages: CoderMessage[]; used: string[]; steps: number }   // not finished inside this leg: the state goes to the next leg (the shared background runner)
  | { kind: "none"; used: string[]; steps: number };                          // the Studio did not answer in the time left

export type ShamStepEvent = { type: "think" } | { type: "queue"; text: string } | { type: "tool_start"; name: string; args: string } | { type: "tool_end"; name: string; ok: boolean };
export type ShamAsk = (prompt: string, maxNew: number, timeoutMs: number) => Promise<ShamReply | null>;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

// Qwen3/Sham v2 is chat-tuned, not trained to consume Sham's serialized tool transcript as one user utterance.
// Normalize Arabic punctuation/diacritics so the echo guard catches the same question with small formatting changes.
const normaliseChatText = (s: string): string => String(s || "")
  .normalize("NFKC")
  .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
  .replace(/^(?:المستخدم|شام(?:\s*v?2)?|assistant|user)\s*[:：]\s*/i, "")
  .replace(/[؟?!.,،؛:："']/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLocaleLowerCase("ar");

// Capability questions mentioning a technical term (e.g. "هل لديك خبرة في الكود؟")
// are still conversation, not a request to edit/run code. Keep regex escapes single;
// double-escaping \s here silently stops matching ordinary Arabic spacing.
function isCapabilityQuestion(text: string): boolean {
  const t = normaliseChatText(text);
  return /^(?:هل\s+(?:(?:لديك|عندك|عندكم)\s+(?:خبرة|معرفة|قدرة|مهارة|إمكانية|امكانية)|(?:تستطيع|تقدر|يمكنك|تجيد|تعرف|تتقن|تملك|تعمل))|(?:ما|ماذا)\s+(?:(?:الذي\s+)?(?:تتقن|تستطيع|تقدر|تفعل|تجيد|وظيفتك|قدراتك|خبرتك)|(?:هي\s+)?وظيفتك)|(?:أنت|انت)\s+(?:ماذا|ما|ماهي|ما\s+هي)\s*(?:تستطيع|تتقن|وظيفتك|قدراتك)?)/i.test(t);
}

function editSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  if (max > 320 || Math.abs(a.length - b.length) / max > 0.25) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return 1 - prev[b.length] / max;
}

function isQuestionEcho(answer: string, current: string, recentQuestions: string[]): boolean {
  const a = normaliseChatText(answer);
  if (!a) return true;
  const candidates = [current, ...recentQuestions].map(normaliseChatText).filter((x) => x.length >= 8);
  return candidates.some((q) => {
    if (a === q) return true;
    const ratio = Math.min(a.length, q.length) / Math.max(a.length, q.length);
    if (ratio >= 0.72 && editSimilarity(a, q) >= 0.84) return true;
    return a.length >= 16 && (a.startsWith(q) || q.startsWith(a)) && ratio >= 0.88;
  });
}

// Qwen3 sometimes repeats its previous self-introduction instead of answering a new question.
// Compare only substantial answers so short valid replies ("نعم", "لا") are not suppressed.
function isRepeatedPriorAnswer(answer: string, history: { q: string; a: string }[]): boolean {
  const a = normaliseChatText(answer);
  if (a.length < 18) return false;
  return history.slice(-5).some((h) => {
    const previous = normaliseChatText(h.a);
    if (previous.length < 18) return false;
    const ratio = Math.min(a.length, previous.length) / Math.max(a.length, previous.length);
    return a === previous || (ratio >= 0.88 && editSimilarity(a, previous) >= 0.9);
  });
}

function isIdentityBoilerplate(answer: string): boolean {
  const a = normaliseChatText(answer);
  const identityOnly = /(?:انا شام|شام مساعد ذكي|مساعد ذكي صنعه فريقنا)/i.test(a);
  if (!identityOnly) return false;
  // It is not boilerplate if the model goes on to answer the user's actual question
  // with a concrete ability or a yes/no answer plus substance.
  return !/(?:استطيع|أستطيع|يمكنني|اقدر|أقدر|لدي خبرة|عندي خبرة|اجيد|أجيد|برمج|كود|تصحيح|كتابة|تحليل|بحث|شرح|اصنع|أصنع|توليد|صورة|ملف)/i.test(a);
}

function isNonAnswerBoilerplate(answer: string, question: string): boolean {
  return isCapabilityQuestion(question) && isIdentityBoilerplate(answer);
}

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
  /** Test injection for the typed agent-step protocol; production v2 uses its dedicated Studio endpoint. */
  agentAsk?: ShamAsk;
  /** Optional injectable verifier; production verifies from recorded tool results via the plain-answer endpoint. */
  verifyAsk?: ShamAsk;
  media?: (kind: "image" | "audio" | "video", prompt: string, opts?: { scenes?: string[]; narration?: string }) => Promise<ShamReply | null>;      // injectable override; default uses the selected three-route router
  exec?: (call: CoderToolCall, ctx: ShamCtx) => Promise<string>;
  now?: () => number;
  resume?: CoderMessage[];                  // the earlier legs' conversation (tool calls and results so far)
  onEvent?: (kind: "tool" | "info" | "text", text: string) => void;   // what the terminal shows of this run (the shared task log)
  onStep?: (e: ShamStepEvent) => void;      // REAL events for the Telegram card: the model is thinking / a tool starts / a tool ended (ok or failed)
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
  const prof = resolveProfile({ model: variant === "v2" ? "sham_v2" : "sham", pref: opts.mode?.accuracy, auto: opts.mode?.auto, thinkSwitch: opts.mode?.think, policy: opts.mode?.policy, text: opts.text, force: forcedMode(variant === "v2" ? "sham_v2" : "sham"), canThink: variant === "v2" });
  const effMode: ShamMode = { ...(opts.mode || {}), accuracy: prof.mode, think: prof.think || prof.thinkAct, thinkCap: prof.thinkTokens * 3 || undefined, temperature: opts.mode?.temperature };
  const k = shamKnobs(effMode, variant);
  const maxNew = Math.max(20, opts.maxNew || 160);
  const v2 = shamVariant.getStore() === "v2";
  const rawAsk: ShamAsk = opts.ask || ((p, n, t) => shamModeCtx.run(effMode, () => shamGenerateAny(p, n, t)));
  const ask: ShamAsk = (p, n, t) => { opts.onStep?.({ type: "think" }); return rawAsk(p, n, t); };      // direct conversation path
  const rawAgentAsk: (p: string, n: number, t: number, activeTools?: CoderTool[]) => Promise<ShamReply | null> =
    opts.agentAsk || (!opts.ask && v2
      ? ((p, n, t, activeTools = opts.tools) => shamModeCtx.run(effMode, async () => {
          // Keep a compatibility fallback during Studio redeploys; the new endpoint is preferred and never routes to v1/Nova.
          const structured = await shamGenerateAgentStep(p, activeTools, n, t);
          return structured || shamGenerateAny(p, n, t);
        }))
      : rawAsk);
  const stepAsk = (p: string, n: number, t: number, activeTools: CoderTool[] = opts.tools): Promise<ShamReply | null> => {
    opts.onStep?.({ type: "think" });
    return rawAgentAsk(p, n, t, activeTools);
  };
  const unpackToolReply = (reply: ShamReply | null, availableTools: CoderTool[] = opts.tools): { text: string; calls: CoderToolCall[] } => {
    if (reply?.type === "tool_calls") {
      return {
        text: String(reply.text || reply.message?.content || ""),
        calls: (Array.isArray(reply.tool_calls) ? reply.tool_calls : reply.message?.tool_calls || []).map((call) => {
          try {
            const args = JSON.parse(call.function.arguments || "{}");
            return { ...call, function: { ...call.function, arguments: JSON.stringify(normaliseShamArgs(args)) } };
          } catch { return call; }
        }) as CoderToolCall[],
      };
    }
    return parseShamToolCalls(String(reply?.text || ""), availableTools);
  };
  const exec = opts.exec || ((c, x) => shamRunTool(c, x));
  const maxSteps = opts.maxSteps ?? 4;
  const used: string[] = [];
  const messages: CoderMessage[] = opts.resume ? [...opts.resume] : [];
  if (!opts.resume) {
    for (const h of (opts.history || []).slice(-4)) { messages.push({ role: "user", content: h.q }, { role: "assistant", content: h.a }); }
    messages.push({ role: "user", content: opts.text });
  }

  // Everyday Sham v2 conversation must go to its chat-tuned Qwen3 prompt directly.
  // Wrapping "المستخدم: ... / شام:" plus the full tool schema inside one Qwen3 user turn
  // caused the model to echo the serialized question instead of answering it. Keep agent/tool
  // routing for code, execution, media, and fresh-fact requests.
  if (v2 && !opts.resume && (prof.klass === "chat" || prof.klass === "trivial" || isCapabilityQuestion(opts.text)) && !needsFreshFacts(opts.text)) {
    const allHistory = opts.history || [];
    const usableHistory = allHistory.filter((h, index) => {
      const q = normaliseChatText(h.q), a = normaliseChatText(h.a);
      return q.length >= 2 && a.length >= 2 && q !== a &&
        !isQuestionEcho(h.a, h.q, []) &&
        !isNonAnswerBoilerplate(h.a, h.q) &&
        !(isCapabilityQuestion(opts.text) && isIdentityBoilerplate(h.a)) &&
        !isRepeatedPriorAnswer(h.a, allHistory.slice(0, index));
    }).slice(-3);
    const recentQuestions = (opts.history || []).slice(-4).map((h) => h.q);
    const historyText = usableHistory.length
      ? `سياق مختصر للمحادثة السابقة:\n${usableHistory.map((h) => `المستخدم: ${clip(h.q, 220)}\nشام: ${clip(h.a, 260)}`).join("\n")}`
      : "";
    const directPrompt = [
      "أجب عن رسالة المستخدم الحالية مباشرة وبوضوح وباللغة التي كتب بها. لا تكرر السؤال ولا تنسخه ولا تجعله جوابك. لا ترد بتعريف عام مثل «أنا شام، مساعد ذكي» إلا إذا سُئلت عن هويتك. إذا سألك عن خبرتك أو قدراتك، أجب عن السؤال نفسه أولاً ثم اذكر ما تستطيع فعله فعلاً باختصار ومن دون ادعاء قدرات غير متاحة.",
      historyText,
      `رسالة المستخدم الحالية: ${opts.text}`,
      "اكتب الجواب فقط، من دون بادئة «المستخدم» أو «شام»."
    ].filter(Boolean).join("\n\n");
    const directBad = (answer: string) =>
      isQuestionEcho(answer, opts.text, recentQuestions) ||
      isRepeatedPriorAnswer(answer, opts.history || []) ||
      isNonAnswerBoilerplate(answer, opts.text);
    let direct = await ask(directPrompt, maxNew, Math.min(opts.askMs ?? 30000, Math.max(1000, left() - 1000)));
    let waited = 0;
    while (direct && (direct.type === "busy" || direct.type === "loading") && left() > 12000 && waited < 2) {
      waited++;
      const info = opts.queueNote ? await opts.queueNote(waited).catch(() => null) : null;
      opts.onEvent?.("info", info || `⏳ طلبك في الدور وسيبدأ تلقائياً (محاولة ${waited})`);
      opts.onStep?.({ type: "queue", text: info || `في الدور (محاولة ${waited})` });
      await new Promise((res) => setTimeout(res, process.env.NODE_ENV === "test" ? 0 : 2500));
      direct = await ask(directPrompt, maxNew, Math.min(opts.askMs ?? 30000, Math.max(1000, left() - 1000)));
    }
    if (direct?.type === "text" && directBad(String(direct.text || "")) && left() > 4000) {
      opts.onEvent?.("info", "إعادة المحاولة لأن الرد كرر السؤال أو كرر تعريفاً عاماً بدلاً من الإجابة.");
      const retryPrompt = [
        "أنت شام. حاول مرة أخرى لأن الرد السابق لم يجب عن السؤال الحالي.",
        "لا تكرر نص السؤال أو أي سؤال سابق، ولا تعد تعريف نفسك بعبارة «أنا شام، مساعد ذكي»، ولا تكرر جواباً سابقاً.",
        "أجب عن السؤال المحدد مباشرة. إن كان يسأل عن خبرتك أو قدراتك، ابدأ بنعم أو لا عند الحاجة ثم اذكر قدرة عملية محددة. لا تدّعِ شيئاً غير صحيح.",
        `السؤال الحالي: ${opts.text}`,
        "الإجابة الجديدة:"
      ].join("\n");
      direct = await ask(retryPrompt, maxNew, Math.min(opts.askMs ?? 20000, Math.max(1000, left() - 500)));
    }
    if (direct?.type === "text") {
      const answer = String(direct.text || "").trim();
      if (answer && !directBad(answer)) return { kind: "text", text: answer, used, steps: 1 };
      // Never send/store a question echo, a repeated previous answer, or the stock identity in place of an answer.
      return { kind: "text", text: "لم يقدّم شام إجابة فعلية عن السؤال هذه المرة. لم أعرض النص المكرر كأنه إجابة؛ أعد المحاولة بعد قليل.", used, steps: 2 };
    }
    if (direct && direct.type !== "busy" && direct.type !== "loading") return { kind: "reply", reply: direct, used, steps: 1 };
    if (opts.continuable) return { kind: "more", messages, used, steps: 0 };
    return { kind: "none", used, steps: 0 };
  }

  // the old body has a ~384-token window; the new body (Qwen3, Studio with SHAM_LIMITS=open) holds ~1200 prompt tokens (~3.6 chars/token): a longer conversation, longer tool results
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
    opts.onStep?.({ type: "tool_start", name: "make_media", args: JSON.stringify({ kind }) });
    const r = await (opts.media || defaultMedia)(kind, String(a.prompt || "").slice(0, 600), { scenes, narration });
    opts.onStep?.({ type: "tool_end", name: "make_media", ok: Boolean(r && r.type !== "error" && r.b64) });
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

  /** delegate: up to 3 independent read-only investigations, each a small Sham agent loop of its own (3 steps, reading tools only), run at the same time; their reports come back as the tool result. */
  const runDelegate = async (call: CoderToolCall): Promise<string> => {
    let a: { tasks?: unknown; task?: unknown } = {};
    try { a = JSON.parse(call.function.arguments || "{}"); } catch { /* validated already */ }
    const raw: unknown[] = Array.isArray(a.tasks) ? a.tasks : a.task ? [a] : [];
    const tasks = raw.map((x, i) => {
      const o = (typeof x === "string" ? { task: x } : x) as { title?: unknown; task?: unknown } | null;
      return { title: String(o?.title || `وكيل ${i + 1}`).slice(0, 60), task: String(o?.task || "").trim().slice(0, 700) };
    }).filter((t) => t.task).slice(0, SHAM_HELPERS_MAX);
    if (!tasks.length) return "error: delegate needs tasks: [{title, task}] with a complete instruction in each task.";
    if (left() < 22000) return "error: not enough time left to delegate; do the check yourself with one tool.";
    const helperTools = opts.tools.filter((t) => SHAM_HELPER_TOOLS.has(t.function.name));
    if (!helperTools.length) return "error: no read-only tools are available for helpers.";
    const budget = Math.min(70000, left() - 8000);
    const reports = await Promise.all(tasks.map(async (t, i) => {
      try {
        const r = await shamAgentRun({ text: `[مهمة وكيل] ${t.task}\nاستعمل أدوات القراءة فقط ثم اكتب تقريراً قصيراً بما وجدته فعلاً (أسماء ملفات وأرقام حقيقية فقط). لا تخترع شيئاً.`, ctx: opts.ctx, tools: helperTools, budgetMs: budget, maxSteps: 3, maxNew, mode: opts.mode, ask: opts.ask, exec: opts.exec, now: opts.now, askMs: Math.min(opts.askMs ?? 30000, budget - 2000),
          onEvent: (k, tx) => { if (k === "tool") opts.onEvent?.("info", `وكيل ${i + 1} «${t.title}»: ${tx.slice(0, 160)}`); } });
        if (r.kind === "text") return { ...t, ok: true, text: r.text.slice(0, 900), used: r.used };
        if (r.kind === "ask") return { ...t, ok: false, text: `needs information it cannot ask for: ${r.question.slice(0, 200)}`, used: r.used };
        return { ...t, ok: false, text: "the helper did not finish in time", used: r.used };
      } catch (e) { return { ...t, ok: false, text: `error: ${String((e as Error)?.message || e).slice(0, 200)}`, used: [] as string[] }; }
    }));
    opts.onEvent?.("info", `وصلت تقارير الوكلاء (${reports.filter((r) => r.ok).length}/${reports.length})`);
    return reports.map((r, i) => `## وكيل ${i + 1}: ${r.title} — ${r.ok ? "DONE" : "NOT DONE"}${r.used.length ? ` (tools: ${r.used.join(", ")})` : ""}\n${r.text}`).join("\n\n");
  };

  for (; steps < maxSteps; steps++) {
    if (left() < 6000) break;
    // a greeting or a plain code question: no tool block in the prompt (about 1,000 tokens fewer to read); only on the very first step of a fresh request
    const bare = prof.lite && steps === 0 && !opts.resume && recoveries === 0;
    const toolsNow = bare ? [] : opts.tools;
    const prompt = k.note ? `${k.note}\n${shamToolConversation(messages, toolsNow, lim)}` : shamToolConversation(messages, toolsNow, lim);
    let reply = await stepAsk(prompt, maxNew, Math.min(opts.askMs ?? 90000, left() - 1000), toolsNow);
    // every Studio is on other people's work: the request WAITS in line (the user sees the position, never "busy") and is asked again; out of time it moves to the next background leg
    for (let q = 1; (reply?.type === "busy" || reply?.type === "loading") && left() > 14000 && q <= 12; q++) {
      const info = opts.queueNote ? await opts.queueNote(q).catch(() => null) : null;
      opts.onEvent?.("info", info || `⏳ طلبك في الدور وسيبدأ تلقائياً (محاولة ${q})`);
      opts.onStep?.({ type: "queue", text: info || `في الدور (محاولة ${q})` });
      await new Promise((res) => setTimeout(res, process.env.NODE_ENV === "test" ? 0 : 4000 + Math.floor(Math.random() * 3000)));
      reply = await stepAsk(prompt, maxNew, Math.min(opts.askMs ?? 90000, left() - 1000), toolsNow);
    }
    if (opts.continuable && (reply?.type === "busy" || reply?.type === "loading")) return { kind: "more", messages, used, steps };
    if (!reply) return opts.continuable && steps === 0 ? { kind: "more", messages, used, steps } : { kind: "none", used, steps };      // the Studio is slow (CPU): the background leg waits longer instead of giving up
    if (reply.type === "tool_call_error" && left() > 6000) {
      opts.onEvent?.("info", "استدعاء الأداة لم يجتز فحص الصيغة؛ طلبت من شام تصحيحه ولم أنفّذ شيئاً.");
      const retry = await stepAsk(`${prompt.replace(/\nشام:$/, "")}\n[تصحيح من المحرك] لم يُنفّذ أي استدعاء. أعد بناء استدعاء واحد لأداة موجودة في القائمة بصيغة JSON صحيحة، أو أجب نصياً إذا لم تحتج أداة.\nشام:`, maxNew, Math.min(opts.askMs ?? 90000, left() - 1000), toolsNow);
      if (retry) reply = retry;
    }
    if (reply.type === "tool_call_error") return { kind: "text", text: "تعذّر إنشاء استدعاء أداة صالح بعد إعادة المحاولة؛ لم تُنفّذ أي أداة. أعد المحاولة أو اطلب المهمة بصياغة أوضح.", used, steps: steps + 1 };
    if (reply.type !== "text" && reply.type !== "tool_calls") return { kind: "reply", reply, used, steps };
    let text = String(reply.text || "");
    let p = unpackToolReply(reply, toolsNow);
    // a wrong or incomplete call goes back to Sham with the reason (its own correction rounds, set by the user's accuracy mode)
    for (let fix = 0; fix < k.corrections && left() > 8000; fix++) {
      const problems = p.calls.map((c) => validateShamCall(c, toolsNow)).filter((e): e is string => Boolean(e));
      if (!p.calls.length && brokenCallAttempt(p.text)) problems.push("الصيغة غير صحيحة (JSON مكسور أو أداة غير محمّلة).");
      const note = problems.length ? shamCorrectionNote(problems) : !p.calls.length && codeNotTried(p.text, messages, toolsNow) ? SHAM_CODE_NOTE : "";
      if (!note) break;
      const again = await stepAsk(`${prompt.replace(/\nشام:$/, "")}\nشام: ${text.slice(0, 600)}\n${note}\nشام:`, maxNew, Math.min(opts.askMs ?? 90000, left() - 1000), toolsNow);
      if (!again || (again.type !== "text" && again.type !== "tool_calls")) break;
      text = String(again.text || "");
      p = unpackToolReply(again, toolsNow);
    }
    // the last tool answered with an error and the model now writes prose with no call: give it the error back (twice at most) instead of ending the task on an apology
    const lastMsg = messages[messages.length - 1] as { role?: string; content?: string } | undefined;
    if (lastMsg?.role === "tool" && /^error/i.test(String(lastMsg.content || "")) && !p.calls.some((c) => !validateShamCall(c, toolsNow)) && recoveries < 2 && left() > 10000) {
      recoveries++;
      const again = await stepAsk(`${prompt.replace(/\nشام:$/, "")}\nشام: ${text.slice(0, 300)}\n[تصحيح من المحرك] الأداة أعادت خطأً (انظر نتيجة الأداة أعلاه). أعد الاستدعاء بمعاملات صحيحة، أو أجب نصياً إذا لم تحتج أداة.\nشام:`, maxNew, Math.min(opts.askMs ?? 90000, left() - 1000), toolsNow);
      if (again && (again.type === "text" || again.type === "tool_calls")) { text = String(again.text || ""); p = unpackToolReply(again, toolsNow); }
    }
    const valid = p.calls.filter((c) => !validateShamCall(c, toolsNow));
    if (!valid.length) {
      const final = (p.text || text).trim();
      if (!final) shamNoteFailure("the Studio answered with empty text (raw: " + JSON.stringify(text).slice(0, 80) + ")");
      // Explicit VERIFY phase: cross-check the proposed final answer against tool outputs.
      // Never claim a write, test, or deployment succeeded without a successful tool result.
      // Tests injecting only ask preserve deterministic scripts unless a verifier is explicitly supplied.
      const verifier = opts.verifyAsk || (!opts.ask ? ask : undefined);
      if (final && used.length && verifier && left() > 6500) {
        opts.onEvent?.("info", "مرحلة التحقق: مراجعة الإجابة مقابل نتائج الأدوات المنفذة.");
        const verifyPrompt = [
          shamToolConversation(messages, [], lim).replace(/\nشام:$/, ""),
          "[مرحلة التحقق — ليست مهمة جديدة]",
          "راجع الإجابة المقترحة مقابل نتائج الأدوات المسجلة في المحادثة فقط. صحّح أي معلومة لا تدعمها النتائج، ولا تدّعِ نجاح تنفيذ أو اختبار أو نشر إلا إذا ظهر نجاح صريح في نتيجة أداة. إذا فشلت أداة، اذكر الفشل بوضوح. أعد الجواب النهائي للمستخدم فقط، بلا أدوات أو خطة.",
          "الإجابة المقترحة: " + final.slice(0, 1800),
        ].join("\n\n");
        try {
          const checked = await verifier(verifyPrompt, Math.min(maxNew, 180), Math.min(25000, left() - 500));
          if (checked?.type === "text" && String(checked.text || "").trim()) {
            return { kind: "text", text: String(checked.text).trim(), used, steps: steps + 1 };
          }
        } catch { /* keep the proposed answer rather than lose recorded tool results */ }
      }
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
      opts.onStep?.({ type: "tool_start", name: c.function.name, args: String(c.function.arguments || "") });
      let result: string;
      try { result = c.function.name === "delegate" ? await runDelegate(c) : await exec(c, opts.ctx); } catch (e) { result = `error: ${(e as Error).message || "tool failed"}`; }
      opts.onStep?.({ type: "tool_end", name: c.function.name, ok: !/^error/i.test(String(result)) });
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
