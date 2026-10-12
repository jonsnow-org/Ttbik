import { FREE_TOOLS } from "@/lib/freeTools";
import { BOT_LANDINGS } from "@/lib/botLanding";
import { NEWS_ITEMS } from "@/lib/newsItems";
import { EVENT_ITEMS } from "@/lib/eventsIndex";
import { EVENT_EXTRAS } from "@/lib/eventsExtra";
import { ARTICLE_ITEMS } from "@/lib/articlesIndex";
import { SITE_URL } from "@/lib/siteUrl";

// Everything the channel can promote, built from the site's own data so a new
// tool, bot page, news item, event or article joins the rotation by itself.
// Only public pages: nothing owner-only has a path in here.
export type PoolKind = "tool" | "bot" | "news" | "event" | "article" | "project";
export type PoolItem = {
  kind: PoolKind;
  id: string;
  title: string;
  blurb: string;
  url: string; // page on our site (also used for the link preview)
  cta: string; // button label
  target?: { url: string; label: string }; // optional second button (e.g. the bot itself)
  tags: string[];
  // Evergreen content (tools, bots) may repeat after this many days; dated
  // content (news/events/articles) is posted once.
  repeatDays: number;
};

// The owner's own projects (Zenobia, Athar): fixed wording, written once here, never left to a model. No promise of any return, ever.
const ZENOBIA_BUY = "https://t.me/blum/app?startapp=memepadjetton_ZNB_gMTPq-ref_GcJK8kBUGD";
const ZENOBIA_BOT = "https://t.me/Zenobia_Palmyrabot";
const ZENOBIA_CHANNEL = "https://t.me/Zenobiaton";
const ATHAR_BOT = (process.env.NEXT_PUBLIC_ATHAR_BOT_URL || "https://t.me/AtharDaysBot").trim();

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const short = (s: string, n: number) => (clean(s).length > n ? clean(s).slice(0, n - 1).trimEnd() + "…" : clean(s));
// Strip decorative leading emoji so the template can add its own header.
const noEmoji = (s: string) => clean(s.replace(/^[\p{Extended_Pictographic}️\s]+/u, ""));

