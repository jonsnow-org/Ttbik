// The fast lane for a plain "make me a picture / a clip" request (Nova in the chat).
// Why it exists: the general worker has to read the whole conversation first (minutes on a CPU) and then CHOOSE to call make_media; on 2026-10-28 12:57 the model
// instead wrote "the image service is unavailable" without calling anything, while Nova's media Studio was healthy. A request that is clearly "draw / generate a picture
// or video of X" does not need that decision: it is recognised here, X is turned into a short English prompt by one tiny call (the media models read English), and the
// ordinary pipeline runs (quota reserved -> Studio -> vetMedia -> Telegram, never a caption, quota handed back on failure).

export type MediaIntent = { kind: "image" | "video"; subject: string };

const norm = (s: string): string =>
  s.toLowerCase().replace(/ڤ/g, "ف").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

const set = (xs: string) => new Set(xs.split(/\s+/));
const VERBS = set("ولد ولدي ولدلي توليد تولد ارسم ارسمي رسم صمم تصميم اصنع صنع اصنعلي سوي سويلي سويلى انشئ انشئلي انشاء انتج انتاج اعمل اعملي اعطني اعطيني ابي ابغي ابغى اريد اريدك اطلب اظهر هات generate create draw make produce render imagine give show want need");
const DRAW = set("ارسم ارسمي رسم draw imagine");
const IMAGES = set("صوره صور رسمه لوحه لوغو لوجو شعار image picture photo pic logo wallpaper illustration");
const VIDEOS = set("فيديو فيديوهات فديو فديوهات فيدو فدو فيديوا فيديوه فديوه كليب انيميشن video videos clip animation");
/** Any spelling of "video" (فيديو / فديو / فيدو / ڤيديو / فيديوهات ...): after norm(), a word of the shape ف-ي?-د-ي?-و-ه?. */
const VIDEO_SHAPE = /^ف[يا]?د[يا]?[وؤ][هو]?(?:ات|ا)?$/;
const FILLER = set("قم قومي ممكن سمحت فضلك رجاء الرجاء لي لنا لو من مقطع please can could you me for a an the of i to some عن");
const NOT_WORDS = set("كود برمج code script html css python javascript موقع website تطبيق app ملف file github repo حلل اشرح كيف how explain describe عدل edit حول convert ترجم translate تحويل png jpg svg pdf رابط http ماذا وصف هذه هذي تلك this");
const bare = (w: string): string => w.replace(/^(ال|ب|ل|و|ف)(?=.{3,})/, "");
const inSet = (w: string, s: Set<string>): boolean => s.has(w) || s.has(bare(w));
const words = (t: string): string[] => t.split(/[^\p{L}\p{N}:/.]+/u).filter(Boolean);

/** A clear "make a picture / a video of X" request, or null (anything else goes to the general worker). */
export function detectMediaIntent(text: string): MediaIntent | null {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 300 || raw.startsWith("/")) return null;
  const ws = words(norm(raw));
  if (ws.some((w) => inSet(w, NOT_WORDS) || /^https?:/.test(w) || /^ما$/.test(w) && ws.includes("هي"))) return null;
  const verb = ws.some((w) => inSet(w, VERBS));
  const draw = ws.some((w) => inSet(w, DRAW));
  const video = ws.some((w) => inSet(w, VIDEOS) || VIDEO_SHAPE.test(w) || VIDEO_SHAPE.test(bare(w)));
  const image = ws.some((w) => inSet(w, IMAGES));
  if (!verb || !(video || image || draw)) return null;
  const subject = ws.filter((w) => !inSet(w, VERBS) && !inSet(w, IMAGES) && !inSet(w, VIDEOS) && !VIDEO_SHAPE.test(w) && !VIDEO_SHAPE.test(bare(w)) && !inSet(w, FILLER)).join(" ").trim();
  return { kind: video ? "video" : "image", subject: subject || norm(raw) };
}

