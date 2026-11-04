// The fast lane for a plain "make me a picture / a clip" request (Nova in the chat).
// Why it exists: the general worker has to read the whole conversation first (minutes on a CPU) and then CHOOSE to call make_media; on 2026-10-28 12:57 the model
// instead wrote "the image service is unavailable" without calling anything, while Nova's media Studio was healthy. A request that is clearly "draw / generate a picture
// or video of X" does not need that decision: it is recognised here, X is turned into a short English prompt by one tiny call (the media models read English), and the
// ordinary pipeline runs (quota reserved -> Studio -> vetMedia -> Telegram, never a caption, quota handed back on failure).

export type MediaIntent = { kind: "image" | "video"; subject: string; seconds?: number };

const norm = (s: string): string =>
  s.toLowerCase().replace(/ڤ/g, "ف").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

const set = (xs: string) => new Set(xs.split(/\s+/));
const VERBS = set("قم قومي ولد ولدي ولدلي توليد تولد ارسم ارسمي رسم صمم تصميم اصنع صنع اصنعلي سوي سويلي سويلى انشئ انشئلي انشاء انتج انتاج اعمل اعملي اعطني اعطيني ابي ابغي ابغى اريد اريدك اطلب اظهر هات generate create draw make produce render imagine give show want need");
const DRAW = set("ارسم ارسمي رسم draw imagine");
const IMAGES = set("صوره صور رسمه لوحه لوغو لوجو شعار image picture photo pic logo wallpaper illustration");
const VIDEOS = set("فيديو فيديوهات فديو فديوهات فيدو فدو فيديوا فيديوه فديوه كليب انيميشن video videos clip animation");
/** Any spelling of "video" (فيديو / فديو / فيدو / ڤيديو / فيديوهات ...): after norm(), a word of the shape ف-ي?-د-ي?-و-ه?. */
const VIDEO_SHAPE = /^ف[يا]?د[يا]?[وؤ][هو]?(?:ات|ا)?$/;
const bare = (w: string): string => w.replace(/^(ال|ب|ل|و|ف)(?=.{3,})/, "");
const inSet = (w: string, s: Set<string>): boolean => s.has(w) || s.has(bare(w));
const words = (t: string): string[] => t.split(/[^\p{L}\p{N}:/.]+/u).filter(Boolean);

/** A clear "make a picture / a video of X" request, or null (anything else goes to the general worker). */
export type MediaFollowupContext = { previousUser?: string; previousAssistant?: string };

/** A short subject-only reply can complete an earlier media request, but only when
 * the immediately previous assistant turn explicitly asked for the missing visual description.
 * This avoids treating ordinary nouns in a normal chat as generation requests. */