export function buildPool(): Record<PoolKind, PoolItem[]> {
  const tools: PoolItem[] = FREE_TOOLS.filter((t) => !t.href.startsWith("/bashar")).map((t) => ({
    kind: "tool",
    id: `tool:${t.href}`,
    title: noEmoji(t.title),
    blurb: short(t.desc, 190),
    url: `${SITE_URL}${t.href}`,
    cta: "🚀 جرّب الأداة الآن",
    tags: ["#أدوات_مجانية", "#شام_AI"],
    repeatDays: 14,
  }));
  const bots: PoolItem[] = BOT_LANDINGS.map((b) => ({
    kind: "bot",
    id: `bot:${b.slug}`,
    title: b.name,
    blurb: short(b.summary, 190),
    url: `${SITE_URL}/bot/${b.slug}`,
    cta: "ℹ️ تفاصيل البوت",
    target: { url: b.href, label: "🤖 افتح البوت" },
    tags: ["#بوتات_تليجرام", "#شام_AI"],
    repeatDays: 14,
  }));
  const news: PoolItem[] = NEWS_ITEMS.map((n) => ({
    kind: "news",
    id: `news:${n.slug}`,
    title: noEmoji(n.title),
    blurb: short(n.description, 220),
    url: `${SITE_URL}/news/${n.slug}`,
    cta: "📰 اقرأ التفاصيل",
    tags: ["#أخبار", "#شام_AI"],
    repeatDays: 3650,
  }));
  const events: PoolItem[] = [...EVENT_ITEMS, ...EVENT_EXTRAS].map((e) => ({
    kind: "event",
    id: `event:${e.slug}`,
    title: noEmoji(e.title),
    blurb: short(e.blurb || e.description, 220),
    url: `${SITE_URL}/events/${e.slug}`,
    cta: "📅 تفاصيل المناسبة",
    tags: ["#مناسبات", "#شام_AI"],
    repeatDays: 3650,
  }));
  const articles: PoolItem[] = ARTICLE_ITEMS.map((a) => ({
    kind: "article",
    id: `article:${a.slug}`,
    title: noEmoji(a.title),
    blurb: short(a.description, 220),
    url: `${SITE_URL}/articles/${a.slug}`,
    cta: "📖 اقرأ المقال",
    tags: ["#مقالات", "#شام_AI"],
    repeatDays: 3650,
  }));
  const projects: PoolItem[] = [
    {
      kind: "project", id: "project:zenobia-coin", title: "زنوبيا · Zenobia (ZNB)",
      blurb: "Zenobia (ZNB): a community coin inspired by the queen of Palmyra and the Silk Road. Not financial advice; crypto is risky. عملة مجتمعية مستوحاة من زنوبيا ملكة تدمر وطريق الحرير. ليست نصيحة مالية، والعملات الرقمية محفوفة بالمخاطر.",
      url: `${SITE_URL}/zenobia/hall.html`, cta: "🏆 لوحة القافلة", target: { url: ZENOBIA_BUY, label: "🛒 شراء ZNB" },
      tags: ["#زنوبيا", "#ZNB", "#TON"], repeatDays: 3,
    },
    {
      kind: "project", id: "project:zenobia-passport", title: "جواز مرور طريق الحرير من تدمر",
      blurb: "Silk Road Passport: 2,500 only, grows with its age, locked 30 days then free to trade, for ZNB holders. جواز محدود بـ2,500، يكبر بعمره (طفلة ثم ملكة ثم محاربة)، يُقفل 30 يومًا ثم يُباع ويُشترى بحرية، لحاملي ZNB. للاقتناء فقط وبلا أي وعد.",
      url: `${SITE_URL}/zenobia/silk.html`, cta: "🪪 احصل على جوازك", target: { url: ZENOBIA_BOT, label: "🤖 بوت زنوبيا" },
      tags: ["#زنوبيا", "#NFT", "#TON"], repeatDays: 4,
    },
    {
      kind: "project", id: "project:zenobia-channel", title: "قناة زنوبيا",
      blurb: "تاريخ ملكة تدمر وأخبار العملة والجواز بالإنجليزية والعربية. Zenobia's story, the coin and the passport, in English and Arabic.",
      url: ZENOBIA_CHANNEL, cta: "📢 انضم إلى القناة", target: { url: ZENOBIA_BOT, label: "🤖 بوت زنوبيا" },
      tags: ["#زنوبيا", "#تدمر"], repeatDays: 6,
    },
    {
      kind: "project", id: "project:athar-days", title: "أثر · رمز حيّ لكل يوم",
      blurb: "لكل يوم في التقويم رمز واحد: يوم ميلادك أو زواجك أو يوم تحبه. صورته حيّة تومض وتدور وتنضج كلما طال بقاؤه عندك، ويمكنك وضع صورتك عليه وإهداؤه. للذكرى والاقتناء فقط.",
      url: ATHAR_BOT, cta: "🕰 افتح أثر", tags: ["#أثر", "#TON"], repeatDays: 4,
    },
    {
      kind: "project", id: "project:athar-today", title: "رمز اليوم في أثر",
      blurb: "كل يوم تاريخ جديد قد يصير رمزك. افتح أثر وشاهد رمز اليوم واحجزه إن كان متاحًا. للذكرى والاقتناء فقط.",
      url: ATHAR_BOT, cta: "📅 رمز اليوم", tags: ["#أثر", "#TON"], repeatDays: 7,
    },
  ];
  return { tool: tools, bot: bots, news, event: events, article: articles, project: projects };
}

// Category order for the rotation (cursor % length): varied, tools and bots
// appear often because they are what newcomers can use immediately.
export const ROTATION: PoolKind[] = ["tool", "project", "news", "bot", "event", "project", "tool", "article", "bot", "project", "news"];

export const HEADERS: Record<PoolKind, string> = {
  tool: "🛠 أداة مجانية",
  bot: "🤖 بوت تليجرام",
  news: "📰 خبر",
  event: "📅 مناسبة",
  article: "📖 مقال",
  project: "✨ من مشاريعنا",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Several fixed layouts, rotated, so the channel does not look copy-pasted.
export function formatPost(item: PoolItem, variant: number): string {
  const head = HEADERS[item.kind];
  const t = esc(item.title);
  const b = esc(item.blurb);
  const tags = item.tags.join(" ");
  switch (variant % 3) {
    case 0:
      return `<b>${head}</b>\n\n<b>${t}</b>\n${b}\n\n${tags}`;
    case 1:
      return `${head} ✦\n\n<b>${t}</b>\n\n${b}\n\n⬇️ الرابط في الزر بالأسفل\n${tags}`;
    default:
      return `<b>${t}</b>\n\n${b}\n\n— ${head} من شام AI\n${tags}`;
  }
}
