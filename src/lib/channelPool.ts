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
export type PoolKind = "tool" | "bot" | "news" | "event" | "article" | "project" | "coin";
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
  // The coin comes first: the ZNB posts are the most frequent in the rotation (see ROTATION). Fixed wording, English then Arabic, never a promise.
  const ZNB_CONTRACT = "EQDai9iDv4fDlQHUDxx59QUZMGvTm9uzUL867c_Lxi4cDuCN";
  const coinPosts: PoolItem[] = [
    {
      kind: "coin", id: "coin:intro", title: "زنوبيا · Zenobia (ZNB)",
      blurb: "Zenobia (ZNB): a community coin inspired by the queen of Palmyra and the Silk Road. Not financial advice; crypto is risky. عملة مجتمعية مستوحاة من زنوبيا ملكة تدمر وطريق الحرير. ليست نصيحة مالية، والعملات الرقمية محفوفة بالمخاطر.",
      url: `${SITE_URL}/zenobia/hall.html`, cta: "🏆 لوحة القافلة", target: { url: ZENOBIA_BUY, label: "🛒 شراء ZNB" },
      tags: ["#زنوبيا", "#ZNB", "#TON"], repeatDays: 2,
    },
    {
      kind: "coin", id: "coin:how-to-buy", title: "كيف تشتري ZNB",
      blurb: `How to buy ZNB: open the coin's page on Blum from the button, connect your wallet, choose the amount and confirm. Check the contract address first: ${ZNB_CONTRACT}. Only use what you can afford to lose. افتح صفحة العملة على Blum من الزر، اربط محفظتك، اختر المبلغ وأكّد. تحقق من عنوان العقد أولًا: ${ZNB_CONTRACT}. لا تستخدم إلا ما تتحمل خسارته.`,
      url: ZENOBIA_CHANNEL, cta: "📢 قناة زنوبيا", target: { url: ZENOBIA_BUY, label: "🛒 افتح ZNB على Blum" },
      tags: ["#ZNB", "#TON", "#Blum"], repeatDays: 3,
    },
    {
      kind: "coin", id: "coin:palmyra", title: "تدمر: مدينة على طريق الحرير",
      blurb: "Palmyra was an oasis city in the Syrian desert and a great stop on the Silk Road, where caravans met between East and West. ZNB carries its name forward. كانت تدمر واحة في قلب الصحراء السورية ومحطة كبرى على طريق الحرير تلتقي فيها القوافل بين الشرق والغرب. وعملة ZNB تحمل اسمها.",
      url: ZENOBIA_CHANNEL, cta: "📢 المزيد في القناة", target: { url: ZENOBIA_BUY, label: "🛒 شراء ZNB" },
      tags: ["#تدمر", "#طريق_الحرير", "#ZNB"], repeatDays: 5,
    },
    {
      kind: "coin", id: "coin:zenobia", title: "زنوبيا: ملكة تدمر",
      blurb: "Zenobia ruled Palmyra from about 267 to 272 CE as regent for her son after the death of her husband Odaenathus. Her realm reached Egypt and parts of Anatolia before the Roman emperor Aurelian defeated her in 272. حكمت زنوبيا تدمر نحو 267 إلى 272م وصيّةً على ابنها بعد وفاة زوجها أذينة، وبلغ نفوذها مصر وأجزاء من الأناضول قبل أن يهزمها الإمبراطور أورليان عام 272م.",
      url: ZENOBIA_CHANNEL, cta: "📢 قصتها في القناة", target: { url: ZENOBIA_BUY, label: "🛒 شراء ZNB" },
      tags: ["#زنوبيا", "#تدمر", "#ZNB"], repeatDays: 6,
    },
    {
      kind: "coin", id: "coin:quote", title: "قالت زنوبيا",
      blurb: "«نِعْمَ مَا قَيْدٌ فِي مِعْصَمِ حُرٍّ أَبِيٍّ، وَبِئْسَ مَا تَاجٌ عَلَى رَأْسِ خَانِعٍ ذَلِيلٍ»  “A fine thing is a fetter on the wrist of a free, noble person, and a wretched thing is a crown on the head of a cringing, abject coward.”",
      url: ZENOBIA_CHANNEL, cta: "📢 قناة زنوبيا", target: { url: ZENOBIA_BUY, label: "🛒 شراء ZNB" },
      tags: ["#زنوبيا", "#ZNB"], repeatDays: 8,
    },
    {
      kind: "coin", id: "coin:board", title: "لوحة القافلة: من احتفظ أطول؟",
      blurb: "The Caravan Board shows who has held ZNB the longest. Connect your wallet to see your place. Rankings only, no reward. لوحة القافلة تعرض من احتفظ بـ ZNB أطول مدة. اربط محفظتك لترى مكانك. ترتيب فقط بلا مكافأة.",
      url: `${SITE_URL}/zenobia/hall.html`, cta: "🏆 افتح اللوحة", target: { url: ZENOBIA_BUY, label: "🛒 شراء ZNB" },
      tags: ["#ZNB", "#TON"], repeatDays: 7,
    },
  ];
  const projects: PoolItem[] = [
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
  return { tool: tools, bot: bots, news, event: events, article: articles, project: projects, coin: coinPosts };
}

// Category order for the rotation (cursor % length): varied, tools and bots
// appear often because they are what newcomers can use immediately.
export const ROTATION: PoolKind[] = ["coin", "tool", "coin", "news", "project", "coin", "bot", "coin", "event", "coin", "tool", "article"];

export const HEADERS: Record<PoolKind, string> = {
  tool: "🛠 أداة مجانية",
  bot: "🤖 بوت تليجرام",
  news: "📰 خبر",
  event: "📅 مناسبة",
  article: "📖 مقال",
  project: "✨ من مشاريعنا",
  coin: "🏛 عملة زنوبيا",
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
