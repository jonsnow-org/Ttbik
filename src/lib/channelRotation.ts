import { channelBotToken } from "@/lib/channelPublisher";
import { fetchTopStories } from "@/lib/newsRss";
import { ARTICLE_ITEMS } from "@/lib/articlesIndex";
import { EVENT_ITEMS } from "@/lib/eventsIndex";
import { CHANNEL_CHANGELOG } from "@/lib/channelChangelog";
import { isSafeForChannel } from "@/lib/channelPublisher";
import { supabaseAdmin } from "@/lib/supabase";
import { buildPool, formatPost, ROTATION, type PoolFlags, type PoolItem } from "@/lib/channelPool";
import { getConfig } from "@/lib/znbtConfig";

/**
 * Channel rotation. Owner list, 2026-10-09:
 *   1. Sham AI news, events, articles, tools
 *   2. Literium https://literium.ai.studio/ (owner 2026-10-19: not often, once a week, with image + video)
 *   3. Athar on Getgems once every 3 days
 * No title or link repeated inside 48 hours.
 * Athar text must not promise profit.
 * Images are one uploaded card each. No Pollinations, no random fetch.
 * Cards are real renders (public/promo/*.png, Arabic shaped by a browser). The earlier AI-drawn cards showed mirrored Arabic.
 * Literium and Athar captions are fixed texts: a model-written caption once leaked "**" markdown into the channel.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
const STATE_KEY = "channel_rotation_state";
const LITERIUM_URL = "https://literium.ai.studio/";
const ATHAR_GETGEMS = "https://getgems.io/collection/EQAuIOwjzSmGQfL925LjD5eG0Qk1zJNRk4Ap8jzSOwnCRIYf";
const TWO_DAYS_MS = 48 * 3600 * 1000;
const LITERIUM_EVERY_MS = 7 * 24 * 3600 * 1000;   // not often: once a week
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
  seenAt: Record<string, string>; // pool id -> ISO of last post
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
  return { recent: [], lastLiteriumAt: "", lastAtharAt: "", lastPostAt: "", cursor: 0, postedChangelog: [], seenAt: {} };
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
      seenAt: v.seenAt && typeof v.seenAt === "object" ? (v.seenAt as Record<string, string>) : {},
    };
  } catch {
    return emptyState();
  }
}

async function saveState(state: State): Promise<void> {
  const trimmed = { ...state, recent: state.recent.slice(-200), postedChangelog: state.postedChangelog.slice(-100), seenAt: Object.fromEntries(Object.entries(state.seenAt).slice(-800)) };
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
    blurb: "منصة عربية للأدب والمقالات: اقرأ نصوصاً وأفكاراً، وانشر مقالاتك وتغريداتك القصيرة، وللمعلنين مساحتهم.",
    url: LITERIUM_URL,
    label: "ليتيريوم · قراءة وكتابة",
  };
}

function atharItem(): Item {
  return {
    kind: "athar",
    title: "أثر على Getgems",
    blurb: "مجموعة أثر على شبكة TON: رمز لكل يوم في التقويم بين 1950 و2049. الصفحة للعرض والتعريف بالمجموعة فقط.",
    url: ATHAR_GETGEMS,
    athar: true,
    label: "أثر · رمز لكل يوم",
  };
}

function plainCaption(item: Item): string {
  return `${item.title}\n\n${item.blurb}\n\n🔗 ${item.url}`;
}

function captionOk(item: Item, text: string): boolean {
  return Boolean(text) && text.includes(item.url) && isSafeForChannel(text) && !(item.athar && ATHAR_BANNED.test(text)) && !/pollinations/i.test(text);
}

async function caption(item: Item): Promise<string> {
  if (item.kind === "literium") {
    return `📚 ليتيريوم: منصة عربية للأدب والمقالات\n\nمكان واحد تقرأ فيه نصوصاً وأفكاراً، وتنشر فيه مقالاتك وتغريداتك القصيرة.\n\n✍️ اقرأ · اكتب · شارك\n\n🔗 ${item.url}`;
  }
  if (item.kind === "athar") {
    return `🗓 أثر: رمز على شبكة TON لكل يوم في التقويم، من 1950 إلى 2049\n\nصفحة المجموعة للعرض والتعريف فقط.\n\n🔗 ${item.url}`;
  }
  return plainCaption(item);
}

/** Public, pre-rendered media for an item (served from /public/promo). */
function mediaFor(item: Item): { photo: string; video?: string } | null {
  if (item.kind === "literium") return { photo: `${SITE_URL}/promo/literium-card.png`, video: `${SITE_URL}/promo/literium.mp4` };
  if (item.kind === "athar") return { photo: `${SITE_URL}/promo/athar-card.png` };
  return null;
}

