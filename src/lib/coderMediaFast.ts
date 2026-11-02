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
  const secondsMatch = digits.match(/\b(10|15|30|60|120)\s*(?:seconds?|secs?|s)\b/i)
    || digits.match(/(10|15|30|60|120)\s*(?:ثواني|ثانية|ثانيه|ثوان)/i);
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

/** The text the Studio gets: short, English, only the picture itself. Never a caption, never shown to the user. */
export function cleanEnglishPrompt(text: string, opts: { preserveRaw?: boolean } = {}): string | null {
  const raw = String(text || "").trim();
  if (opts.preserveRaw) return raw ? raw.slice(0, 1800) : null;
  const first = raw.split("\n").map((l) => l.trim()).find(Boolean) || "";
  const t = first.replace(/^(prompt|english prompt)\s*[:\-]\s*/i, "").replace(/^["'`“”«»]+|["'`“”«»]+$/g, "").trim().slice(0, 300);
  if (t.length < 3) return null;
  const non = (t.match(/[^\x00-\x7f]/g) || []).length;
  return non / t.length > 0.15 ? null : t;
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