export function detectMediaIntent(text: string, context: MediaFollowupContext = {}): MediaIntent | null {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 300 || raw.startsWith("/")) return null;
  const rawWords = words(raw);
  const ws = rawWords.map((word) => norm(word));
  if (ws.some((w) => /^https?:/.test(w) || /^ما$/.test(w) && ws.includes("هي"))) return null;
  const verb = ws.some((w) => inSet(w, VERBS));
  const draw = ws.some((w) => inSet(w, DRAW));
  const video = ws.some((w) => inSet(w, VIDEOS) || VIDEO_SHAPE.test(w) || VIDEO_SHAPE.test(bare(w)));
  const image = ws.some((w) => inSet(w, IMAGES));
  if (!verb || !(video || image || draw)) {
    const previous = String(context.previousAssistant || "");
    const clarification = /(?:اكتب|اذكر|صف).{0,70}(?:الوصف|ما الذي يظهر|ماذا يظهر)|ما الذي تريد أن يظهر.{0,45}(?:الصورة|الفيديو|المقطع)|ما المشهد الذي تريد أن يظهر.{0,45}(?:الفيديو|المقطع)|(?:الوصف|description).{0,60}(?:الصورة|الفيديو|المقطع|image|picture|video)|(?:what should appear|describe the subject).{0,70}(?:image|picture|video)/i.test(previous);
    if (!clarification || !raw || ws.some((w) => /^https?:/.test(w))) return null;
    const priorIntent = detectMediaIntent(String(context.previousUser || ""));
    const previousKind = /(?:فيديو|فديو|مقطع|video|clip)/i.test(previous) ? "video" : undefined;
    const followupKind = priorIntent?.kind || previousKind || "image";
    const subject = raw.trim().slice(0, 220);
    if (!subject || subject.length < 2) return null;
    return { kind: followupKind, subject };
  }
  const digits = raw.replace(/[٠-٩۰-۹]/g, (d) => String("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(d) % 10));
  const secondsMatch = digits.match(/\b(6|10|15|30|60|120)\s*(?:seconds?|secs?|s)\b/i)
    || digits.match(/(6|10|15|30|60|120)\s*(?:ثواني|ثانية|ثانيه|ثوان)/i);
  const minutesMatch = digits.match(/\b([12])\s*(?:minutes?|mins?|m)\b/i)
    || digits.match(/([12])\s*(?:دقيقة|دقائق|دقايق)/i);
  const requestedSeconds = secondsMatch ? Number(secondsMatch[1]) : minutesMatch ? Number(minutesMatch[1]) * 60
    : /دقيقتين/i.test(raw) ? 120 : /(?:^|[\s،])دقيقة(?:$|[\s،])/i.test(raw) ? 60 : undefined;
  const durationWords = /^(?:لمدة|لمده|مدة|مده|ثانيه|ثواني|ثوان|دقيقه|دقيقتين|دقائق|دقايق|second|seconds|sec|secs|minute|minutes|min|mins|s|m)$/i;
  let subject = rawWords.filter((_word, i) => !inSet(ws[i], VERBS) && !inSet(ws[i], IMAGES) && !inSet(ws[i], VIDEOS) && !VIDEO_SHAPE.test(ws[i]) && !VIDEO_SHAPE.test(bare(ws[i])) && !/^\d+$/.test(ws[i]) && !durationWords.test(ws[i])).join(" ").trim();
  // For English commands, isolate the complete visual noun phrase after the media type.
  if (/^[\x00-\x7f]+$/.test(raw)) {
    const visual = raw.match(/\b(?:image|picture|photo|logo|wallpaper|illustration|video|clip|animation)\b\s+(?:of|showing|depicting)?\s*(.+)$/i);
    if (visual?.[1]) subject = visual[1].trim().replace(/\s+(?:for\s+)?(?:10|15|30|60|120)\s*(?:seconds?|secs?|s|minutes?|mins?|m)\s*$/i, "").trim();
  }
  return { kind: video ? "video" : "image", subject: subject || norm(raw), ...(video && requestedSeconds ? { seconds: requestedSeconds } : {}) };
}

/** The instruction every picture / video prompt translator gets (Nova, Sham, Sham v2): the picture models read English only, so an Arabic request MUST be translated, faithfully. * + "Examples:\nقم بتوليد صورة فتاة شقراء حسناء => [tall] a beautiful blonde girl\nصورة امرأة جميلة بفستان أزرق => [tall] a beautiful woman in a blue dress\nارسم لي ولد صغير يلعب بالكرة في الحديقة => [wide] a small boy playing with a ball in a garden\nصورة امرأة ترتدي فستانا احمر على الشاطئ وقت الغروب => [tall] a woman wearing a red dress on the beach at sunset\nصورة فتاة ورجل يسيران بين الزهور => [wide] a girl and a man walking among flowers\nفيديو لاسد يركض في الصحراء => [wide] a lion running in the desert\nشعار لشركة قهوة => [square] a logo for a coffee company";
export type Aspect = "wide" | "tall" | "square";
/** The translator's leading frame tag ([wide] / [tall] / [square]) split from the prompt; no tag = the model's own default frame. */
export function splitAspect(text: string | null | undefined): { prompt: string | null; aspect?: Aspect } {
  const t = String(text || "").trim();
  const m = t.match(/^\[(wide|tall|square)\]\s*/i);
  if (!m) return { prompt: t || null };
  const rest = t.slice(m[0].length).trim();
  return { prompt: rest.length >= 3 ? rest : null, aspect: m[1].toLowerCase() as Aspect };
}

/** The text the Studio gets: short, English, only the picture itself. Never a caption, never shown to the user. */
export function cleanEnglishPrompt(text: string, opts: { preserveRaw?: boolean } = {}): string | null {
  const raw = String(text || "").trim();
  if (opts.preserveRaw) return raw ? raw.slice(0, 1800) : null;
  const first = raw.split("\n").map((l) => l.trim()).find(Boolean) || "";
}

const TOOL_NAMES = "web_search|fetch_page|deep_research|github_[a-z_]+|memory_save|memory_search|schedule_[a-z]+|connector_api|mcp_list_tools|mcp_call|sandbox_[a-z_]+|make_media|ask_user|view_image|view_video|run_command|bash";
/** A "final answer" that is really the model's plan of tool calls written as text («… ← sandbox_exec ثم sandbox_write_file.»): it must never reach the user as the answer. */
export function looksLikeToolPlan(text: string): boolean {
  const t = String(text || "").trim();
  if (!t || t.length > 600) return false;
  const names = t.match(new RegExp(`\\b(?:${TOOL_NAMES})\\b`, "g")) || [];
  if (!names.length) return false;
  const arrows = /(←|→|->|=>|\bثم\b|\bthen\b|\+)/.test(t);
  const mostlyTools = names.join("").length / t.replace(/\s+/g, "").length > 0.25;
  return arrows || mostlyTools || /^\s*(tool|call|plan|الأداة|أستخدم)\b/i.test(t);
}

/** Compatibility shim: preserve the model's wording exactly. */
export function stripOwnersExcuse(text: string): string { return String(text || ""); }

// ── The model decides (owner 2026-11-04: "the model must understand the request itself, not canned automation") ──────────────────────
// A message that MIGHT be about making media (a media word, or a short follow-up right after a media turn) is shown to the SELECTED model's
// own Studio with the last turns; the model answers one line: CHAT / IMAGE / VIDEO / AUDIO / NO, and for media the faithful English prompt
// in the same call (no second translation call, no other model's Studio). Code only parses that line; it never guesses the subject itself.
export type RoutedMedia =
  | { kind: "image"; prompt: string; aspect?: Aspect }
  | { kind: "video"; prompt: string; seconds: number; aspect?: Aspect }
  | { kind: "audio"; prompt: string }
  | { kind: "chat" }
  | { kind: "refuse" };

const MEDIA_WORDS = set("صوره صور رسمه رسم لوحه لوغو لوجو شعار خلفيه صوت صوتي اغنيه نشيد مقطع كليب انيميشن فيديو فديو image picture photo pic logo wallpaper illustration drawing video clip animation audio voice speech song narrate");
/** True when the message is worth asking the model about (cheap pre-check, never the decision itself). */
export function mediaRouteNeeded(text: string, context: MediaFollowupContext = {}): boolean {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 400 || raw.startsWith("/")) return false;
  if (detectMediaIntent(raw, context)) return true;
  const ws = words(raw).map((w) => norm(w));
  if (ws.some((w) => inSet(w, MEDIA_WORDS) || inSet(w, DRAW) || VIDEO_SHAPE.test(w) || VIDEO_SHAPE.test(bare(w)))) return true;
  // a short description right after a media request or a delivered picture/clip ("فتاة شقراء ترتدي ملابس سباحة")
  if (raw.length <= 220 && !/[?؟]\s*$/.test(raw)) {
    if (detectMediaIntent(String(context.previousUser || ""))) return true;
    if (/^(?:🖼️|🎬|🎙️)|أُرسلت الصورة|أُرسل المقطع|أُرسل الصوت/.test(String(context.previousAssistant || "").trim())) return true;
  }
  return false;
}

