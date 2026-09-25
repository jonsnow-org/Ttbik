import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { callGroq } from "@/lib/groq";
import { fetchTopStories } from "@/lib/newsRss";
import { CHANNEL_CHANGELOG } from "@/lib/channelChangelog";
import sitemap from "@/app/sitemap";

/**
 * Telegram channel publisher (owner request, 2026-09-25): three runs a day
 * (vercel.json → /api/cron/telegram-post?slot=1|2|3), each one posting
 * whatever is NEW first, then its slot's regular content.
 *
 * What counts as new — only sources that are public by construction, so
 * owner-only or secret material has no path into the channel:
 *   1. CHANNEL_CHANGELOG (src/lib/channelChangelog.ts) — hand-curated,
 *      user-facing feature notes;
 *   2. BotUpdateAnnouncement rows — the "#تحديث" texts already written for
 *      bot users (the same text their users receive in the bot);
 *   3. pages that newly appear in the public sitemap (a new tool, a new
 *      service page…) → one short "tweet" per page, from its own public
 *      <title>/<meta description>.
 * Slot 1 also posts a daily digest of the top news stories, linking to /news.
 *
 * Every outgoing text also passes isSafeForChannel() as a last line of
 * defence. Progress (what was already posted, which pages are known) is
 * kept in bot_settings under STATE_KEY.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
const STATE_KEY = "channel_publisher_state";
const MAX_UPDATES_PER_RUN = 2;
const ANNOUNCEMENT_MAX_AGE_DAYS = 14;

type State = {
  posted: string[]; // changelog ids + "ann:<id>" + "page:<path>"
  pages: string[] | null; // known sitemap paths; null until the first baseline
  newsDay: string; // YYYY-MM-DD of the last news digest
};

export type Post = { kind: string; key: string; text: string };

// ---------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------
const BLOCKED_PATTERNS: RegExp[] = [
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/, // bot token
  /\b(sk|pk|rk|gsk|ghp|hf)_[A-Za-z0-9]{10,}/i, // API keys
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT / Supabase keys
  /\b[A-Z][A-Z0-9_]*_(TOKEN|SECRET|KEY|PASSWORD|ID)\b/, // env var names
  /(password|passwd|secret|api[_ ]?key|service[_ ]?role|supabase|prisma|render\.com|webhook|cron)/i,
  /(كلمة ?السر|كلمة ?المرور|كود ?التفعيل|أكواد ?التفعيل|لوحة ?(التحكم|المالك|الأدمن)|سوبر ?أدمن|(حظر|كتم|إدارة) المستخدمين|للمالك فقط|خاص بالمالك)/,
  /\b(nova|sham)\b|نوفا|(^|[^\u0600-\u06FF])شام([^\u0600-\u06FF]|$)/i, // never promoted publicly (owner directive 2026-09-21)
  /\/(admin|api|owner|pay)\b/i, // internal site paths
  /8452320/,
];

export function isSafeForChannel(text: string): boolean {
  return !BLOCKED_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
async function loadState(): Promise<State> {
  try {
    const { data } = await supabaseAdmin().from("bot_settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const v = (data as any)?.value || {};
    return {
      posted: Array.isArray(v.posted) ? v.posted : [],
      pages: Array.isArray(v.pages) ? v.pages : null,
      newsDay: typeof v.newsDay === "string" ? v.newsDay : "",
    };
  } catch {
    return { posted: [], pages: null, newsDay: "" };
  }
}

async function saveState(state: State): Promise<void> {
  // Keep the record bounded; old keys can't come back anyway.
  const trimmed = { ...state, posted: state.posted.slice(-500) };
  await supabaseAdmin()
    .from("bot_settings")
    .upsert({ key: STATE_KEY, value: trimmed, updated_at: new Date().toISOString() });
}

// ---------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------
function changelogPosts(state: State): Post[] {
  return CHANNEL_CHANGELOG.filter((e) => !state.posted.includes(e.id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ kind: "changelog", key: e.id, text: `🆕 ${e.title}\n\n${e.body}\n\n👈 جرّبه الآن: ${e.url}` }));
}

async function announcementPosts(state: State): Promise<Post[]> {
  try {
    const since = new Date(Date.now() - ANNOUNCEMENT_MAX_AGE_DAYS * 24 * 3600 * 1000);
    const rows = await prisma.botUpdateAnnouncement.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "asc" } });
    return rows
      .filter((r) => !state.posted.includes(`ann:${r.id}`) && r.template !== "NOVA_BOT")
      .map((r) => ({ kind: "announcement", key: `ann:${r.id}`, text: r.text }));
  } catch {
    return [];
  }
}

// Families of generated pages that aren't "new features" (one per city,
// per article, English mirrors) — announcing each would flood the channel.
function isAnnounceablePath(path: string): boolean {
  return !/^\/(prayer-times\/|news\/|en\/|c\/|s\/|m\/|embed|admin|api|pay|order|terms|privacy)/.test(path);
}

async function currentPublicPaths(): Promise<string[]> {
  const entries = await sitemap();
  return entries
    .map((e) => {
      try {
        return new URL(e.url).pathname.replace(/\/$/, "") || "/";
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

async function pageMeta(path: string): Promise<{ title: string; description: string } | null> {
  try {
    const res = await fetch(`${SITE_URL}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const html = await res.text();
    const pick = (re: RegExp) => (html.match(re)?.[1] || "").replace(/\s+/g, " ").trim();
    const title = pick(/<title[^>]*>([^<]+)<\/title>/i);
    const description =
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    return title ? { title, description } : null;
  } catch {
    return null;
  }
}

async function pageTweet(path: string): Promise<Post | null> {
  const meta = await pageMeta(path);
  if (!meta) return null;
  const url = `${SITE_URL}${path}`;
  let text = `🆕 جديد على الموقع: ${meta.title}\n${meta.description}\n\n🔗 ${url}`;
  try {
    const hook = await callGroq(
      "اكتب تغريدة قصيرة جذابة بالعربية (سطران كحد أقصى، إيموجي أو اثنان، بدون هاشتاقات وبدون روابط) تعلن عن صفحة جديدة في موقعنا اعتماداً فقط على العنوان والوصف المعطيين. لا تضف أي معلومة غير موجودة فيهما.",
      `العنوان: ${meta.title}\nالوصف: ${meta.description}`,
      120
    );
    if (hook.trim()) text = `🆕 ${hook.trim()}\n\n🔗 ${url}`;
  } catch {
    /* keep the plain version */
  }
  return { kind: "page", key: `page:${path}`, text };
}