const channelId = () => process.env.TELEGRAM_CHANNEL_ID || "@ttbik5";

async function sendMedia(captionText: string, media: { photo: string; video?: string }): Promise<boolean> {
  const token = await channelBotToken();
  const channel = channelId();
  if (!token || !channel) return false;
  const call = async (method: string, body: Record<string, unknown>) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: channel, ...body }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    return data?.ok === true;
  };
  const cap = captionText.slice(0, 1000);
  if (media.video) {
    // image + video in one album; the caption sits on the first item
    const ok = await call("sendMediaGroup", {
      media: [
        { type: "photo", media: media.photo, caption: cap },
        { type: "video", media: media.video, supports_streaming: true, width: 720, height: 720 },
      ],
    });
    if (ok) return true;
  }
  return call("sendPhoto", { photo: media.photo, caption: cap });
}

async function sendText(captionText: string): Promise<boolean> {
  const token = await channelBotToken();
  const channel = channelId();
  if (!token || !channel) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: channel, text: captionText.slice(0, 4000), link_preview_options: { is_disabled: true } }),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  return data?.ok === true;
}

// What the owner has switched on right now (ZNBt launched, platform open); read once per run, so posts about them start by themselves and never before.
let promoFlags: PoolFlags = { znbt: false, platform: false };

function pickPool(state: State): PoolItem | null {
  const pool = buildPool(promoFlags);
  const now = Date.now();
  for (let i = 0; i < ROTATION.length; i++) {
    const kind = ROTATION[(state.cursor + i) % ROTATION.length];
    const ranked = [...pool[kind]].sort((a, b) => (Date.parse(state.seenAt[a.id] || "") || 0) - (Date.parse(state.seenAt[b.id] || "") || 0));
    for (const it of ranked) {
      const last = Date.parse(state.seenAt[it.id] || "") || 0;
      if (last && now - last < it.repeatDays * 86400000) continue;
      if (seen(state, it.title, it.url)) continue;
      if (!isSafeForChannel(`${it.title}\n${it.blurb}`)) continue;
      return it;
    }
  }
  return null;
}

async function sendPost(item: PoolItem, text: string): Promise<{ ok: boolean; error?: string }> {
  const token = await channelBotToken();
  if (!token) return { ok: false, error: "no-bot-token" };
  const rows: { text: string; url: string }[][] = [[{ text: item.cta, url: item.url }]];
  if (item.target) rows.unshift([{ text: item.target.label, url: item.target.url }]);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: channelId(),
      text: text.slice(0, 4000),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows },
      link_preview_options: { url: item.url, prefer_large_media: true, show_above_text: true },
    }),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  return data?.ok === true ? { ok: true } : { ok: false, error: String(data?.description || "telegram-request-failed").slice(0, 160) };
}

