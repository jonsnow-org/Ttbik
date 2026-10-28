// ONE mode system for every model (Nova, Sham, Sham v2). Documented in docs/MODES.md.
//
// Three user-facing modes (the stored ids stay fast / balanced / precise, "accurate" is accepted as an alias of precise):
//   fast     سريع   : no thinking, short answers, hot sampling; for chat and quick questions
//   balanced متوازن : the default. No thinking unless the user switched "deeper thinking" on or a run is stuck; normal budgets
//   precise  دقيق   : long answers allowed, cold sampling, a SHORT thought on the first step of a code / agent task, more correction rounds
// "Auto" (default ON, per model): each request is classified (trivial / chat / code / agentic / media) and the mode actually used is chosen from the user's
// preference and the class (table in docs/MODES.md). Trivial messages and media requests never think. The user's own "deeper thinking" switch can only turn thinking
// ON for code / agent work (never for trivial or media), and only on the FIRST step of a task: later steps think again only after a detected loop (stall level 2).
// Nothing here talks to a Studio: callers (coderSections for Nova, shamAgent / shamStudio for Sham) read the Profile.
import { detectMediaIntent } from "@/lib/coderMediaFast";

export type Pref = "fast" | "balanced" | "precise";
export type ReqClass = "trivial" | "chat" | "code" | "agentic" | "media";
export type ModelFamily = "nova" | "sham" | "sham_v2";

export const MODE_IDS: readonly Pref[] = ["fast", "balanced", "precise"];
export function normalizePref(x: unknown): Pref | undefined {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "fast" || s === "balanced" || s === "precise") return s;
  if (s === "accurate") return "precise";
  return undefined;
}