async function newsDigest(): Promise<string | null> {
  try {
    const stories = await fetchTopStories(5);
    if (stories.length === 0) return null;
    const lines = stories.map((s, i) => `${i + 1}. ${s.items[0].title} — ${s.items[0].source}`);
    return `📰 أبرز أخبار اليوم\n\n${lines.join("\n\n")}\n\n🔎 تفاصيل وتغطية من عدة مصادر: ${SITE_URL}/news`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------
export async function sendToChannel(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channel = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !channel) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: channel, text: text.slice(0, 4000) }),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  return data?.ok === true;
}

/**
 * Posts up to MAX_UPDATES_PER_RUN new items (and, on slot 1, the daily news).
 * Returns what was posted so the caller can decide whether to add a promo.
 */
export async function publishNew(slot: number): Promise<{ posted: string[]; skipped: string[] }> {
  const state = await loadState();
  const posted: string[] = [];
  const skipped: string[] = [];

  // New pages since the last run (the very first run only records a baseline).
  const paths = await currentPublicPaths().catch(() => [] as string[]);
  let newPaths: string[] = [];
  if (paths.length) {
    if (state.pages === null) {
      state.pages = paths;
    } else {
      newPaths = paths.filter((p) => !state.pages!.includes(p) && isAnnounceablePath(p) && !state.posted.includes(`page:${p}`));
    }
  }

  const queue: (Post | (() => Promise<Post | null>))[] = [
    ...changelogPosts(state),
    ...(await announcementPosts(state)),
    ...newPaths.map((p) => () => pageTweet(p)),
  ];

  for (const item of queue) {
    if (posted.length >= MAX_UPDATES_PER_RUN) break;
    const post = typeof item === "function" ? await item() : item;
    if (!post) continue;
    if (!isSafeForChannel(post.text)) {
      state.posted.push(post.key); // never retry a blocked item
      skipped.push(post.key);
      continue;
    }
    if (await sendToChannel(post.text)) {
      state.posted.push(post.key);
      posted.push(post.key);
    }
  }

  // Record pages as known once announced (or skipped as non-announceable);
  // ones still waiting stay unknown so the next run picks them up.
  if (state.pages !== null && paths.length) {
    const waiting = new Set(newPaths.filter((p) => !state.posted.includes(`page:${p}`)));
    state.pages = paths.filter((p) => !waiting.has(p));
  }

  if (slot === 1) {
    const today = new Date().toISOString().slice(0, 10);
    if (state.newsDay !== today) {
      const digest = await newsDigest();
      if (digest && isSafeForChannel(digest) && (await sendToChannel(digest))) {
        state.newsDay = today;
        posted.push("news");
      }
    }
  }

  await saveState(state).catch((e) => console.error("[channel] state save failed", e));
  return { posted, skipped };
}