export const MEDIA_ROUTER_SYSTEM = "You route ONE new chat message of a user who can ask you to make pictures, short videos and speech with your own generators. Read the previous turns and the NEW message and answer with exactly ONE line, nothing else:\n"
  + "CHAT — the new message is not a request to make media right now (a question, code, chat, thanks, a request about a picture the user attached, asking how media works, downloading a video from a link).\n"
  + "IMAGE [wide|tall|square] <English prompt> — make a picture now.\n"
  + "VIDEO <seconds> [wide|tall|square] <English prompt> — make a video now; seconds = what the user asked (6, 10, 15, 30, 60 or 120), 10 when not stated. A message that says video / فيديو / فديو / مقطع is a VIDEO, never an IMAGE.\n"
  + "AUDIO <the exact words to speak, in the user's language> — read text aloud / make speech now.\n"
  + "A short message that only describes a subject, sent right after a picture or video request or result, continues it: same kind, the NEW subject.\n"
  + "English prompt rules: translate the user's description FAITHFULLY (every subject, number, colour, gender, age, body type, clothing, action and setting, in order of importance); never add, soften, replace or invent anything; drop only the command words and the duration; words of beauty (حسناء, جميلة, فاتنة, وسيم) mean beautiful / pretty / stunning / handsome and say nothing about clothing or the body; never add clothing, undressing, body or pose details the user did not write; up to 40 words. Ordinary portraits, people at a beach or pool, swimwear, everyday clothing, sports, and non-graphic medical or educational scenes are allowed. [wide] for scenes or several subjects, [tall] for one standing person, [square] otherwise.\n"
  + "Examples:\n"
  + "قم بتوليد صورة فتاة => IMAGE [tall] a girl\n"
  + "قم بتوليد صورة فتاة شقراء حسناء => IMAGE [tall] a beautiful blonde girl\n"
  + "قم بتوليد فديو فتاة ترقص 6 ثوان => VIDEO 6 [tall] a girl dancing\n"
  + "(after a picture request) فتاة شقراء ممتلئة ترتدي ملابس سباحة => IMAGE [tall] a chubby blonde girl wearing a swimsuit\n"
  + "قم بتوليد فديو ارنب يلعب في الحديقة => VIDEO 10 [wide] a rabbit playing in a garden\n"
  + "فيديو 30 ثانية لاسد يركض في الصحراء => VIDEO 30 [wide] a lion running in the desert\n"
  + "اقرأ بصوتك: مرحبا بكم في شام => AUDIO مرحبا بكم في شام\n"
  + "كيف أصنع فيديو بالذكاء الاصطناعي؟ => CHAT\n"
  + "شكرا الصورة جميلة => CHAT";