export async function publishRotation(slot: number, opts: { dry?: boolean } = {}): Promise<RotationResult> {
  const cfg = await getConfig().catch(() => null);
  promoFlags = { znbt: !!cfg?.curve, platform: !!cfg?.curve && !!cfg?.open };
  const state = await loadState();
  state.recent = fresh(state);
  if (state.lastPostAt && Date.now() - Date.parse(state.lastPostAt) < MIN_GAP_MS) {
    return { ok: false, slot, reason: "too-soon" };
  }

  let item: Item | null = null;
  if (due(state.lastLiteriumAt, LITERIUM_EVERY_MS) && !seen(state, "ليتيريوم", LITERIUM_URL)) item = literiumItem();
  else if (due(state.lastAtharAt, ATHAR_EVERY_MS) && !seen(state, "أثر على Getgems", ATHAR_GETGEMS)) item = atharItem();
  else {
    // Whole-site rotation: tools, bots, news, events, articles (see channelPool.ts).
    const log = changelogItem(state);
    const pick: PoolItem | null = log
      ? { kind: "tool", id: `log:${log.title}`, title: log.title, blurb: log.blurb, url: log.url, cta: "🚀 جرّبه الآن", tags: ["#جديد", "#شام_AI"], repeatDays: 3650 }
      : pickPool(state);
    if (pick) {
      const text = formatPost(pick, state.cursor);
      if (!isSafeForChannel(text)) {
        // One blocked item must never freeze the channel (the "#شام_AI" tag did exactly that for two weeks): skip it from now on.
        if (!opts.dry) {
          state.seenAt[pick.id] = new Date().toISOString();
          const blockedLog = CHANNEL_CHANGELOG.find((e) => e.title === pick.title && e.url === pick.url);
          if (blockedLog) state.postedChangelog.push(blockedLog.id);
          await saveState(state).catch(() => null);
        }
        return { ok: false, slot, topic: pick.title, kind: pick.kind, reason: "blocked" };
      }
      if (opts.dry) return { ok: true, slot, topic: pick.title, kind: pick.kind, text, reason: "dry-run" };
      const sent = await sendPost(pick, text);
      if (!sent.ok) return { ok: false, slot, topic: pick.title, kind: pick.kind, reason: `telegram: ${sent.error}` };
      const now = new Date().toISOString();
      state.recent.push({ title: pick.title, link: pick.url, at: now });
      state.seenAt[pick.id] = now;
      state.lastPostAt = now;
      state.cursor += 1;
      const clog = CHANNEL_CHANGELOG.find((e) => e.title === pick.title && e.url === pick.url);
      if (clog) state.postedChangelog.push(clog.id);
      await saveState(state).catch((e) => console.error("[channel-rotation] state save failed", e));
      return { ok: true, slot, topic: pick.title, kind: pick.kind, text };
    }
    item = await shamItem(state); // last resort: live RSS headline
  }

  if (!item) {
    await saveState(state).catch(() => null);
    return { ok: false, slot, reason: "nothing-new" };
  }

  let text = await caption(item);
  if (!captionOk(item, text)) {
    // A blocked Literium/Athar caption must not hold the whole channel: before
    // 2026-10-14 the Athar fallback itself matched ATHAR_BANNED, Athar stayed
    // "due" forever and every run returned "blocked" without posting anything.
    // Postpone that item one cycle and post the next pool item instead.
    if (item.kind === "athar") state.lastAtharAt = new Date().toISOString();
    if (item.kind === "literium") state.lastLiteriumAt = new Date().toISOString();
    const pick = pickPool(state);
    const alt = pick ? formatPost(pick, state.cursor) : "";
    if (!pick || !isSafeForChannel(alt)) {
      if (!opts.dry) await saveState(state).catch(() => null);
      return { ok: false, slot, topic: item.title, kind: item.kind, reason: "blocked" };
    }
    if (opts.dry) return { ok: true, slot, topic: pick.title, kind: pick.kind, text: alt, reason: "dry-run" };
    const sent = await sendPost(pick, alt);
    if (!sent.ok) return { ok: false, slot, topic: pick.title, kind: pick.kind, reason: `telegram: ${sent.error}` };
    const at = new Date().toISOString();
    state.recent.push({ title: pick.title, link: pick.url, at });
    state.seenAt[pick.id] = at;
    state.lastPostAt = at;
    state.cursor += 1;
    await saveState(state).catch((e) => console.error("[channel-rotation] state save failed", e));
    return { ok: true, slot, topic: pick.title, kind: pick.kind, text: alt };
  }

  if (opts.dry) return { ok: true, slot, topic: item.title, kind: item.kind, text, reason: "dry-run" };

  const media = mediaFor(item);
  const posted = media ? await sendMedia(text, media) : await sendText(text);
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
