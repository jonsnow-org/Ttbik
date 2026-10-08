import { channelBotToken } from "@/lib/channelPublisher";
import { callGroq } from "@/lib/groq";
import { fetchTopStories } from "@/lib/newsRss";
import { ARTICLE_ITEMS } from "@/lib/articlesIndex";
import { EVENT_ITEMS } from "@/lib/eventsIndex";
import { CHANNEL_CHANGELOG } from "@/lib/channelChangelog";
import { isSafeForChannel } from "@/lib/channelPublisher";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Channel rotation. Owner list, 2026-10-08:
 *   1. Sham AI news, events, articles, tools (one per cron slot)
 *   2. Literium https://literium.ai.studio/ once every 2 days
 *   3. Athar on Getgems once every 3 days
 * No title or link repeated inside 46 hours.
 * Athar text must not promise profit, price growth, or returns.
 * Pollinations is banned: it ignored the prompt and posted an unrelated
 * photo of a child. Cards are drawn here so the picture matches the tool.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
const STATE_KEY = "channel_rotation_state";
const LITERIUM_URL = "https://literium.ai.studio/";
const ATHAR_GETGEMS = "https://getgems.io/collection/EQAuIOwjzSmGQfL925LjD5eG0Qk1zJNRk4Ap8jzSOwnCRIYf";
const TWO_DAYS_MS = 46 * 3600 * 1000;
const LITERIUM_EVERY_MS = 48 * 3600 * 1000;
const ATHAR_EVERY_MS = 72 * 3600 * 1000;
const MIN_GAP_MS = 90 * 60 * 1000;

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
  lastPostAt: string;
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
  return { recent: [], lastLiteriumAt: "", lastAtharAt: "", lastPostAt: "", cursor: 0, postedChangelog: [] };
}

