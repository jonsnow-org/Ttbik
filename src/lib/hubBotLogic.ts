// Creator-hub bot templates (/create tools as Telegram bots), activated from /bots like the other owner templates:
//   HUB_APP_BOT  HUB_LEGAL_BOT  HUB_MIND_BOT  HUB_DIALECT_BOT  HUB_REPURPOSE_BOT  HUB_POINTS_BOT
// Natural language + reply keyboards, no slash commands besides Telegram's own /start. Fully isolated: own tables (hub_*), no shared
// logic with Athar/Nova/Zenobia. Users are keyed by a salted one-way hash of their Telegram id (hubUid) — the mental-support bot also
// skips BotVisit so its users' raw ids are never stored. Points are shared with the website hub.
import { Bot as TelegramBot, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit } from "@/lib/botVisit";
import { isRateLimited } from "@/lib/rateLimit";
import {
  appsOf, award, createApp, forgetMind, getApp, getState, hubUid, leaderboard, logMood, moodHistory, profile, saveApp, setDisplayName, setState, takeQuota,
} from "@/lib/hub/hubDb";
import { APP_TEMPLATES, AppTemplate, applyChatEdit, detectTemplate } from "@/lib/hub/appConfig";
import {
  buildAppWithAi, detectDialectRequest, detectLegalDoc, DIALECTS, draftLegalDoc, EXERCISES, FORMATS, legalAnalyze, LEGAL_DOCS, mindReply, PSYCHOED, repurpose, translateDialect,
} from "@/lib/hub/tools";
import { crisisMessage, detectCrisis, LEGAL_COUNTRIES, LEGAL_DISCLAIMER, MIND_DISCLAIMER } from "@/lib/hub/safety";

export const HUB_TEMPLATES = ["HUB_APP_BOT", "HUB_LEGAL_BOT", "HUB_MIND_BOT", "HUB_DIALECT_BOT", "HUB_REPURPOSE_BOT", "HUB_POINTS_BOT"] as const;
export const isHubTemplate = (t: string) => (HUB_TEMPLATES as readonly string[]).includes(t);

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
const MOODS = ["😞", "🙁", "😐", "🙂", "😄"];

function kb(rows: string[][]): Keyboard {
  const k = new Keyboard();
  rows.forEach((r, i) => { r.forEach((t) => k.text(t)); if (i < rows.length - 1) k.row(); });
  return k.resized();
}
const MENUS: Record<string, string[][]> = {
  HUB_APP_BOT: [["🧱 تطبيق جديد", "📱 تطبيقاتي"], ["🏆 نقاطي", "ℹ️ مساعدة"]],
  HUB_LEGAL_BOT: [["📄 خطاب شكوى", "🏠 عقد إيجار"], ["💼 عقد عمل", "🤐 اتفاقية عدم إفصاح"], ["🌍 اختيار البلد", "🏆 نقاطي"]],
  HUB_MIND_BOT: [["🌬️ تمرين تنفس", "🌿 تمرين تثبيت"], ["📊 سجّل مزاجي", "📈 مزاجي آخر أسبوعين"], ["📚 عن القلق", "📚 عن النوم"], ["🆘 أرقام الطوارئ", "🗑 انسَ معلوماتي"]],
  HUB_DIALECT_BOT: [["إلى المصرية", "إلى الشامية"], ["إلى الخليجية", "إلى المغاربية"], ["إلى الفصحى", "🏆 نقاطي"]],
  HUB_REPURPOSE_BOT: [["منشورات", "سلسلة تغريدات"], ["سكربت فيديو", "نشرة بريدية"], ["🏆 نقاطي"]],
  HUB_POINTS_BOT: [["🏆 نقاطي", "🥇 لوحة الصدارة"], ["ℹ️ كيف أكسب النقاط"]],
};
const INTRO: Record<string, string> = {
  HUB_APP_BOT: "🧱 صانع التطبيقات\nصف تطبيقك بجملة، مثلاً:\n«متجر عطور اسمه ريحان باللون الذهبي، عطر عود بسعر 30$ ومسك بسعر 15$»\nالقوالب: متجر، حجز مواعيد، قائمة مطعم، معرض أعمال، صفحة روابط، اختبار.\nبعدها عدّل بالكلام: «أضف قهوة بسعر 3$»، «احذف قهوة»، «اللون أخضر»، «غيّر الاسم إلى …»، «التواصل @معرفي».\nالتطبيق صفحة ويب تفتح داخل تيليجرام كتطبيق مصغّر (ليس تطبيقاً لمتجر Google/Apple). الحد: 3 تطبيقات و30 عنصراً.",
  HUB_LEGAL_BOT: `⚖️ المساعد القانوني\nاكتب وقائع مشكلتك (من، ماذا، متى، المستندات) وسأرتب لك المسائل والخيارات العامة، أو اختر مستنداً لصياغة مسودة.\n\n${LEGAL_DISCLAIMER}`,
  HUB_MIND_BOT: `💛 رفيق الدعم النفسي الأولي\nاكتب ما تشعر به وسأسمعك. عندي تمارين تنفس وتثبيت ومتتبع مزاج.\nمحادثتك لا تُحفظ، ويمكنك حذف سجل مزاجك بكتابة «انسَ معلوماتي».\n\n${MIND_DISCLAIMER}\nإن كنت في خطر الآن اضغط «🆘 أرقام الطوارئ».`,
  HUB_DIALECT_BOT: "🗣️ مترجم اللهجات\nاختر اللهجة الهدف من الأزرار ثم أرسل النص، أو اكتب مباشرة: «حوّل للمصري: …».",
  HUB_REPURPOSE_BOT: "♻️ محوّل المحتوى\nاختر الشكل (منشورات، سلسلة تغريدات، سكربت فيديو، نشرة) ثم ألصق مقالك (80 حرفاً على الأقل).",
  HUB_POINTS_BOT: "🏆 نقاط شام\nنقاطك مشتركة بين كل أدوات المنشئ على الموقع والبوتات. استبدلها برصيد في «بشر» من الموقع: " + "/create",
};

