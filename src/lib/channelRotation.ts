import { channelBotToken } from "@/lib/channelPublisher";
import { callGroq } from "@/lib/groq";
import { fetchTopStories } from "@/lib/newsRss";
import { ARTICLE_ITEMS } from "@/lib/articlesIndex";
import { EVENT_ITEMS } from "@/lib/eventsIndex";
import { CHANNEL_CHANGELOG } from "@/lib/channelChangelog";
import { isSafeForChannel } from "@/lib/channelPublisher";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Channel rotation. Owner list, 2026-10-07:
 *   1. Sham AI news, events, articles, tools (one per cron slot)
 *   2. Literium once every 2 days
 *   3. Athar on Getgems once every 3 days
 * No title or link repeated inside 46 hours (the 2-day window, with a
 * small gap so the every-48h Literium post is not blocked by itself).
 * Athar text must not promise profit, price growth, or returns.
 * Media is a generated still (man or woman explaining). Free video lanes
 * do not finish inside the Vercel cron budget, so a failed still skips
 * the post instead of shipping text-only.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
const STATE_KEY = "channel_rotation_state";
const LITERIUM_URL = "https://literium.ai.studio/";
const ATHAR_GETGEMS = "https://getgems.io/collection/EQAuIOwjzSmGQfL925LjD5eG0Qk1zJNRk4Ap8jzSOwnCRIYf";
const TWO_DAYS_MS = 46 * 3600 * 1000;
const LITERIUM_EVERY_MS = 48 * 3600 * 1000;
const ATHAR_EVERY_MS = 72 * 3600 * 1000;

const TOOLS: { title: string; blurb: string; url: string }[] = [
  { title: "بطاقة أعمال رقمية", blurb: "صفحة روابط مجانية مع عداد مشاهدات حقيقي.", url: `${SITE_URL}/free-tools/digital-card` },
  { title: "مصغّر روابط", blurb: "رابط قصير مع عداد نقرات، مجاناً.", url: `${SITE_URL}/free-tools/url-shortener` },
  { title: "ضغط الصور", blurb: "ضغط وتحويل الصور داخل المتصفح بلا رفع.", url: `${SITE_URL}/free-tools/image-optimizer` },
  { title: "رابط واتساب", blurb: "مولّد رسالة طلب جاهزة عبر واتساب.", url: `${SITE_URL}/free-tools/whatsapp-link` },
  { title: "أسماء المشاريع", blurb: "اقتراح أسماء مشاريع بالذكاء الاصطناعي.", url: `${SITE_URL}/free-tools/business-name-generator` },
  { title: "مساعد الكتابة", blurb: "منشورات وأوصاف منتجات وترجمة.", url: `${SITE_URL}/free-tools/writing-assistant` },
  { title: "محلل النصوص", blurb: "تلخيص ونقاط من نص طويل.", url: `${SITE_URL}/free-tools/text-analyzer` },
  { title: "عدّاد عمرك الحيّ", blurb: "عمرك بالثواني مع بطاقة يمكن مشاركتها.", url: `${SITE_URL}/free-tools/life-counter` },
  { title: "خمّن الكلمة", blurb: "كلمة عربية يومية بست محاولات.", url: `${SITE_URL}/guess-word` },
  { title: "مركز الأخبار", blurb: "عناوين من عدة مصادر بلا نسخ للمقالات.", url: `${SITE_URL}/news` },
  { title: "الأحداث", blurb: "مناسبات موثّقة بمصادرها.", url: `${SITE_URL}/events` },
  { title: "المقالات", blurb: "شروحات قصيرة مستقلة عن شريط العاجل.", url: `${SITE_URL}/articles` },
];

const ATHAR_BANNED =
  /(ربح|أرباح|اربح|استثمار|عائد|ضمانة|فرصة ذهبية|اثراء|إثراء|مضاعفة|نصيحة مالية|سعر يرتفع|floor|profit|invest|guaranteed)/i;

type Recent = { title: string; link: string; at: string };
type State = {
  recent: Recent[];
  lastLiteriumAt: string;
  lastAtharAt: string;
  cursor: number;
  postedChangelog: string[];
};