async function loadState(): Promise<State> {
  try {
    const { data } = await supabaseAdmin().from("bot_settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const v = (data as { value?: Partial<State> } | null)?.value || {};
    return {
      recent: Array.isArray(v.recent) ? v.recent : [],
      lastLiteriumAt: typeof v.lastLiteriumAt === "string" ? v.lastLiteriumAt : "",
      lastAtharAt: typeof v.lastAtharAt === "string" ? v.lastAtharAt : "",
      lastPostAt: typeof v.lastPostAt === "string" ? v.lastPostAt : "",
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

type Item = { kind: string; title: string; blurb: string; url: string; athar?: boolean; label: string };

function changelogItem(state: State): Item | null {
  const entry = CHANNEL_CHANGELOG.find((e) => !state.postedChangelog.includes(e.id) && !seen(state, e.title, e.url));
  if (!entry) return null;
  return { kind: "tool", title: entry.title, blurb: entry.body, url: entry.url, label: entry.title };
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
          return { kind, title: top.title, blurb: `${top.source}. عنوان من تغطية شام AI، بلا نسخ للمقال.`, url, label: "خبر" };
        }
      }
    } else if (kind === "event") {
      for (const e of EVENT_ITEMS) {
        const url = `${SITE_URL}/events/${e.slug}`;
        if (!seen(state, e.title, url)) return { kind, title: e.title, blurb: e.blurb || e.description, url, label: "حدث" };
      }
    } else if (kind === "article") {
      for (const a of ARTICLE_ITEMS) {
        const url = `${SITE_URL}/articles/${a.slug}`;
        if (!seen(state, a.title, url)) return { kind, title: a.title, blurb: a.description, url, label: "مقال" };
      }
    } else {
      const freshTool = changelogItem(state);
      if (freshTool) return freshTool;
      for (const t of TOOLS) {
        if (!seen(state, t.title, t.url)) return { kind, title: t.title, blurb: t.blurb, url: t.url, label: t.title };
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
    label: "ليتيريوم · قراءة وكتابة",
  };
}

function atharItem(): Item {
  return {
    kind: "athar",
    title: "أثر على Getgems",
    blurb: "مجموعة أثر على شبكة TON: رمز لكل يوم في التقويم بين 1950 و2049. الصفحة للعرض فقط، بلا وعد ربح.",
    url: ATHAR_GETGEMS,
    athar: true,
    label: "أثر · رمز لكل يوم",
  };
}

function plainCaption(item: Item): string {
  return `${item.title}\n\n${item.blurb}\n\n🔗 ${item.url}`;
}

function captionOk(item: Item, text: string): boolean {
  return Boolean(text) && text.includes(item.url) && isSafeForChannel(text) && !(item.athar && ATHAR_BANNED.test(text));
}

async function caption(item: Item): Promise<string> {
  const fallback = plainCaption(item);
  const rules = item.athar
    ? "ممنوع أي وعد ربح أو استثمار أو عائد أو ارتفاع سعر. صِف المجموعة فقط."
    : "لا تخترع أرقاماً ولا أسعاراً.";
  try {
    const hook = await callGroq(
      `اكتب منشوراً عربياً لقناة تليجرام، 4 إلى 6 أسطر، إيموجيان كحد أقصى، بلا هاشتاق. ${rules} ضع هذا الرابط حرفياً في السطر الأخير دون تعديل: ${item.url}`,
      `العنوان: ${item.title}\nالوصف: ${item.blurb}`,
      280
    );
    const text = hook.trim();
    if (captionOk(item, text)) return text.slice(0, 900);
  } catch {
    /* fallback */
  }
  return fallback;
}

function xml(s: string): string {
  return s.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

function cardSvg(item: Item): string {
  const title = xml(item.label.slice(0, 42));
  const line = xml(item.blurb.slice(0, 70));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
  <rect width="1080" height="1080" fill="#0f2744"/>
  <rect x="70" y="180" width="940" height="720" rx="36" fill="#16375f"/>
  <text x="540" y="430" text-anchor="middle" fill="#f8fafc" font-size="64" font-family="Tahoma, Arial">${title}</text>
  <text x="540" y="530" text-anchor="middle" fill="#dbeafe" font-size="32" font-family="Tahoma, Arial">${line}</text>
  <text x="540" y="640" text-anchor="middle" fill="#93c5fd" font-size="28" font-family="Tahoma, Arial">Sham AI</text>
</svg>`;
}

async function sendPhoto(captionText: string, svg: string): Promise<boolean> {
  const token = await channelBotToken();
  const channel = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !channel) return false;
  const form = new FormData();
  form.append("chat_id", channel);
  form.append("caption", captionText.slice(0, 1000));
  form.append("photo", new Blob([svg], { type: "image/svg+xml" }), "card.svg");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  return data?.ok === true;
}

export async function publishRotation(slot: number): Promise<RotationResult> {
  const state = await loadState();
  state.recent = fresh(state);
  if (state.lastPostAt && Date.now() - Date.parse(state.lastPostAt) < MIN_GAP_MS) {
    return { ok: false, slot, reason: "too-soon" };
  }

  let item: Item | null = null;
  if (due(state.lastLiteriumAt, LITERIUM_EVERY_MS) && !seen(state, "ليتيريوم", LITERIUM_URL)) item = literiumItem();
  else if (due(state.lastAtharAt, ATHAR_EVERY_MS) && !seen(state, "أثر على Getgems", ATHAR_GETGEMS)) item = atharItem();
  else item = await shamItem(state);

  if (!item) {
    await saveState(state).catch(() => null);
    return { ok: false, slot, reason: "nothing-new" };
  }

  const text = await caption(item);
  if (!captionOk(item, text)) {
    return { ok: false, slot, topic: item.title, kind: item.kind, reason: "blocked" };
  }

  const posted = await sendPhoto(text, cardSvg(item));
  if (!posted) return { ok: false, slot, topic: item.title, kind: item.kind, reason: "media-failed" };

  const now = new Date().toISOString();
  state.recent.push({ title: item.title, link: item.url, at: now });
  state.lastPostAt = now;
  if (item.kind === "literium") state.lastLiteriumAt = now;
  if (item.kind === "athar") state.lastAtharAt = now;
  if (item.kind !== "literium" && item.kind !== "athar") state.cursor += 1;
  const changelog = CHANNEL_CHANGELOG.find((e) => e.title === item!.title && e.url === item!.url);
  if (changelog) state.postedChangelog.push(changelog.id);
  await saveState(state).catch((e) => console.error("[channel-rotation] state save failed", e));
  return { ok: true, slot, topic: item.title, kind: item.kind, text };
}