async function send(bot: TelegramBot, chatId: number, text: string, template: string, extra: Record<string, unknown> = {}) {
  const t = text.length > 4000 ? text.slice(0, 3990) + "…" : text;
  await bot.api.sendMessage(chatId, t, { reply_markup: kb(MENUS[template]), link_preview_options: { is_disabled: true }, ...extra } as any);
}

async function pointsText(uid: string): Promise<string> {
  const p = await profile(uid);
  return `🏆 نقاطك: ${p.balance} (المجموع ${p.total})\nالمستوى ${p.level.level}: ${p.level.name}${p.level.next ? ` · ${p.level.progress}% للمستوى التالي` : ""}\n${p.badges.length ? "الأوسمة: " + p.badges.join(" ") : "لا أوسمة بعد."}`;
}

export async function handleHubBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const template = botRow.template;
  const chatId = msg.chat.id as number;
  const uid = hubUid("tg", msg.from.id);
  const sk = `${uid}|${template}`;
  const text = String(msg.text || "").trim();
  if (!text) return;

  // Mental support: crisis check on EVERY message before anything else (rate limits, quotas, state) — fixed text, no model.
  if (template === "HUB_MIND_BOT" && detectCrisis(text)) {
    await send(bot, chatId, crisisMessage(null), template);
    return;
  }
  if (isRateLimited(`hubbot:${uid}`, 12, 60_000)) {
    await send(bot, chatId, "⏳ رسائل كثيرة، انتظر دقيقة.", template);
    return;
  }

  if (text === "/start" || text.startsWith("/start ")) {
    if (template !== "HUB_MIND_BOT") await recordBotVisit(botRow.id, String(msg.from.id)).catch(() => null);
    await award(uid, "daily");
    await send(bot, chatId, INTRO[template] || "أهلاً!", template);
    return;
  }
  if (text === "🏆 نقاطي") return send(bot, chatId, await pointsText(uid), template);

  const st = await getState(sk).catch(() => ({} as Record<string, any>));
  const needAi = async () => {
    if (await takeQuota(uid)) return true;
    await send(bot, chatId, "انتهى حدّك المجاني اليومي (25 طلباً). يتجدد غداً.", template);
    return false;
  };

  switch (template) {
    case "HUB_APP_BOT": {
      if (text === "ℹ️ مساعدة") return send(bot, chatId, INTRO[template], template);
      if (text === "🧱 تطبيق جديد") { await setState(sk, { ...st, mode: "new" }); return send(bot, chatId, "صف تطبيقك بجملة واحدة أو أكثر:", template); }
      const mine = await appsOf(uid);
      if (text === "📱 تطبيقاتي") {
        if (!mine.length) return send(bot, chatId, "لا تطبيقات بعد. اضغط «🧱 تطبيق جديد».", template);
        return send(bot, chatId, mine.map((a) => `• ${a.config.title} — ${site()}/apps/${a.slug} (${a.views} مشاهدة)`).join("\n") + "\n\nللتعديل على تطبيق آخر اكتب اسمه.", template);
      }
      const named = mine.find((a) => a.config.title === text);
      if (named) { await setState(sk, { ...st, slug: named.slug, mode: null }); return send(bot, chatId, `✏️ التعديل الآن على «${named.config.title}».`, template); }
      const current = st.slug ? mine.find((a) => a.slug === st.slug) : mine[0];
      if (current && st.mode !== "new") {
        const app = await getApp(current.slug);
        if (app) {
          const e = applyChatEdit(app.config, text);
          if (e.changed) {
            await saveApp(app.slug, e.config);
            await award(uid, "app_update");
            return send(bot, chatId, `✅ تم التحديث فوراً: ${site()}/apps/${app.slug}`, template);
          }
        }
        if (!detectTemplate(text)) return send(bot, chatId, "لم أفهم التعديل. أمثلة: «أضف قهوة بسعر 3$»، «احذف قهوة»، «اللون أحمر»، «غيّر الاسم إلى …»، «التواصل @معرفي». أو اضغط «🧱 تطبيق جديد».", template);
      }
      if (text.length < 5) return send(bot, chatId, "صف تطبيقك بجملة أطول قليلاً.", template);
      if (!(await needAi())) return;
      const built = await buildAppWithAi(text);
      const r = await createApp(uid, built.config);
      if (!r.ok) return send(bot, chatId, r.error, template);
      await award(uid, "app_create");
      await setState(sk, { slug: r.slug, mode: null });
      const url = `${site()}/apps/${r.slug}`;
      const t = APP_TEMPLATES[built.config.template as AppTemplate];
      await send(bot, chatId, `${t.icon} تطبيقك «${built.config.title}» جاهز (${t.label}، ${built.config.items.length} عنصر):\n${url}\n\nعدّله الآن بالكلام، والتغيير يظهر فوراً. لجعله زر قائمة في بوتك: BotFather ← Bot Settings ← Menu Button.\n🔑 مفتاح التعديل من الموقع: ${r.editKey}`, template);
      await bot.api.sendMessage(chatId, "افتحه كتطبيق مصغّر:", { reply_markup: { inline_keyboard: [[{ text: "📱 فتح التطبيق", web_app: { url } }]] } }).catch(() => null);
      return;
    }
    case "HUB_LEGAL_BOT": {
      if (text === "🌍 اختيار البلد") return send(bot, chatId, "اكتب اسم بلدك: " + Object.values(LEGAL_COUNTRIES).join("، "), template);
      const cc = Object.entries(LEGAL_COUNTRIES).find(([, n]) => text === n || text === n.replace("ُ", ""))?.[0];
      if (cc) { await setState(sk, { ...st, country: cc }); return send(bot, chatId, `✅ البلد: ${LEGAL_COUNTRIES[cc]}`, template); }
      const btnDoc: Record<string, string> = { "📄 خطاب شكوى": "complaint", "🏠 عقد إيجار": "rental", "💼 عقد عمل": "employment", "🤐 اتفاقية عدم إفصاح": "nda" };
      const kind = btnDoc[text] || (text.length < 60 && /اكتب|صغ|صيغ|نموذج|مسوده|مسودة|اريد|بدي|ابي/.test(text) ? detectLegalDoc(text) : null);
      if (kind) {
        await award(uid, "doc_draft");
        const doc = draftLegalDoc(kind, {}, st.country || "")!;
        return send(bot, chatId, `${doc}\n\n✏️ استبدل ما بين [ ] ببياناتك. الحقول: ${LEGAL_DOCS[kind].fields.join("، ")}`, template);
      }
      if (text.length < 20) return send(bot, chatId, "اكتب وقائع مشكلتك بتفصيل أكثر، أو اختر مستنداً من الأزرار.", template);
      if (!(await needAi())) return;
      const r = await legalAnalyze(text, st.country || "");
      if (!r.refused) await award(uid, "tool_use");
      return send(bot, chatId, (st.country ? "" : "💡 حدّد بلدك من «🌍 اختيار البلد» لنتيجة أدق.\n\n") + r.text, template);
    }
    case "HUB_MIND_BOT": {
      if (text === "🆘 أرقام الطوارئ") return send(bot, chatId, crisisMessage(null), template);
      if (/انس|إنس|امسح|احذف/.test(text) && /معلومات|ذاكرت|سجل|بيانات/.test(text)) { await forgetMind(uid); return send(bot, chatId, "🗑 تم حذف سجل مزاجك وكل ما حُفظ عنك في هذا البوت.", template); }
      if (text === "🌬️ تمرين تنفس") return send(bot, chatId, EXERCISES.breathing, template);
      if (text === "🌿 تمرين تثبيت") return send(bot, chatId, EXERCISES.grounding, template);
      if (text === "📚 عن القلق") return send(bot, chatId, PSYCHOED.anxiety, template);
      if (text === "📚 عن النوم") return send(bot, chatId, PSYCHOED.sleep, template);
      if (text === "📊 سجّل مزاجي") return bot.api.sendMessage(chatId, "كيف مزاجك الآن؟", { reply_markup: kb([MOODS, ["◀️ رجوع"]]) }).then(() => undefined);
      if (text === "◀️ رجوع") return send(bot, chatId, "🏠", template);
      const mi = MOODS.indexOf(text);
      if (mi >= 0) { await logMood(uid, mi + 1); await award(uid, "mood_log"); return send(bot, chatId, mi <= 1 ? "شكراً لمشاركتك. جرّب «🌬️ تمرين تنفس»، وإن أردت اكتب لي ما يضايقك." : "سُجّل مزاجك ✅", template); }
      if (text === "📈 مزاجي آخر أسبوعين") {
        const h = await moodHistory(uid);
        return send(bot, chatId, h.length ? h.map((x) => `${new Date(x.created_at).toISOString().slice(5, 10)} ${MOODS[x.score - 1]}`).join("\n") : "لا تسجيلات بعد.", template);
      }
      if (!(await needAi())) return;
      const r = await mindReply(text, null);
      if (!r.crisis) await award(uid, "tool_use");
      return send(bot, chatId, r.text, template);
    }
    case "HUB_DIALECT_BOT": {
      const btn = text.match(/^إلى (المصرية|الشامية|الخليجية|المغاربية|الفصحى)$/);
      if (btn) { const to = detectDialectRequest(btn[1])!; await setState(sk, { to }); return send(bot, chatId, `✅ الهدف: ${DIALECTS[to]}. أرسل النص الآن.`, template); }
      let to = st.to as string | undefined;
      let body = text;
      const inline = text.match(/^(?:حوّل|حول|ترجم)\s+(?:لل|ل|الى |إلى )?(\S+)\s*[:：]\s*([\s\S]+)/);
      if (inline && detectDialectRequest(inline[1])) { to = detectDialectRequest(inline[1])!; body = inline[2]; }
      if (!to) return send(bot, chatId, "اختر اللهجة الهدف من الأزرار أولاً.", template);
      if (!(await needAi())) return;
      const r = await translateDialect(body, "", to);
      if (r.ok) await award(uid, "tool_use");
      return send(bot, chatId, r.text, template);
    }
    case "HUB_REPURPOSE_BOT": {
      const map: Record<string, string> = { "منشورات": "posts", "سلسلة تغريدات": "thread", "سكربت فيديو": "video", "نشرة بريدية": "newsletter" };
      if (map[text]) { await setState(sk, { format: map[text] }); return send(bot, chatId, `✅ الشكل: ${FORMATS[map[text]]}\nألصق المقال الآن.`, template); }
      if (text.length < 80) return send(bot, chatId, "ألصق مقالاً لا يقل عن 80 حرفاً، أو اختر الشكل من الأزرار.", template);
      if (!(await needAi())) return;
      const r = await repurpose(text, st.format || "posts");
      await award(uid, "tool_use");
      return send(bot, chatId, r.text, template);
    }
    case "HUB_POINTS_BOT": {
      if (text === "🥇 لوحة الصدارة") {
        const b = await leaderboard(10);
        return send(bot, chatId, b.length ? b.map((x) => `${x.rank}. ${x.name} — ${x.total} (${x.level})`).join("\n") : "اللوحة فارغة بعد.", template);
      }
      if (text === "ℹ️ كيف أكسب النقاط") return send(bot, chatId, "ترحيب 20 · يومي 5 · أداة 2 · مستند 3 · مزاج 3 · تطبيق 10 · تحديث 1. الحد اليومي 60.\nاستبدل 10 نقاط برصيد سؤال في «بشر» من " + site() + "/create", template);
      const nm = text.match(/^(?:اسمي|سمني|سمّني)\s+(.{2,24})$/);
      if (nm) { await setDisplayName(uid, nm[1]); return send(bot, chatId, "✅ حُفظ اسمك في لوحة الصدارة.", template); }
      return send(bot, chatId, (await pointsText(uid)) + "\n\nلتظهر باسمك في اللوحة اكتب: «اسمي …»", template);
    }
  }
}