// ---------------------------------------------------------------- classification of one request
const GREETING = /^(?:(?:ال)?سلام(?: عليكم)?(?: ورحمة الله(?: وبركاته)?)?|مرحب[اًا]?|مرحبتين|أهلا|اهلا|أهلاً|اهلاً|هلا|هاي|هلو|صباح الخير|مساء الخير|صباح النور|مساء النور|كيفك|كيف حالك|كيف حالك اليوم|شلونك|كيف الحال|شكرا|شكراً|شكرا لك|مشكور|تسلم|يعطيك العافية|ممتاز|رائع|الحمد لله|وداعا|مع السلامة|باي|من انت|من أنت|مين انت|ما اسمك|ما هو اسمك|who are you|what is your name|hi|hello|hey|hola|salam|thanks|thank you|thx|bye|good (?:morning|evening|night))(?:\s+(?:يا\s*)?[\p{L}]{0,12})?[\s!.؟?،,🌹👋😊🙏❤️]*$/iu;
const CODE_CUES = /```|\b(?:def|class|function|const|import|return|npm|pip|git|docker|sql|api|json|regex|bug|error|exception|stack ?trace|compile|test|unit test|refactor|lint|typescript|javascript|python|java|rust|golang|css|html|react|next\.?js|node)\b|كود|برمج|دالة|دوال|سكربت|سكريبت|خطأ|اخطاء|أخطاء|اصلح|أصلح|صحح|صلح|اختبار|اختبارات|ترجم الكود|حلل الكود|اشرح الكود|خوارزمية|قاعدة بيانات|استعلام/i;
const AGENT_CUES = /github\.com|\b[\w.-]+\/[\w.-]+\b.*\b(?:repo|repository|pr|pull|branch|commit)\b|\b(?:repo|repository|pull request|pr|merge|branch|commit|push|deploy|workflow|ci|issue|issues|readme|refactor the)\b|مستودع|ريبو|دمج|فرع|كوميت|ارفع|رفع|انشر|نشر|طلب دمج|مشكلة في المستودع|اقرأ (?:الملف|الملفات|ملف)|كل الملفات|المشروع كله|ثم |وبعد ذلك|خطوة بخطوة|حلل المشروع|راجع المشروع|اجدول|جدول|ذكرني|كل يوم|كل اسبوع|ابحث|بحث عميق|research/i;

/** What kind of request is this? Pure text heuristics: cheap, deterministic, no model call. */
export function classifyRequest(text: string): ReqClass {
  const t = String(text || "").trim();
  if (!t) return "chat";
  if (detectMediaIntent(t)) return "media";
  if (t.length <= 60 && !t.includes("\n") && GREETING.test(t)) return "trivial";
  if (AGENT_CUES.test(t) || t.length > 700 || /github\.com\/|\b[\w.-]+\/[\w.-]+\.(?:ts|tsx|js|py|md|json)\b/.test(t)) return "agentic";
  if (CODE_CUES.test(t) || /[{};]\s*\n|=>|\bdef\s+\w+\(|\)\s*\{/.test(t)) return "code";
  return "chat";
}

// ---------------------------------------------------------------- the effective mode
/** The mode actually used for a request. `auto` off = the user's preference as chosen, except that trivial and media never get more than fast. */
export function effectiveMode(pref: Pref, klass: ReqClass, auto: boolean): Pref {
  if (klass === "trivial" || klass === "media") return "fast";
  if (!auto) return pref;
  switch (klass) {
    case "chat": return pref === "precise" ? "balanced" : "fast";          // simple conversation is answered fast; a precise user still gets a balanced chat
    case "code": return pref;
    case "agentic": return pref === "fast" ? "balanced" : pref;            // tool use needs a minimum of care: never below balanced
  }
}

export type Profile = {
  pref: Pref; mode: Pref; klass: ReqClass; auto: boolean;
  /** Thinking on the FIRST step of the task (later steps: only a loop recovery turns it on). */
  think: boolean;
  /** Nova: characters of thought allowed (sent as "1:<cap>"). */
  thinkCapChars: number;
  /** Sham v2: tokens of thought allowed (sent in the [[sham ...]] header). */
  thinkTokens: number;
  /** Nova: answer cap per step in tokens for plain replies (0 = none; code and tool steps are never cut). */
  maxTokens: number;
  temperature: number;
  /** Sham: multiplier of the answer budget, and correction rounds for a wrong tool call. */
  maxNewFactor: number;
  corrections: number;
  /** Nova: answer this with the short system text and no tool list (greetings and thanks). */
  lite: boolean;
  /** One line added to the request: tells the model what the user wants. */
  note: string;
  /** Sham v2 pictures (Studio side, SDXS): pixel size and steps. */
  image: { size: number; steps: number };
};

export const TEMPERATURE: Record<Pref, number> = { fast: 0.7, balanced: 0.6, precise: 0.2 };
/** Characters of thought (Nova) by mode. Env CODER_THINK_CAP_<MODE> overrides. */
export const THINK_CAP_CHARS: Record<Pref, number> = { fast: 500, balanced: 1200, precise: 1800 };
/** Tokens of thought (Sham v2) by mode. */
export const THINK_TOKENS: Record<Pref, number> = { fast: 100, balanced: 250, precise: 500 };
/** Answer caps (tokens) for plain Nova replies: trivial / chat. Code and tool steps are never capped (a cut tool call is a failed call). */
export const CHAT_MAX_TOKENS: Record<Pref, number> = { fast: 450, balanced: 900, precise: 1600 };
export const TRIVIAL_MAX_TOKENS = 200;
export const IMAGE_BY_MODE: Record<Pref, { size: number; steps: number }> = { fast: { size: 512, steps: 1 }, balanced: { size: 512, steps: 1 }, precise: { size: 512, steps: 2 } };

const NOTE: Record<Pref, string> = {
  fast: "SPEED: the user wants a fast, short answer: at most five short sentences unless code is needed. Skip optional checks.",
  balanced: "",
  precise: "ACCURACY: the user chose maximum precision. Double-check every fact and line of code, verify in the sandbox before claiming something works, and say plainly when you are not sure.",
};
const NOTE_SHAM: Record<Pref, string> = {
  fast: "المستخدم يفضّل جواباً سريعاً ومختصراً.",
  balanced: "",
  precise: "المستخدم اختار أقصى دقة: راجع كل معلومة وكل سطر كود قبل الجزم، وقل بصراحة إن لم تكن متأكداً.",
};

const envCap = (m: Pref): number => Number(process.env[`CODER_THINK_CAP_${m.toUpperCase()}`]) || THINK_CAP_CHARS[m];

export type ProfileInput = {
  model?: ModelFamily; pref?: unknown; auto?: boolean; thinkSwitch?: boolean; text?: string;
  /** a ready class (the run remembers it): skips the classification */
  klass?: ReqClass;
  /** the owner's forced mode for this model (wins over the preference and auto) */
  force?: unknown;
  /** the old Sham body cannot think at all */
  canThink?: boolean;
  /** pressure mode (owner switch): smaller pictures, no extra steps */
  pressure?: boolean;
};

export function resolveProfile(i: ProfileInput): Profile {
  const forced = normalizePref(i.force);
  const pref = forced || normalizePref(i.pref) || "balanced";
  const auto = forced ? false : i.auto !== false;
  const klass = i.klass || classifyRequest(i.text || "");
  const mode = effectiveMode(pref, klass, auto);
  const work = klass === "code" || klass === "agentic";
  const sham = i.model === "sham" || i.model === "sham_v2";
  const canThink = i.canThink ?? (i.model !== "sham");
  // thinking: only for real work (code / agent). The user's switch asks for it; precise mode thinks briefly by itself; balanced and fast never think by themselves.
  const think = canThink && work && (Boolean(i.thinkSwitch) || mode === "precise");
  const image = i.pressure ? { size: 384, steps: 1 } : IMAGE_BY_MODE[mode];
  return {
    pref, mode, klass, auto, think,
    thinkCapChars: envCap(mode), thinkTokens: think ? THINK_TOKENS[mode] : 0,
    maxTokens: klass === "trivial" ? TRIVIAL_MAX_TOKENS : klass === "chat" || klass === "media" ? CHAT_MAX_TOKENS[mode] : 0,
    temperature: TEMPERATURE[mode],
    maxNewFactor: mode === "fast" ? 0.6 : mode === "precise" ? 1.5 : 1,
    corrections: mode === "fast" ? 1 : mode === "precise" ? 3 : 2,
    lite: !sham && klass === "trivial",
    note: sham ? NOTE_SHAM[mode] : NOTE[mode],
    image,
  };
}

/** The Nova "lite" system text for greetings and thanks: identity and language only; the same text every time (so the Studio caches it). */
export const NOVA_LITE_SYSTEM = [
  "You are Nova AI, a friendly coding assistant. Reply in the user's language (Arabic or English), in one or two short sentences.",
  "Identity: you are Nova AI, with your own identity. If asked who you are or who made you, answer simply: \"I'm Nova AI\" (in the user's language). Never say you were made, trained or built by any team, company or model, never name a base model, and do not discuss training details.",
  "If the user asks for something that needs tools (code, files, GitHub, search), say you will do it and ask for the details; do not pretend to have done anything.",
].join("\n");