const SECONDS = [6, 10, 15, 30, 60, 120];
const nearestSeconds = (n: number): number => SECONDS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), 10);

/** Parses the router's one line. null = unreadable (the caller treats it as "the model did not decide"). */
export function parseMediaRoute(reply: string): RoutedMedia | null {
  const line = String(reply || "").replace(/<think>[\s\S]*?<\/think>/gi, "").split("\n").map((l) => l.trim().replace(/^[`*"'«“]+|[`*"'»”]+$/g, "")).find(Boolean) || "";
  const m = /^(CHAT|IMAGE|VIDEO|AUDIO|NO)\b[\s:—-]*(.*)$/i.exec(line);
  if (!m) return null;
  const head = m[1].toUpperCase();
  let rest = m[2].trim();
  if (head === "CHAT") return { kind: "chat" };
  if (head === "NO") return { kind: "refuse" };
  if (head === "AUDIO") return rest.length >= 1 ? { kind: "audio", prompt: rest.slice(0, 1200) } : null;
  let seconds = 10;
  if (head === "VIDEO") {
    const s = /^(\d{1,3})\s*(?:s|sec|seconds?)?\b\s*/i.exec(rest);
    if (s) { seconds = nearestSeconds(Number(s[1])); rest = rest.slice(s[0].length).trim(); }
  }
  const { prompt, aspect } = splitAspect(rest);
  const clean = prompt ? cleanEnglishPrompt(prompt) : null;
  if (!clean) return null;
  return head === "IMAGE" ? { kind: "image", prompt: clean, ...(aspect ? { aspect } : {}) } : { kind: "video", prompt: clean, seconds, ...(aspect ? { aspect } : {}) };
}

/** The router's decision checked against what the message literally names: a message that names a video (فيديو / فديو / مقطع / video) and a
 *  duration is a video of that duration even when a small model answered IMAGE (live 2026-11-04: LFM sent a photo for «فديو … 6 ثوان»).
 *  The model's own prompt is kept; only the kind / seconds the user wrote are restored. */
export function reconcileRoute(routed: RoutedMedia | null, text: string, context: MediaFollowupContext = {}): RoutedMedia | null {
  if (!routed || (routed.kind !== "image" && routed.kind !== "video")) return routed;
  const d = detectMediaIntent(text, context);
  if (!d || d.kind !== "video") return routed;
  const said = /(?:فيديو|فديو|فيدو|مقطع|video|clip)/i.test(String(text || ""));
  if (!said) return routed;
  const seconds = d.seconds ?? (routed.kind === "video" ? routed.seconds : 10);
  return { kind: "video", prompt: routed.prompt, seconds, ...(routed.aspect ? { aspect: routed.aspect } : {}) };
}

/** The router's user message: the last turns (short) + the new message. */
export function mediaRouterInput(text: string, context: MediaFollowupContext = {}): string {
  const prev = [
    context.previousUser ? "Previous user message: " + String(context.previousUser).slice(0, 300) : "",
    context.previousAssistant ? "Previous assistant reply: " + String(context.previousAssistant).slice(0, 300) : "",
  ].filter(Boolean).join("\n");
  return (prev ? prev + "\n" : "") + "NEW message: " + String(text).slice(0, 400);
}

export const MEDIA_NOT_DONE = "لم يُرسَل أي ملف هذه المرة: لم يكتمل إنشاء الوسائط. أعد إرسال طلبك وسأحاول مجدداً (لم يُحسب من حصتك).";
/** The answer without its sentences that claim a file was sent (nothing was delivered in this run). When nothing else is left:
 *  the "media did not finish" note if this run tried to make media, else a short honest line. */
export function dropMediaClaims(text: string, mediaTried: boolean): string {
  const parts = String(text || "").split(/(?<=[.!؟?。\n])/);
  const kept = parts.filter((p) => !claimsMediaSent(p)).join("").replace(/\n{3,}/g, "\n\n").trim();
  if (kept.replace(/[\s\p{P}\p{S}]/gu, "").length >= 2) return kept;
  return mediaTried ? MEDIA_NOT_DONE : "لم أُرسل أي ملف في هذا الرد.";
}

/** A final answer that says a picture / video / audio WAS sent. Used only to stop a false claim when nothing was delivered in that run. */
export function claimsMediaSent(text: string): boolean {
  const t = String(text || "");
  return /(?:أرسلت|أرسلتُ|تم إرسال|أُرسلت|أُرسل|ارسلت|هذه هي|ها هي|إليك)\s*(?:لك\s*)?(?:ال)?(?:صورة|صوره|الصورة|فيديو|الفيديو|المقطع|مقطع|الملف الصوتي|التسجيل)/.test(t)
    || /\b(?:i(?:'ve| have)? sent|here is|here's)\b[^.\n]{0,30}\b(?:image|picture|photo|video|clip|audio)\b/i.test(t);
}
