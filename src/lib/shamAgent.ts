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
import { shamGenerateAgentStep, shamGenerateAny, shamGenerateChat, shamGenerateChatStream, shamGenerateTldm, shamModeCtx, shamNoteFailure, shamTldmOn, shamTldmSession, shamTldmSessionId, shamVariant, type ShamReply } from "@/lib/shamStudio";
import { historyFromTurns, isEchoedPriorReply, isTrainingStatusReply, lastUserContent, shamDirectChatMessages, STALE_REPLY_USER } from "@/lib/shamReplyGuard";
import { shamAdminNotice } from "@/lib/shamAdminNotice";
import { needsFreshFacts, requiresProgressCard, resolveProfile } from "@/lib/modes";
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
  | { kind: "none"; used: string[]; steps: number }
  | { kind: "stopped"; used: string[]; steps: number };                      // user-requested cancellation

export type ShamStepEvent = { type: "think" } | { type: "queue"; text: string } | { type: "tool_start"; name: string; args: string } | { type: "tool_end"; name: string; ok: boolean };
export type ShamAsk = (prompt: string, maxNew: number, timeoutMs: number) => Promise<ShamReply | null>;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

// Keep technical capability questions on ordinary chat; never rewrite user content.
function isCapabilityQuestion(text: string): boolean {
  const t = String(text || "").normalize("NFKC").replace(/[\u064B-\u065F\u0670\u0640]/g, "").toLocaleLowerCase("ar");
  return /(?:هل\s+(?:لديك|عندك)\s+(?:خبرة|معرفة|قدرة|مهارة)|(?:ماذا|ما)\s+(?:(?:الذي\s+)?(?:تستطيع|تتقن|تفعل|وظيفتك|قدراتك)|تقدر|تجيد)|(?:تستطيع|تقدر|تجيد)\s+(?:البرمجة|الكود|الشرح))/i.test(t);
}

/** The text only repeats the user's request (same words, punctuation and spacing aside). */
export function isEchoOfRequest(text: string, request: string): boolean {
  const norm = (x: string) => String(x || "").normalize("NFKC").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[\s\p{P}\p{S}]+/gu, "").toLocaleLowerCase("ar");
  const a = norm(text), b = norm(request);
  return Boolean(a && b && (a === b || (a.length >= 6 && b.includes(a) && a.length >= b.length * 0.8)));
}

/** The tool-conversation format ends its prompt with «شام:»; the body sometimes repeats that speaker label at the start of its answer
 *  (live probe 2026-11-25: «شام: بايثون هو لغة…»). The label is not part of the answer. */
export function stripSpeakerLabel(text: string): string {
  return String(text || "").replace(/^\s*(?:شام(?:\s*برو)?|sham(?:\s*pro)?)\s*[:：]\s*/i, "");
}

export async function shamAgentRun(opts: Parameters<typeof shamAgentRunInner>[0]): Promise<ShamAgentResult> {
  const r = await shamAgentRunInner(opts);
  if (r.kind === "text") return { ...r, text: stripSpeakerLabel(r.text) || r.text };
  if (r.kind === "ask") return { ...r, question: stripSpeakerLabel(r.question) || r.question };
  return r;
}