export type RotationResult = {
  ok: boolean;
  slot: number;
  topic?: string;
  kind?: string;
  reason?: string;
  text?: string;
};

function emptyState(): State {
  return { recent: [], lastLiteriumAt: "", lastAtharAt: "", cursor: 0, postedChangelog: [] };
}

async function loadState(): Promise<State> {
  try {
    const { data } = await supabaseAdmin().from("bot_settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const v = (data as { value?: Partial<State> } | null)?.value || {};
    return {
      recent: Array.isArray(v.recent) ? v.recent : [],
      lastLiteriumAt: typeof v.lastLiteriumAt === "string" ? v.lastLiteriumAt : "",
      lastAtharAt: typeof v.lastAtharAt === "string" ? v.lastAtharAt : "",
      cursor: typeof v.cursor === "number" ? v.cursor : 0,
      postedChangelog: Array.isArray(v.postedChangelog) ? v.postedChangelog : [],
    };
  } catch {
    return emptyState();
  }
}

async function saveState(state: State): Promise<void> {
  const trimmed = { ...state, recent: state.recent.slice(-200), postedChangelog: state.postedChangelog.slice(-100) };
  await supabaseAdmin().from("bot_settings").upsert({ key: STATE_KEY, value: trimmed, updated_at: new Date().toISOString() });
}

function canon(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

function fresh(state: State): Recent[] {
  const cut = Date.now() - TWO_DAYS_MS;
  return state.recent.filter((r) => Date.parse(r.at) > cut);
}

function seen(state: State, title: string, link: string): boolean {
  const t = title.trim();
  const l = canon(link);
  return fresh(state).some((r) => r.title.trim() === t || canon(r.link) === l);
}

function due(iso: string, every: number): boolean {
  const t = iso ? Date.parse(iso) : 0;
  return !t || Date.now() - t >= every;
}

type Item = { kind: string; title: string; blurb: string; url: string; athar?: boolean };

function changelogItem(state: State): Item | null {
  const entry = CHANNEL_CHANGELOG.find((e) => !state.postedChangelog.includes(e.id) && !seen(state, e.title, e.url));
  if (!entry) return null;
  return { kind: "tool", title: entry.title, blurb: entry.body, url: entry.url };
}

async function shamItem(state: State): Promise<Item | null> {
  const kinds = ["news", "event", "article", "tool"] as const;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[(state.cursor + i) % kinds.length];
    if (kind === "news") {
      const stories = await fetchTopStories(8).catch(() => []);
      for (const s of stories) {
        const top = s.items[0];
        const url = top.link;
        if (!seen(state, top.title, url)) {
          return {
            kind,
            title: top.title,
            blurb: `${top.source}. عنوان من تغطية شام AI، بلا نسخ للمقال.`,
            url,
          };
        }
      }
    } else if (kind === "event") {
      for (const e of EVENT_ITEMS) {
        const url = `${SITE_URL}/events/${e.slug}`;
        if (!seen(state, e.title, url)) return { kind, title: e.title, blurb: e.blurb || e.description, url };
      }
    } else if (kind === "article") {
      for (const a of ARTICLE_ITEMS) {
        const url = `${SITE_URL}/articles/${a.slug}`;
        if (!seen(state, a.title, url)) return { kind, title: a.title, blurb: a.description, url };
      }
    } else {
      const freshTool = changelogItem(state);
      if (freshTool) return freshTool;
      for (const t of TOOLS) {
        if (!seen(state, t.title, t.url)) return { kind, title: t.title, blurb: t.blurb, url: t.url };
      }
    }
  }
  return null;
}

function literiumItem(): Item {
  return {
    kind: "literium",
    title: "ليتيريوم",
    blurb: "تطبيق ليتيريوم للكتابة والقراءة بمساعدة الذكاء الاصطناعي، يعمل من المتصفح.",
    url: LITERIUM_URL,
  };
}

function atharItem(): Item {
  return {
    kind: "athar",
    title: "أثر على Getgems",
    blurb: "مجموعة أثر على شبكة TON: رمز لكل يوم في التقويم بين 1950 و2049. الرمز يتذكّر من امتلكه. الصفحة على Getgems للعرض فقط، بلا وعد ربح.",
    url: ATHAR_GETGEMS,
    athar: true,
  };
}

async function caption(item: Item): Promise<string> {
  const rules = item.athar
    ? "ممنوع أي وعد ربح أو استثمار أو عائد أو ارتفاع سعر. صِف المجموعة فقط: رمز لكل يوم، ذاكرة المالكين، ورابط Getgems."
    : "لا تخترع أرقاماً ولا أسعاراً.";
  const fallback = `${item.title}\n\n${item.blurb}\n\n🔗 ${item.url}`;
  try {
    const hook = await callGroq(
      `اكتب منشوراً عربياً لقناة تليجرام، 4 إلى 6 أسطر، إيموجيان كحد أقصى، بلا هاشتاق. ${rules} ضع هذا الرابط حرفياً في السطر الأخير دون تعديل: ${item.url}`,
      `العنوان: ${item.title}\nالوصف: ${item.blurb}`,
      280
    );
    const text = hook.trim();
    if (text && text.includes(item.url)) return text.slice(0, 900);
  } catch {
    /* fallback */
  }
  return fallback;
}

function imageUrl(item: Item, seed: number): string {
  const person = seed % 2 === 0 ? "adult Arab woman" : "adult Arab man";
  const prompt = [
    `Photorealistic ${person} presenter, modest clothing, waist-up, looking at camera,`,
    `explaining ${item.kind} in a quiet studio, soft light, no text, no letters, no logo, no money, no chart`,
  ].join(" ");
  const q = new URLSearchParams({
    width: "1024",
    height: "1024",
    nologo: "true",
    model: "flux",
    seed: String(seed),
    safe: "true",
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q.toString()}`;
}

async function sendPhoto(captionText: string, url: string): Promise<boolean> {
  const token = await channelBotToken();
  const channel = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !channel) return false;
  const img = await fetch(url, { signal: AbortSignal.timeout(22_000) }).catch(() => null);
  if (!img?.ok) return false;
  const bytes = Buffer.from(await img.arrayBuffer());
  if (bytes.length < 2000) return false;
  const form = new FormData();
  form.append("chat_id", channel);
  form.append("caption", captionText.slice(0, 1000));
  form.append("photo", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "post.jpg");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  return data?.ok === true;
}

export async function publishRotation(slot: number): Promise<RotationResult> {
  const state = await loadState();
  state.recent = fresh(state);

  let item: Item | null = null;
  if (due(state.lastLiteriumAt, LITERIUM_EVERY_MS) && !seen(state, "ليتيريوم", LITERIUM_URL)) item = literiumItem();
  else if (due(state.lastAtharAt, ATHAR_EVERY_MS) && !seen(state, "أثر على Getgems", ATHAR_GETGEMS)) item = atharItem();
  else item = await shamItem(state);

  if (!item) {
    await saveState(state).catch(() => null);
    return { ok: false, slot, reason: "nothing-new" };
  }

  const text = await caption(item);
  if (!isSafeForChannel(text) || (item.athar && ATHAR_BANNED.test(text)) || !text.includes(item.url)) {
    return { ok: false, slot, topic: item.title, kind: item.kind, reason: "blocked" };
  }

  const seed = Math.floor(Date.now() / 1000) % 100000;
  const posted = (await sendPhoto(text, imageUrl(item, seed))) || (await sendPhoto(text, imageUrl(item, seed + 1)));
  if (!posted) return { ok: false, slot, topic: item.title, kind: item.kind, reason: "media-failed" };

  state.recent.push({ title: item.title, link: item.url, at: new Date().toISOString() });
  if (item.kind === "literium") state.lastLiteriumAt = new Date().toISOString();
  if (item.kind === "athar") state.lastAtharAt = new Date().toISOString();
  if (item.kind !== "literium" && item.kind !== "athar") state.cursor += 1;
  const changelog = CHANNEL_CHANGELOG.find((e) => e.title === item!.title && e.url === item!.url);
  if (changelog) state.postedChangelog.push(changelog.id);
  await saveState(state).catch((e) => console.error("[channel-rotation] state save failed", e));
  return { ok: true, slot, topic: item.title, kind: item.kind, text };
}
