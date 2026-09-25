import { NextRequest, NextResponse } from "next/server";
import { callGroq } from "@/lib/groq";
import { supabasePublic } from "@/lib/supabase";
import { LIVE_BOTS } from "@/lib/liveBots";
import { publishNew, isSafeForChannel, sendToChannel } from "@/lib/channelPublisher";
import { ensureFrontDoor } from "@/lib/mediaFrontDoor";

export const maxDuration = 60;

// Triggered three times a day by Vercel Cron (see vercel.json). Publishes one varied
// promotional post to the public Telegram channel, rotating across three
// pools: free tools, live paid catalog services, and
// (only if configured) an AD_BOT manual-purchase awareness post.
//
// Paid services and store products are fetched fresh from Supabase on
// every run instead of hardcoded — the old hardcoded list here had already
// drifted to include a retired service (whatsapp-catalog) and a dead one
// (review-analyzer) before the 2026-09-02 site audit caught it. Fetching
// live is what "دون اخطاء" (owner directive, 2026-09-03) actually
// requires: a service (or product) that gets deactivated tomorrow simply
// stops being eligible tomorrow, with no separate list to remember to
// update.
//
// NEVER add Nova AI or "Sham" (our own in-house model) topics to this
// route, ever — explicit owner directive, 2026-09-21. Nova AI lives on a
// separate (Chinese-hosted) product and Sham is our own internal model,
// neither is meant to be promoted in this public sales channel. Since
// neither has ever had a public-facing catalog/store entry, this is
// naturally already true; this comment exists so it stays true the next
// time someone (Claude, Grok, or a future editor) is tempted to add a
// "highlight the AI model" post here.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

const GENERIC_SYSTEM_PROMPT = `أنت مسؤول تسويق لموقع "سوق تولز" (متجر أدوات وخدمات رقمية مصغّرة). اكتب منشوراً ترويجياً قصيراً وجذاباً بالعربية لقناة تليجرام (4-6 أسطر كحد أقصى، مع 2-3 إيموجي مناسبة، بدون هاشتاقات). كل مرة استخدم أسلوباً وزاوية مختلفة (نصيحة عملية، سؤال يثير الفضول، قصة نجاح مختصرة، عرض ميزة). اذكر رابط واحد فقط في نهاية المنشور، بالضبط كما أعطيتك إياه دون أي تعديل عليه. لا تكرر نفس الصياغة في كل مرة.`;

// Static — mirrors src/app/free-tools/page.tsx's TOOLS. Keep in sync if a
// free tool is added or removed there.
//
// The old faq-bot/auto-reply-bot entries were removed 2026-09-04: neither
// is a real deployable bot template (no dispatcher entry, no create/
// activate flow like AD_BOT/MARRIAGE_BOT/JOBS_BOT have) — promoting them
// as "get your own bot" was exactly the code-handoff framing the owner
// ruled out site-wide. Replaced with the 3 real live bots below.
const FREE_TOPICS = [
  { name: "بطاقة أعمال رقمية (Linktree) مجانية مع عداد مشاهدات حقيقي", url: `${SITE_URL}/free-tools/digital-card` },
  { name: "مصغّر روابط مع عداد نقرات حقيقي (مجاني)", url: `${SITE_URL}/free-tools/url-shortener` },
  { name: "ضغط وتحويل الصور مجاناً داخل المتصفح، بلا رفع لأي خادم", url: `${SITE_URL}/free-tools/image-optimizer` },
  { name: "مولد رابط الطلب عبر واتساب (مجاني بالكامل)", url: `${SITE_URL}/free-tools/whatsapp-link` },
  { name: "مولد أسماء المشاريع بالذكاء الاصطناعي (مجاني)", url: `${SITE_URL}/free-tools/business-name-generator` },
  { name: "مساعد الكتابة الذكي: منشورات ومقالات وأوصاف منتجات وترجمة (مجاني)", url: `${SITE_URL}/free-tools/writing-assistant` },
  { name: "محلل النصوص الذكي: تلخيص تقارير وتحليل آراء عملاء (مجاني)", url: `${SITE_URL}/free-tools/text-analyzer` },
];

// Real, live Telegram bots the owner runs — promoted directly by their
// t.me link (not a catalog service page) since the goal here is simply
// getting a visitor to open and join the bot. Shared with the free-tools
// page and the homepage via src/lib/liveBots.ts.
const LIVE_BOT_TOPICS = LIVE_BOTS.map((b) => ({ name: b.title, url: b.href }));

async function getPaidTopics(): Promise<{ name: string; url: string }[]> {
  try {
    const db = supabasePublic();
    const { data } = await db.from("services").select("slug, name_ar").eq("is_active", true).gt("price_usd", 0);
    return (data ?? []).map((s: any) => ({ name: s.name_ar as string, url: `${SITE_URL}/service/${s.slug}` }));
  } catch {
    return [];
  }
}

type BotPromo = { label: string; intro: string; price: string; botLink: string; cta: string };