async function shamAgentRunInner(opts: {
  text: string;
  history?: { q: string; a: string }[];
  ctx: ShamCtx;
  tools: CoderTool[];
  budgetMs: number;
  maxSteps?: number;
  /** The host tells whether the user's message asked for a picture / sound / clip (Sham modules never import Nova's media detector); absent = no check. */
  mediaAsked?: (userText: string) => boolean;
  maxNew?: number;
  mode?: ShamMode;
  ask?: ShamAsk;
  /** Test injection for the typed agent-step protocol; production v2 uses its dedicated Studio endpoint. */
  agentAsk?: ShamAsk;
  /** Optional injectable verifier; production verifies from recorded tool results via the plain-answer endpoint. */
  verifyAsk?: ShamAsk;
  media?: (kind: "image" | "audio" | "video", prompt: string, opts?: { scenes?: string[]; narration?: string; seconds?: number }) => Promise<ShamReply | null>;      // injectable override; default uses the selected three-route router
  exec?: (call: CoderToolCall, ctx: ShamCtx) => Promise<string>;
  now?: () => number;
  resume?: CoderMessage[];                  // the earlier legs' conversation (tool calls and results so far)
  onEvent?: (kind: "tool" | "info" | "text" | "screen", text: string) => void;   // what the terminal shows of this run (the shared task log)
  onDelta?: (text: string) => void;         // each streamed piece of the direct-chat answer as the model writes it (live view)
  onReplace?: (text: string) => void;       // replace the typist with a retried answer (never append a stale stream)
  onStep?: (e: ShamStepEvent) => void;      // REAL events for the Telegram card: the model is thinking / a tool starts / a tool ended (ok or failed)
  askMs?: number;                           // the longest wait for one Studio answer (default 30 s inside the webhook; the background legs wait much longer)
  queueNote?: (attempt: number) => Promise<string | null>;   // the line shown while every Studio is busy with others (queue position / estimate)
  continuable?: boolean;
  shouldStop?: () => Promise<boolean>;        // model-specific cooperative cancellation check                    // true: out of time / steps with work still going = hand over to the next leg instead of answering now
}): Promise<ShamAgentResult> {
  const now = opts.now || Date.now;
  const t0 = now();
  const left = () => opts.budgetMs - (now() - t0);
  const isStopped = async (): Promise<boolean> => { try { return Boolean(await opts.shouldStop?.()); } catch { return false; } };
  // ONE mode system (src/lib/modes.ts): this request's class (greeting / chat / code / agent / media) and the user's mode + Auto decide the answer budget, sampling, correction
  // rounds and whether the body writes a thought first. A greeting or a media request never thinks; the user's "thinking" switch applies to code / agent work, first step.
  const variant = shamVariant.getStore();
  if (variant !== "v1" && variant !== "v2") throw new Error("Missing selected Sham variant; refusing to route through a default model.");
  const prof = resolveProfile({ model: variant === "v2" ? "sham_v2" : "sham", pref: opts.mode?.accuracy, auto: opts.mode?.auto, thinkSwitch: opts.mode?.think, policy: opts.mode?.policy, text: opts.text, force: forcedMode(variant === "v2" ? "sham_v2" : "sham"), canThink: variant === "v2" });
  const effMode: ShamMode = { ...(opts.mode || {}), accuracy: prof.mode, think: prof.think || prof.thinkAct, thinkCap: prof.thinkTokens * 3 || undefined, temperature: opts.mode?.temperature };
  const k = shamKnobs(effMode, variant);
  const maxNew = Math.max(20, opts.maxNew ?? (variant === "v2" ? 512 : 160));
  const v2 = variant === "v2";
  const rawAsk: ShamAsk = opts.ask || ((p, n, t) => shamModeCtx.run(effMode, () => shamGenerateAny(p, n, t, { bypassContentHeuristics: Boolean(opts.ctx.owner) })));
  // A real thought only when the profile allows it (Sham v2 was never trained to think). Any request that is actual work still
  // gets one "working" beat, so a lazily-opened progress card has a first real event even when no tool is called.
  const announceThinking = () => { if (prof.think || prof.thinkAct || requiresProgressCard(opts.text)) opts.onStep?.({ type: "think" }); };
  const ask: ShamAsk = (p, n, t) => { announceThinking(); return rawAsk(p, n, t); };      // direct conversation path
  const rawAgentAsk: (p: string, n: number, t: number, activeTools?: CoderTool[]) => Promise<ShamReply | null> =
    opts.agentAsk || (!opts.ask && v2
      ? ((p, n, t, activeTools = opts.tools) => shamModeCtx.run(effMode, async () => {
          // Keep a compatibility fallback during Studio redeploys; the new endpoint is preferred and never routes to v1/Nova.
          const deadline = Date.now() + t;
          const structured = await shamGenerateAgentStep(p, activeTools, n, t, `${opts.ctx.chatId}:${opts.ctx.modelId}`);
          const remaining = deadline - Date.now();
          return structured || (remaining > 1500 ? shamGenerateAny(p, n, remaining, { bypassContentHeuristics: Boolean(opts.ctx.owner) }) : null);
        }))
      : rawAsk);
  const stepAsk = (p: string, n: number, t: number, activeTools: CoderTool[] = opts.tools): Promise<ShamReply | null> => {
    announceThinking();
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
  const maxSteps = opts.maxSteps ?? (v2 ? 8 : 4);
  const used: string[] = [];
  const messages: CoderMessage[] = opts.resume ? [...opts.resume] : [];
  if (!opts.resume) {
    for (const h of (opts.history || []).slice(-4)) { messages.push({ role: "user", content: h.q }, { role: "assistant", content: h.a }); }
    messages.push({ role: "user", content: opts.text });
  }

  // A capability question is ordinary chat only when it is genuinely about capabilities.
  // When a GitHub repo / Vercel workspace is named, the task classifier must be allowed to
  // select the permission-checked agent route instead of answering from the model's guess.
  const hasWorkspaceTarget = /github|git\s*hub|جيت\s*هب|جيتهوب|vercel|فيرسيل|\b(?:repo|repository|branch|commit|pull request|workflow|deploy|pr)\b|مستودع|ريبو|فرع|كوميت|طلب دمج/i.test(opts.text);
  const hasWorkspaceAction = /تحليل|حلل|افحص|راجع|اقرأ|تصفح|اعمل على|نفذ|نفّذ|ارفع|ادفع|انشر|نشر|دمج|افتح|أنشئ|أنشاء|analy[sz]e|inspect|review|read|scan|deploy|push|merge|create|open pull request|run workflow/i.test(opts.text);
  const hasRepositoryLocator = /\b[\w.-]+\x2f[\w.-]+\b/i.test(opts.text);
  const requiresWorkspaceAgent = hasRepositoryLocator || (hasWorkspaceTarget && hasWorkspaceAction);
  const directCapability = isCapabilityQuestion(opts.text) && prof.klass !== "agentic" && !requiresWorkspaceAgent && !hasWorkspaceTarget;
  const directChatIntent = !requiresWorkspaceAgent &&
    (prof.klass === "chat" || prof.klass === "trivial" || directCapability);
  // 2026-11-24 (live probe run 45475040881): every message went to the T-LDM head first (~3.4 s), and on ordinary questions the 4.5M head wrote broken commands
  // («python3 -c "pornt iu…"») whose garbled text («الخرج: 811») became the reply; a plain answer then waited for the WHOLE non-streamed body answer (~17 s mean,
  // up to 41 s). A greeting / question / explanation is conversation: it goes straight to the body's streamed chat below (first words in ~2.4 s). Work
  // (code, computer, files, web, repositories) still goes through the T-LDM head first.
  const tldmComputerTask = /(?:حاسوب|كمبيوتر|الطرفية|ترمنال|terminal|shell|bash|سطر\s*الأوامر|نفذ|نفّذ|شغل|شغّل|ثبت|ثبّت|اعرض\s+(?:الملفات|المجلد|محتو)|ملف|ملفات|مجلد|المجلد|احذف|أنشئ\s+(?:ملف|مجلد)|\b(?:run|execute|install|ls|cd|mkdir|rm|cat|pip|npm|git|curl|wget|python3?|node)\b|\bfiles?\b|\bfolders?\b|\bdirector(?:y|ies)\b|ابحث|بحث|تصفح|الإنترنت|الانترنت|الويب|موقع|رابط|https?:\/\/|\b(?:search|browse|research|web|online|website|url)\b)/i.test(opts.text);
  const tldmPlainTurn = v2 && !opts.resume && directChatIntent && !needsFreshFacts(opts.text) && !tldmComputerTask;
  // T-LDM, when on, is the tool loop: commands run on Sham 2's existing internal computer.
  // Sensitive commands return kind "confirm" so THIS chat (not a global owner inbox) can allow or deny.
  let tldmHandedOff = false;
  tldmHead: if (v2 && shamTldmOn() && !tldmPlainTurn) {
    const session = shamTldmSessionId(opts.ctx.chatId);
    const timeout = Math.min(opts.askMs ?? 180000, Math.max(1000, left() - 1000));
    const chatMessages = messages
      .filter((message): message is CoderMessage & { role: "user" | "assistant"; content: string } =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
      .slice(-12)
      .map((message) => ({ role: message.role, content: message.content }));
    if (await isStopped()) return { kind: "stopped", used, steps: 0 };
    let direct = await shamTldmSession.run(session, () => shamGenerateTldm(chatMessages, session, timeout, { bypassContentHeuristics: Boolean(opts.ctx.owner), owner: Boolean(opts.ctx.owner) }));
    let tldmSteps = 1;
    const tldmReadTools = new Set(["web_search", "fetch_page", "deep_research", "github_list_files", "github_read_file", "github_read_files", "github_search_code", "github_repo_scan", "github_prs", "github_ci"]);
    // GitHub read tools return whole files / trees: the T-LDM head decided to ask for them (trained: data/trajectories.make_open_episode), and Sham Pro's own BODY writes the answer
    // from the FULL result (a 4.5M head cannot summarise a file). Web tools keep the head's own loop.
    const bodyAnswers = new Set(["github_list_files", "github_read_file", "github_read_files", "github_search_code", "github_repo_scan", "github_prs", "github_ci"]);
    let bodyAnswer: { name: string; args: Record<string, unknown>; result: string } | null = null;
    while (direct?.type === "tool_request" && tldmSteps < 7 && left() > 2500) {
      if (await isStopped()) return { kind: "stopped", used, steps: tldmSteps };
      const toolName = String(direct.tool_name || "");
      const rawArgs = direct.tool_arguments && typeof direct.tool_arguments === "object" ? direct.tool_arguments as Record<string, unknown> : {};
      const available = tldmReadTools.has(toolName) && opts.tools.some((item) => item.function?.name === toolName);
      const call: CoderToolCall = {
        id: "tldm-tool-" + tldmSteps,
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(rawArgs) },
      };
      let result = "";
      if (!available || shamNeedsOk(call)) {
        result = "error: T-LDM requested an unavailable or non-read-only tool: " + (toolName || "(missing name)");
      } else {
        used.push(toolName);
        opts.onEvent?.("tool", toolName + " " + JSON.stringify(rawArgs).slice(0, 200));
        opts.onStep?.({ type: "tool_start", name: toolName, args: JSON.stringify(rawArgs) });
        try { result = await exec(call, opts.ctx); }
        catch (e) { result = "error: " + String((e as Error)?.message || e).slice(0, 300); }
        opts.onStep?.({ type: "tool_end", name: toolName, ok: !/^error/i.test(result) });
        opts.onEvent?.("info", clip(result, 300));
      }
      if (await isStopped()) return { kind: "stopped", used, steps: tldmSteps };
      if (available && bodyAnswers.has(toolName) && result && !/^error/i.test(result)) { bodyAnswer = { name: toolName, args: rawArgs, result }; break; }
      const previousBase = String(direct.tldmBase || "");
      const requestId = String(direct.tool_request_id || "");
      tldmSteps++;
      direct = await shamTldmSession.run(session, () => shamGenerateTldm(
        chatMessages,
        session,
        Math.max(1000, Math.min(timeout, left() - 1000)),
        {
          bypassContentHeuristics: Boolean(opts.ctx.owner),
          owner: Boolean(opts.ctx.owner),
          resumeTool: {
            requestId,
            name: toolName,
            arguments: rawArgs,
            result: String(result || "").slice(0, 7000),
            error: /^error/i.test(result),
            routeBase: previousBase,
          },
        },
      ));
    }
    if (await isStopped()) return { kind: "stopped", used, steps: tldmSteps };
    if (bodyAnswer) {
      const last = chatMessages.length ? chatMessages[chatMessages.length - 1] : null;
      const asked = last && last.role === "user" ? last.content : String(opts.text || "");
      const handed = [
        ...chatMessages.slice(0, -1),
        { role: "user" as const, content: `${asked}\n\n[نتيجة الأداة ${bodyAnswer.name} ${JSON.stringify(bodyAnswer.args).slice(0, 200)}]\n${bodyAnswer.result.slice(0, 6000)}\n\nأجب عن طلبي أعلاه اعتمادًا على هذه النتيجة وحدها، بالعربية وباختصار.` },
      ];
      const written = await shamGenerateChat(handed, 640, Math.max(1000, Math.min(timeout, left() - 1000)), { bypassContentHeuristics: Boolean(opts.ctx.owner), direct: true });
      const text = written?.type === "text" ? String(written.text || "").trim() : "";
      if (text) return { kind: "text", text, used, steps: tldmSteps + 1 };
      // the body could not answer: hand the result back to the head, as before (the same model, never another one)
      const resumed = await shamTldmSession.run(session, () => shamGenerateTldm(chatMessages, session, Math.max(1000, Math.min(timeout, left() - 1000)), {
        bypassContentHeuristics: Boolean(opts.ctx.owner), owner: Boolean(opts.ctx.owner),
        resumeTool: { requestId: String(direct?.tool_request_id || ""), name: bodyAnswer.name, arguments: bodyAnswer.args, result: bodyAnswer.result.slice(0, 7000), error: false, routeBase: String(direct?.tldmBase || "") },
      }));
      if (resumed?.type === "text" && String(resumed.text || "").trim()) return { kind: "text", text: String(resumed.text).trim(), used, steps: tldmSteps + 1 };
      return { kind: "text", text: "قرأتُ النتيجة لكن تعذّرت صياغة الجواب الآن. أعد إرسال الطلب.", used, steps: tldmSteps + 1 };
    }
    if (direct?.type === "tool_request") {
      return { kind: "text", text: "لم تكتمل خطوات البحث في الوقت المتاح. أعد إرسال الطلب لمتابعته.", used, steps: tldmSteps };
    }
    if (direct?.type === "confirm") {
      const command = String(direct.command || "");
      return {
        kind: "confirm",
        call: { id: "tldm-confirm", type: "function", function: { name: "tldm_confirm", arguments: JSON.stringify({ command, session: String(direct.session || session), question: String(direct.text || command) }) } },
        used,
        steps: tldmSteps,
      };
    }
    if (direct?.type === "text") {
      // commands the model ran on its OWN computer inside the Studio (T-LDM's computer is a shell): shown as computer_run steps, like every other tool the app sees
      const allRan = Array.isArray(direct.computer_steps) ? direct.computer_steps.slice(0, 8) : [];
      // only commands that worked count as the head's work; a broken command (bash syntax error) is not shown as a step and never becomes the answer
      const ran = allRan.filter((step) => step?.ok !== false);
      if (allRan.length > ran.length) opts.onEvent?.("info", `T-LDM: ${allRan.length - ran.length} failed command(s) dropped`);
      for (const step of ran) {
        const command = String(step?.command || "").slice(0, 300);
        if (!command) continue;
        used.push("computer_run");
        opts.onEvent?.("tool", "computer_run " + command.slice(0, 200));
        opts.onStep?.({ type: "tool_start", name: "computer_run", args: JSON.stringify({ command }) });
        opts.onStep?.({ type: "tool_end", name: "computer_run", ok: step?.ok !== false });
        opts.onEvent?.("info", clip(String(step?.result || ""), 300));
      }
      const answer = String(direct.text || "").trim();
      // The head decided: no command, no tool. A plain conversation is then spoken by Sham Pro's BODY (the 4.5M head writes short command lines, not conversation: live 2026-11-22
      // its greeting came out doubled and cut mid-word, «...والبحثمرحبا! أنا شام برو...»). Same model, same Studio; the head's text stays the fallback.
      // The body writes the reply the user reads, streamed when the caller shows a live view: plainly when the head ran nothing that worked, or from the
      // results of the commands that did work (the head's own text is a short, often garbled command log, kept only as the last fallback).
      // a head reply that is readable and backed by commands that worked stands as it is (fast); garbled bytes (U+FFFD) or no working command -> the body writes it
      const headReadable = answer.length >= 2 && !/\uFFFD/.test(answer);
      // The head did no working step at all (live probe 2026-11-24: on «اعرض الملفات في المجلد الحالي» it wrote garbled bytes and ran nothing): the work is handed to
      // Sham Pro's body's own permission-checked tool loop below (computer_run, files, web: agent_step), the same model, instead of a tool-less chat answer.
      if (!ran.length && !used.length && tldmSteps === 1 && !opts.resume) {
        opts.onEvent?.("info", "T-LDM: the head ran no working step; Sham Pro's body continues with its own tools");
        tldmHandedOff = true;
        break tldmHead;
      }
      // live repeat probe 2026-11-25: «اشرح لي التمثيل الضوئي» -> the head ran a working but unrelated command and its log «الخرج: 221» stood as the answer.
      // The head's own text stands only for an explicit computer task (the user asked to run / list / install something); otherwise the body writes the reply.
      const headStands = ran.length > 0 && headReadable && tldmComputerTask;
      if (!headStands && !used.filter((name) => name !== "computer_run").length && tldmSteps === 1 && chatMessages.length) {
        const last = chatMessages[chatMessages.length - 1];
        const turns = ran.length && last?.role === "user"
          ? [...chatMessages.slice(0, -1), { role: "user" as const, content: `${last.content}\n\n[ما نُفّذ على حاسوبي الآن]\n${ran.map((step) => `$ ${String(step?.command || "").slice(0, 300)}\n${String(step?.result || "").slice(0, 1200)}`).join("\n").slice(0, 6000)}\n\nهذه أوامر نفذتُها على حاسوبي ونتائجها؛ استعملها فقط إن كانت صحيحة ومتعلقة بطلبي، ثم أجب عن طلبي أعلاه بلغة طلبي وباختصار.` }]
          : chatMessages;
        const budget = Math.max(1000, Math.min(timeout, left() - 1000));
        const spoken = opts.onDelta
          ? await shamGenerateChatStream(turns, 768, budget, opts.onDelta, { bypassContentHeuristics: Boolean(opts.ctx.owner), direct: true })
          : await shamGenerateChat(turns, 768, budget, { bypassContentHeuristics: Boolean(opts.ctx.owner), direct: true });
        const said = spoken?.type === "text" ? String(spoken.text || "").trim() : "";
        if (said) return { kind: "text", text: said, used, steps: tldmSteps + 1 };
      }
      return answer ? { kind: "text", text: answer, used, steps: tldmSteps } : { kind: "none", used, steps: tldmSteps };
    }
    if (direct && direct.type !== "busy" && direct.type !== "loading") return { kind: "reply", reply: direct, used, steps: tldmSteps };
    if (opts.continuable) return { kind: "more", messages, used, steps: tldmSteps };
    return { kind: "none", used, steps: tldmSteps };
  }

  // Ordinary Sham v2 chat sends native user/assistant roles. No hidden system prompt,
  // prompt rewriting, echo detector, content-triggered retry or canned answer is applied.
  // Tool/code/fresh-fact work stays in the separate permission-checked agent route.
  const resumeMessages = messages as Array<{ role?: string; content?: unknown; tool_calls?: CoderToolCall[] }>;
  const lastResumeMessage = resumeMessages[resumeMessages.length - 1];
  const canResumeDirectChat = !opts.resume || (
    lastResumeMessage?.role === "user" &&
    !resumeMessages.some((message) => message.role === "tool" || Boolean(message.tool_calls?.length))
  );
  if (v2 && canResumeDirectChat && directChatIntent && !needsFreshFacts(opts.text) && !tldmHandedOff) {
    const chatMessages = shamDirectChatMessages(opts.history, opts.text);
    if (lastUserContent(chatMessages) !== opts.text) {
      chatMessages.push({ role: "user", content: opts.text });
    }
    const timeout = Math.min(opts.askMs ?? 90000, Math.max(1000, left() - 1000));
    // Streaming is v2-only (its Studio has the endpoint); v1 has no stream, so it must still take the one-shot chat.
    const stream = variant === "v2" ? opts.onDelta : undefined;
    const runDirect = (turns: typeof chatMessages, onDelta = stream) => opts.ask
      ? ask(turns[turns.length - 1]?.content || opts.text, maxNew, timeout)
      : shamModeCtx.run(effMode, () => onDelta
        ? shamGenerateChatStream(turns, maxNew, timeout, onDelta, { bypassContentHeuristics: Boolean(opts.ctx.owner), direct: tldmPlainTurn })
        : shamGenerateChat(turns, maxNew, timeout, { bypassContentHeuristics: Boolean(opts.ctx.owner), direct: tldmPlainTurn }));
    const directAsk = () => runDirect(chatMessages);
    if (await isStopped()) return { kind: "stopped", used, steps: 0 };
    let direct = await directAsk();
    if (await isStopped()) return { kind: "stopped", used, steps: 1 };
    let waited = 0;
    while (direct && (direct.type === "busy" || direct.type === "loading") && left() > 12000 && waited < 2) {
      if (await isStopped()) return { kind: "stopped", used, steps: waited };
      waited++;
      const info = opts.queueNote ? await opts.queueNote(waited).catch(() => null) : null;
      opts.onEvent?.("info", info || `⏳ طلبك في الدور وسيبدأ تلقائياً (محاولة ${waited})`);
      opts.onStep?.({ type: "queue", text: info || `في الدور (محاولة ${waited})` });
      await new Promise((res) => setTimeout(res, process.env.NODE_ENV === "test" ? 0 : 2500));
      direct = await directAsk();
    }
    if (await isStopped()) return { kind: "stopped", used, steps: 1 + waited };
    if (direct?.type === "text") {
      let answer = String(direct.text || "").trim();
      const prior = [...(opts.history || []), ...historyFromTurns(chatMessages.slice(0, -1))];
      const stale = isTrainingStatusReply(answer) || isEchoedPriorReply(answer, prior);
      if (stale && answer && left() > 8000) {
        // The new user turn was ignored (copied previous reply) or the body recited a training report.
        // Retry once with only this question so a cached/truncated prompt cannot be reused.
        opts.onEvent?.("info", isTrainingStatusReply(answer) ? "dropped a training-status reply; retrying the current question only" : "dropped a copied previous reply; retrying the current question only");
        if (isTrainingStatusReply(answer)) void shamAdminNotice(answer, opts.ctx.chatId).catch(() => null);
        const retry = await runDirect([{ role: "user", content: opts.text }], undefined);
        const again = String(retry?.type === "text" ? retry.text || "" : "").trim();
        if (again && !isTrainingStatusReply(again) && !isEchoedPriorReply(again, prior)) {
          // Do not stream(again) through onDelta: that callback appends, so the typist would
          // show the copied first answer plus the retry. Replace the live text instead.
          if (opts.onReplace) opts.onReplace(again);
          else if (stream) stream(again);
          answer = again;
        } else {
          if (isTrainingStatusReply(again)) void shamAdminNotice(again, opts.ctx.chatId).catch(() => null);
          answer = STALE_REPLY_USER;
        }
      } else if (isTrainingStatusReply(answer)) {
        void shamAdminNotice(answer, opts.ctx.chatId).catch(() => null);
        answer = STALE_REPLY_USER;
      }
      return answer
        ? { kind: "text", text: answer, used, steps: 1 + waited }
        : { kind: "none", used, steps: 1 + waited };
    }
    if (direct && direct.type !== "busy" && direct.type !== "loading") return { kind: "reply", reply: direct, used, steps: 1 + waited };
    if (opts.continuable) return { kind: "more", messages, used, steps: waited };
    return { kind: "none", used, steps: waited };
  }

  // the old body has a ~384-token window; the new body (Qwen3, Studio with SHAM_LIMITS=open) holds ~1200 prompt tokens (~3.6 chars/token): a longer conversation, longer tool results
  const lim = v2 ? { turns: 10, turnChars: 1400, maxChars: 10000 } : { turns: 6, turnChars: 400, maxChars: 3600 };
  const toolClip = v2 ? 5000 : 1800;
  let recoveries = 0;
  let mediaRefused = false;
  let steps = 0;
  const runMedia = async (call: CoderToolCall, usedNow: string[], stepNow: number): Promise<ShamAgentResult> => {
    let a: { kind?: string; prompt?: string; scenes?: unknown; narration?: unknown; seconds?: number } = {};
    try { a = JSON.parse(call.function.arguments || "{}"); } catch { /* validated already */ }
    const kind = (["image", "audio", "video"].includes(String(a.kind)) ? a.kind : "image") as "image" | "audio" | "video";
    const scenes = Array.isArray(a.scenes) ? a.scenes.map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 6) : undefined;
    const narration = String(a.narration || "").trim().slice(0, 1500) || undefined;
    opts.onEvent?.("tool", "make_media " + kind + " via selected route: " + String(a.prompt || "").slice(0, 80));
    opts.onStep?.({ type: "tool_start", name: "make_media", args: JSON.stringify({ kind }) });
    const r = await (opts.media || defaultMedia)(kind, String(a.prompt || "").slice(0, 600), { scenes, narration, seconds: typeof a.seconds === "number" ? a.seconds : undefined });
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
  const defaultMedia = async (k: "image" | "audio" | "video", pr: string, mediaOpts: { scenes?: string[]; narration?: string; seconds?: number } = {}): Promise<ShamReply | null> =>
    generateShamMediaThroughRoute(k, pr, { ...mediaOpts, timeoutMs: Math.min(240000, Math.max(20000, left() - 3000)), bypassContentHeuristics: Boolean(opts.ctx.owner) });
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
    if (await isStopped()) return { kind: "stopped", used, steps };
    if (left() < 6000) break;
    // a greeting or a plain code question: no tool block in the prompt (about 1,000 tokens fewer to read); only on the very first step of a fresh request
    const bare = prof.lite && steps === 0 && !opts.resume && recoveries === 0;
    const toolsNow = bare ? [] : opts.tools;
    const prompt = k.note ? `${k.note}\n${shamToolConversation(messages, toolsNow, lim)}` : shamToolConversation(messages, toolsNow, lim);
    let reply = await stepAsk(prompt, maxNew, Math.min(opts.askMs ?? 90000, left() - 1000), toolsNow);
    if (await isStopped()) return { kind: "stopped", used, steps: steps + 1 };
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
    if (reply.type === "embedded_step" && reply.tool_call) {
      // The model ran its OWN computer/browser call inside its loop: the app records it exactly like a tool it ran itself (progress card, streamed report line, the
      // step counted, the task carried on across legs), then asks again. One short Studio call per step, so the connection is never held open.
      const c = reply.tool_call as CoderToolCall;
      used.push(c.function.name);
      opts.onEvent?.("tool", `${c.function.name} ${String(c.function.arguments || "").slice(0, 200)}`);
      opts.onStep?.({ type: "tool_start", name: c.function.name, args: String(c.function.arguments || "") });
      const result = String(reply.result || "");
      opts.onStep?.({ type: "tool_end", name: c.function.name, ok: !/^error/i.test(result) });
      opts.onEvent?.("info", clip(result, 300));
      if (reply.desktop) {
        opts.onEvent?.("info", "🖥 شام يعرض لك شاشته الآن.");
        opts.onEvent?.("screen", JSON.stringify({ model: opts.ctx.modelId }));      // the Mini App opens the screen by itself when it sees this
      }
      messages.push({ role: "assistant", content: String(reply.text || ""), tool_calls: [c] } as CoderMessage);
      messages.push({ role: "tool", name: c.function.name, tool_call_id: c.id, content: clip(result, toolClip) } as CoderMessage);
      continue;
    }
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
    if (await isStopped()) return { kind: "stopped", used, steps: steps + 1 };
    const valid = p.calls.filter((c) => !validateShamCall(c, toolsNow));
    if (!valid.length) {
      if (p.calls.length || brokenCallAttempt(p.text)) {
        return { kind: "text", text: "لم يُنفّذ الاستدعاء الأخير: لم أتمكّن من تكوين طلب صالح للأداة. أعد المحاولة أو حدّد المعلومات الناقصة.", used, steps: steps + 1 };
      }
      const final = p.text.trim();
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
      // Live task suite 2026-11-12: Sham v1 answered "what is the capital of Egypt", a web search and a file read by calling make_media (a blank picture). The model may make a
      // picture / sound / clip only when the user's own message asks for one (the same detector the fast lane uses); otherwise it is told to answer in words, once.
      const lastUser = String([...messages].reverse().find((m) => m.role === "user")?.content || "");
      if (opts.mediaAsked && !opts.mediaAsked(lastUser.slice(0, 300)) && !mediaRefused) {
        mediaRefused = true;
        messages.push({ role: "assistant", content: p.text, tool_calls: [made] } as CoderMessage);
        messages.push({ role: "tool", name: "make_media", tool_call_id: made.id, content: "error: the user did not ask for a picture, sound or video. Answer their message in words." } as CoderMessage);
        continue;
      }
    }
    if (made) {
      // a picture / sound / clip takes minutes on the CPU Studio (measured: 123 s for a 256x256 picture): inside the webhook it goes to the background leg, which waits long
      if (opts.continuable && left() < 160000) {
        messages.push({ role: "assistant", content: p.text, tool_calls: [made] } as CoderMessage);
        return { kind: "more", messages, used: [...used, "make_media"], steps: steps + 1 };
      }
      return runMedia(made, [...used, "make_media"], steps + 1);
    }
    const secret = valid.find((c) => c.function.name === "request_secret");
    if (secret) {
      // the secure box: the app shows a masked field; the value never enters the chat, and the model only learns the name. The round ends with the request.
      let nm = "", why = "";
      try { const a = JSON.parse(secret.function.arguments || "{}") as { name?: string; purpose?: string }; nm = String(a.name || "").trim(); why = String(a.purpose || "").trim(); } catch { /* the validator already checked it */ }
      const V = await import("@/lib/secretVault");
      if (!V.isSecretName(nm)) {
        messages.push({ role: "assistant", content: p.text, tool_calls: [secret] } as CoderMessage);
        messages.push({ role: "tool", name: "request_secret", tool_call_id: secret.id, content: "error: name must be letters, digits, - or _ (2-40 characters, starting with a letter)" } as CoderMessage);
        continue;
      }
      V.requestSecret(opts.ctx.chatId, nm, why);
      return { kind: "ask", question: `🔐 ${why || nm}\n\nافتح «الخانة الآمنة» في التطبيق المصغر وأدخل القيمة هناك (لا تكتبها في المحادثة). اسمها: ${nm}`, used, steps: steps + 1 };
    }
    const handed = valid.find((c) => c.function.name === "computer_handoff");
    if (handed) {
      // the user takes over Sham's own screen (sign-in, code, captcha): the Mini App opens it with the control bar; Done continues the chat with a short follow-up
      const H = await import("@/lib/computerHandoff");
      let raw: unknown = {};
      try { raw = JSON.parse(handed.function.arguments || "{}"); } catch { /* checked below */ }
      const h = H.cleanHandoff(raw);
      if (!h) {
        messages.push({ role: "assistant", content: p.text, tool_calls: [handed] } as CoderMessage);
        messages.push({ role: "tool", name: "computer_handoff", tool_call_id: handed.id, content: "error: give kind and a short reason (what the user should do on the screen)" } as CoderMessage);
        continue;
      }
      opts.onEvent?.("screen", H.handoffEvent(opts.ctx.modelId, h, "chat"));
      return { kind: "ask", question: H.handoffChatText(h, opts.ctx.modelId === "sham_v2" ? "شام برو" : "شام"), used: [...used, "computer_handoff"], steps: steps + 1 };
    }
    const asked = valid.find((c) => c.function.name === "ask_user");
    if (asked) {
      let q = "";
      try { q = String((JSON.parse(asked.function.arguments || "{}") as { question?: string }).question || ""); } catch { /* the validator already checked it */ }
      // live repeat probe 2026-11-25: «ما الفرق بين بايثون وجافاسكربت؟» came back as ask_user with the user's OWN question, i.e. the user's words echoed as
      // Sham Pro's reply. An echo is not a clarifying question: Sham Pro's body answers the request directly (same model, same Studio).
      if (v2 && isEchoOfRequest(q, opts.text) && left() > 4000) {
        const turns = shamDirectChatMessages(opts.history, opts.text);
        if (lastUserContent(turns) !== opts.text) turns.push({ role: "user", content: opts.text });
        const said = await shamModeCtx.run(effMode, () => shamGenerateChat(turns, maxNew, Math.max(1000, Math.min(opts.askMs ?? 90000, left() - 1000)), { bypassContentHeuristics: Boolean(opts.ctx.owner), direct: true }));
        const text = said?.type === "text" ? String(said.text || "").trim() : "";
        if (text && !isEchoOfRequest(text, opts.text)) return { kind: "text", text, used, steps: steps + 1 };
      }
      return { kind: "ask", question: q, used, steps: steps + 1 };
    }
    const write = valid.find((c) => shamNeedsOk(c));
    if (write) return { kind: "confirm", call: write, used, steps: steps + 1 };
    messages.push({ role: "assistant", content: p.text, tool_calls: valid.slice(0, 3) } as CoderMessage);
    for (const c of valid.slice(0, 3)) {
      if (await isStopped()) return { kind: "stopped", used, steps: steps + 1 };
      used.push(c.function.name);
      opts.onEvent?.("tool", `${c.function.name} ${String(c.function.arguments || "").slice(0, 200)}`);
      opts.onStep?.({ type: "tool_start", name: c.function.name, args: String(c.function.arguments || "") });
      let result: string;
      try { result = c.function.name === "delegate" ? await runDelegate(c) : await exec(c, opts.ctx); } catch (e) { result = `error: ${(e as Error).message || "tool failed"}`; }
      if (await isStopped()) return { kind: "stopped", used, steps: steps + 1 };
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
    if (r && r.type === "text" && (r.text || "").trim()) {
      let final = String(r.text).trim();
      const verifier = opts.verifyAsk || (!opts.ask ? ask : undefined);
      if (verifier && left() > 6500) {
        opts.onEvent?.("info", "مرحلة التحقق: مراجعة الإجابة مقابل نتائج الأدوات المنفذة.");
        const verifyPrompt = [
          shamToolConversation(messages, [], lim).replace(/\nشام:$/, ""),
          "[مرحلة التحقق — ليست مهمة جديدة]",
          "راجع الإجابة المقترحة مقابل نتائج الأدوات المسجلة فقط. لا تدّعِ نجاح تنفيذ أو اختبار أو نشر ما لم تظهر نتيجة نجاح صريحة. صحّح الإجابة إن تجاوزت ما تدعمه النتائج، ثم أعد الجواب النهائي فقط.",
          "الإجابة المقترحة: " + final.slice(0, 1800),
        ].join("\n\n");
        try {
          const checked = await verifier(verifyPrompt, Math.min(maxNew, 180), Math.min(25000, left() - 500));
          if (checked?.type === "text" && String(checked.text || "").trim()) final = String(checked.text).trim();
        } catch { /* retain the best available final response */ }
      }
      return { kind: "text", text: final, used, steps };
    }
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