// A last resort when the tiny model call is not answered in time: common words only. Unknown words are not guessed (the caller gives up honestly).
const GLOSSARY: Record<string, string> = {
  فرس: "horse", حصان: "horse", خيل: "horse", ابيض: "white", بيضاء: "white", اسود: "black", سوداء: "black", احمر: "red", حمراء: "red", ازرق: "blue", زرقاء: "blue", اخضر: "green", خضراء: "green", اصفر: "yellow", ذهبي: "golden", وردي: "pink",
  اسد: "lion", قطه: "cat", قط: "cat", كلب: "dog", طائر: "bird", عصفور: "bird", نسر: "eagle", سمكه: "fish", جمل: "camel", فيل: "elephant", ذئب: "wolf", نمر: "tiger", دب: "bear", ارنب: "rabbit", حصانا: "horse", فراشه: "butterfly",
  بحر: "sea", شاطئ: "beach", جبل: "mountain", غروب: "sunset", شروق: "sunrise", صحراء: "desert", غابه: "forest", نهر: "river", سماء: "sky", قمر: "moon", شمس: "sun", نجوم: "stars", ورده: "flower", زهره: "flower", شجره: "tree", مدينه: "city", بيت: "house", قلعه: "castle", سياره: "car", طائره: "airplane", سفينه: "ship", قارب: "boat", رجل: "man", امراه: "woman", طفل: "child", فتاه: "girl", ولد: "boy", روبوت: "robot", تنين: "dragon", فضاء: "space", مطر: "rain", ثلج: "snow", نار: "fire", كتاب: "book", قهوه: "coffee", طعام: "food",
  في: "in", على: "on", و: "and", مع: "with", جميل: "beautiful", كبير: "big", صغير: "small", قديم: "old", ليلا: "at night", نهارا: "in daylight",
};
export function glossaryPrompt(subject: string): string | null {
  const words = norm(subject).split(" ").filter(Boolean);
  const out: string[] = [];
  let known = 0;
  for (const w of words) {
    const bare = w.replace(/^(ال|و|ب|ل)(?=.{2,})/, "");
    const hit = GLOSSARY[w] || GLOSSARY[bare];
    if (hit) { out.push(hit); known++; }
    else if (/^[\x00-\x7f]+$/.test(w)) out.push(w);
    else return null;                                                  // an unknown Arabic word: do not guess
  }
  if (!known && !out.length) return null;
  // adjectives of the Arabic phrase follow the noun ("horse white"): put colours / adjectives first
  const adj = new Set(["white", "black", "red", "blue", "green", "yellow", "golden", "pink", "beautiful", "big", "small", "old"]);
  const a = out.filter((w) => adj.has(w));
  const rest = out.filter((w) => !adj.has(w));
  const phrase = [...a, ...rest].join(" ").replace(/\b(horse|lion|cat|dog|bird|eagle|fish|camel|elephant|wolf|tiger|bear|rabbit|butterfly|robot|dragon|car|house|castle|ship|boat)\b/, "a $1").replace(/^(a )?((white|black|red|blue|green|yellow|golden|pink|beautiful|big|small|old) )+a /, (m) => m.replace(/ a $/, " ").replace(/^a /, "a "));
  return phrase.trim() || null;
}

/** The text the Studio gets: short, English, only the picture itself. Never a caption, never shown to the user. */
export function cleanEnglishPrompt(text: string): string | null {
  const first = String(text || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
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

/** The model's own invented excuse "this feature is for owners only": media is open to every user within a daily quota (owner unlimited), so such a sentence is never shown. */
const OWNERS_ONLY = /(?:للمالك(?:ين)?\s*فقط|متاح(?:ة)?\s*فقط\s*(?:لل|ل)?مالك|خاص(?:ة)?\s*(?:بال|لل)?مالك(?:ين)?|مقتصر(?:ة)?\s*على\s*(?:ال)?مالك|owners?[\s-]*only|only\s+(?:for\s+)?(?:the\s+)?owners?)/i;
export const OWNERS_ONLY_FIX = "توليد الصور والفيديو والصوت متاح لجميع المستخدمين ضمن حصة يومية (للمالك بلا حد). اكتب الطلب مباشرةً، مثل: «قم بتوليد فيديو أرنب يلعب في الحديقة»، وسأنفّذه.";
export function stripOwnersExcuse(text: string): string {
  const t = String(text || "");
  return OWNERS_ONLY.test(t) && /(?:فيديو|فديو|مقطع|صور[ةه]?|صوت|توليد|وسائط|video|image|media|generat)/i.test(t) ? OWNERS_ONLY_FIX : t;
}