// AD_BOT is never sold or self-served on the website — manual price/
// payment/approval only (docs/AGENT_BUS.md Product rules, owner directive
// 2026-09-03). Offered here purely as awareness, and only once the owner
// has set PROMO_AD_BOT_USERNAME; silently skipped otherwise so this route
// never errors or posts a link that doesn't exist.
//
// NOT the channel's own posting bot (TELEGRAM_BOT_TOKEN, which just sends
// this cron's messages and runs no AD_BOT template logic at all) — this
// must be the @username of an actual AD_BOT-template bot the owner already
// has running (e.g. their own admin/management instance, which shows them
// the Super Admin panel because SUPER_ADMIN_TELEGRAM_ID matches — that's
// unrelated to which bot this is, every AD_BOT does that for the owner).
// Every AD_BOT already has a self-serve purchase flow built in
// (src/lib/adBotLogic.ts's "أريد بوتاً مماثلاً" button → $100 bank-transfer
// flow → owner's manual approval), so the promo post just points there and
// tells people to tap that button — no separate contact link needed.
//
// MARRIAGE_BOT has no promo path here at all, deliberately: the owner
// confirmed (2026-09-03) it will never be sold or activated for anyone
// else — it's their own private bot only, and its creator password exists
// solely so THEY can redeploy it themselves if its current token/instance
// breaks, not as a path for a third party to get one.
function getBotPromos(): BotPromo[] {
  const promos: BotPromo[] = [];
  if (process.env.PROMO_AD_BOT_USERNAME) {
    promos.push({
      label: "بوت الإعلانات والمهام",
      intro: "📢 عندك قناة أو مجموعة على تليجرام؟ فعّل بوت إعلانات ومهام خاصاً بك يوزّع أرباح المشاهدة تلقائياً بين المستخدمين والمنصة.",
      price: "100$ (تحويل بنكي)",
      botLink: `https://t.me/${process.env.PROMO_AD_BOT_USERNAME}`,
      cta: "التفعيل يتم يدوياً فقط: افتح البوت واضغط زر «أريد بوتاً مماثلاً» من القائمة، ثم اتبع الخطوات — لا تفعيل تلقائي ولا كود مجاني.",
    });
  }
  return promos;
}

async function writeGenericPost(topic: { name: string; url: string }): Promise<string> {
  try {
    return await callGroq(GENERIC_SYSTEM_PROMPT, `اكتب منشوراً عن: ${topic.name}. الرابط: ${topic.url}`, 300);
  } catch {
    return `🎁 جرّب ${topic.name} الآن:\n${topic.url}`;
  }
}

// Price and the CTA (bot button vs. personal contact — see getBotPromos)
// are fixed here, never left to the AI — a wrong price or a broken/missing
// link in a public channel post is the one mistake this route must never
// make. Groq only writes the opening hook line; if it fails, the default
// intro line is used instead.
async function buildBotPromoText(promo: BotPromo): Promise<string> {
  let hook = promo.intro;
  try {
    hook = await callGroq(
      `اكتب سطراً أو سطرين ترويجيين جذابين بالعربية (بدون رابط، بدون ذكر سعر) عن هذا المنتج، بنفس روح المثال التالي دون نسخه حرفياً: "${promo.intro}"`,
      promo.label,
      250
    );
  } catch {
    // keep default intro
  }
  return `${hook}\n\n🔗 هنا: ${promo.botLink}\n💰 السعر: ${promo.price}\n${promo.cta}`;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const isAuthorized =
    auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET;
  if (!isAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channel = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !channel) {
    return NextResponse.json({ error: "Telegram not configured" }, { status: 503 });
  }

  // Three runs a day (vercel.json, ?slot=1|2|3). New features, bot updates
  // and new pages go first (src/lib/channelPublisher.ts); slot 1 adds the
  // daily news digest. A regular promo is posted only when the run had
  // nothing new to say, so the channel never gets more than a few posts.
  // Keeps the media bot reachable even while its Render server is suspended.
  await ensureFrontDoor().catch(() => null);

  const slot = Math.min(3, Math.max(1, Number(req.nextUrl.searchParams.get("slot") || "2") || 2));
  const fresh = await publishNew(slot).catch((e) => {
    console.error("[telegram-post] publishNew failed", e);
    return { posted: [] as string[], skipped: [] as string[] };
  });
  if (fresh.posted.length > 0) {
    return NextResponse.json({ ok: true, slot, posted: fresh.posted, skipped: fresh.skipped });
  }

  // No store topics: /store was retired and now redirects to /news.
  const paidTopics = await getPaidTopics();
  const botPromos = getBotPromos();

  // Plain topics (free + live paid + store) far outnumber the bot-purchase
  // pitch, so the AD_BOT awareness post stays an occasional post, not a
  // spam pattern — roughly 1-in-N where N grows with the live catalog size.
  const pool: { label: string; run: () => Promise<string> }[] = [
    ...FREE_TOPICS.map((t) => ({ label: t.name, run: () => writeGenericPost(t) })),
    ...LIVE_BOT_TOPICS.map((t) => ({ label: t.name, run: () => writeGenericPost(t) })),
    ...paidTopics.map((t) => ({ label: t.name, run: () => writeGenericPost(t) })),
    ...botPromos.map((p) => ({ label: p.label, run: () => buildBotPromoText(p) })),
  ];

  const picked = pool[Math.floor(Math.random() * pool.length)];
  const text = await picked.run();
  if (!isSafeForChannel(text)) {
    return NextResponse.json({ ok: false, slot, topic: picked.label, blocked: true });
  }
  const ok = await sendToChannel(text);
  return NextResponse.json({ ok, slot, topic: picked.label, skipped: fresh.skipped });
}
