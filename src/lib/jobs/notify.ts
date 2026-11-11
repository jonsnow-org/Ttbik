/**
 * The jobs/store bot's chat notifications for store deals, shared by the chat and the Mini App so both sides always hear about
 * a new offer, a counter, an accepted deal, a receipt or a dispute in the bot chat, whichever surface the other side used.
 * Every notification that concerns an order or offer carries a «📱 افتح في التطبيق» button to that section of the bot's own app.
 */
import { publicSiteUrl } from "@/lib/siteUrl";
import { InlineKeyboard, type Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { botAppUrl } from "@/lib/builderOwnerBot";
import { gateUrl } from "@/lib/hostingOps";
import { contactUrlOf, otherPartyOf, type AcceptOutcome, type OfferRow } from "@/lib/jobs/core";

const SUPER_ADMIN_ID = () => process.env.SUPER_ADMIN_TELEGRAM_ID || "";
const shortId = (id: string) => id.slice(-6);
export const APP_OPEN_LABEL = "📱 افتح في التطبيق";
export const appLink = (botId: string, section: string, params: Record<string, string> = {}) => botAppUrl(gateUrl(), botId, section, params);
const send = (bot: TelegramBot, to: string, text: string, kb?: InlineKeyboard) => bot.api.sendMessage(Number(to), text, kb ? { reply_markup: kb } : {}).then(() => true).catch(() => false);
export function depositLink(userId: string): string {
  const base = publicSiteUrl();
  return `${base}/pay/jobs?uid=${userId}`;
}
export function receivedDisputeKeyboard(orderId: string, botId?: string): InlineKeyboard {
  const kb = new InlineKeyboard().text("✅ لقد استلمت المنتج", `jreceived|${orderId}`).row().text("⚠️ فتح نزاع", `jdispute|${orderId}`);
  if (botId) kb.row().webApp(APP_OPEN_LABEL, appLink(botId, "orders"));
  return kb;
}

async function offerTitle(o: Pick<OfferRow, "kind" | "listingId" | "wantedId">) {
  return o.kind === "LISTING"
    ? (await prisma.storeListing.findUnique({ where: { id: o.listingId! } }))?.title
    : (await prisma.storeWantedListing.findUnique({ where: { id: o.wantedId! } }))?.title;
}

/** A new offer or a counter: the side whose turn it is gets accept / reject / negotiate (same buttons as before). */
export async function notifyOfferToOtherParty(bot: TelegramBot, offer: OfferRow, botId?: string) {
  const title = await offerTitle(offer);
  const proposerLabel = offer.lastOfferBy === offer.buyerId ? "المشتري" : "البائع";
  const kb = new InlineKeyboard()
    .text("✅ قبول", `joffer_accept|${offer.id}`).text("❌ رفض", `joffer_reject|${offer.id}`).row()
    .text("💬 تفاوض (سعر آخر)", `joffer_negotiate|${offer.id}`);
  if (botId) kb.row().webApp(APP_OPEN_LABEL, appLink(botId, "orders"));
  await send(bot, otherPartyOf(offer), `💰 عرض سعر على "${title}": $${offer.price.toFixed(2)} من ${proposerLabel} (#${shortId(offer.lastOfferBy)})`, kb);
}
export async function notifyOfferRejected(bot: TelegramBot, offer: OfferRow) {
  await send(bot, offer.lastOfferBy, `❌ تم رفض عرضك بسعر $${offer.price.toFixed(2)}.`);
}

/** After acceptOfferCore: the same messages both sides got from the chat. */
export async function notifyAcceptOutcome(bot: TelegramBot, r: AcceptOutcome, botId?: string, homeKb?: unknown) {
  const extra = homeKb ? { reply_markup: homeKb as any } : {};
  if (r.ok && r.mode === "manual") {
    const o = r.offer;
    const [seller, buyer] = await Promise.all([prisma.jobsProfile.findUnique({ where: { userId: o.sellerId } }), prisma.jobsProfile.findUnique({ where: { userId: o.buyerId } })]);
    const sc = contactUrlOf(seller), bc = contactUrlOf(buyer);
    await bot.api.sendMessage(Number(o.buyerId), `🤝 تم الاتفاق على السعر $${o.price.toFixed(2)} — هذا المنتج دفعه يدوي، تواصل مع البائع لإتمام الصفقة.${sc ? `\n${sc}` : ""}`, extra).catch(() => null);
    await bot.api.sendMessage(Number(o.sellerId), `🤝 تم الاتفاق على السعر $${o.price.toFixed(2)} — تواصل مع المشتري لإتمام الصفقة يدوياً.${bc ? `\n${bc}` : ""}`, extra).catch(() => null);
    return;
  }
  if (r.ok && r.mode === "escrow") {
    const o = r.offer;
    const kbS = botId ? new InlineKeyboard().webApp(APP_OPEN_LABEL, appLink(botId, "orders")) : undefined;
    if (r.wanted) {
      await send(bot, o.buyerId, `✅ تم الاتفاق على تلبية طلبك "${r.title}" بسعر $${o.price.toFixed(2)}. تم حجز المبلغ من رصيدك. تواصل مع البائع لترتيب التسليم، واضغط الزر أدناه فقط بعد استلام المنتج فعلياً.`, receivedDisputeKeyboard(r.orderId, botId));
      await send(bot, o.sellerId, `✅ قُبل عرضك لتلبية طلب "${r.title}" بسعر $${o.price.toFixed(2)} — تم حجز المبلغ من المشتري. رتّب التسليم معه، وسيتحرر المبلغ عند تأكيده الاستلام.`, kbS);
    } else {
      await send(bot, o.buyerId, `✅ تم قبول عرضك بسعر $${o.price.toFixed(2)} على "${r.title}"! تم حجز المبلغ من رصيدك. تواصل مع البائع لترتيب التسليم، واضغط الزر أدناه فقط بعد استلام المنتج فعلياً.`, receivedDisputeKeyboard(r.orderId, botId));
      await send(bot, o.sellerId, `✅ قبلت عرضاً بسعر $${o.price.toFixed(2)} على "${r.title}" — تم حجز المبلغ من المشتري. رتّب التسليم معه، وسيتحرر المبلغ عند تأكيده الاستلام.`, kbS);
    }
    return;
  }
  if (!r.ok && r.reason === "unavailable") {
    await bot.api.sendMessage(Number(r.offer.buyerId), r.error).catch(() => null);
    await bot.api.sendMessage(Number(r.offer.sellerId), r.error).catch(() => null);
    return;
  }
  if (!r.ok && r.reason === "balance") {
    await bot.api.sendMessage(Number(r.offer.sellerId), "❌ لم يكتمل الاتفاق — رصيد المشتري غير كافٍ حالياً.").catch(() => null);
    await bot.api.sendMessage(Number(r.offer.buyerId), `❌ قُبل عرضك لكن رصيدك $${r.balance.toFixed(2)} لا يكفي (السعر $${r.offer.price.toFixed(2)}). أودِع ثم قدّم عرضاً جديداً:\n${depositLink(r.offer.buyerId)}`, extra).catch(() => null);
  }
}

export async function notifyReceived(bot: TelegramBot, order: { sellerId: string; amount: number }) {
  await send(bot, order.sellerId, `✅ أكّد المشتري استلام طلبه — تم إضافة $${order.amount.toFixed(2)} لرصيدك.`);
}
export async function notifyDisputeOpened(bot: TelegramBot, orderId: string, otherSide: string, amount: number, botId?: string) {
  const kb = new InlineKeyboard().text("📝 تقديم إفادتي", `jdisputestate|${orderId}`);
  if (botId) kb.row().webApp(APP_OPEN_LABEL, appLink(botId, "orders"));
  await send(bot, otherSide, `⚠️ فتح الطرف الآخر نزاعاً على طلب بقيمة $${amount.toFixed(2)}. سيُطلب منك إفادتك أيضاً.`, kb);
}
export async function notifyDisputeReady(bot: TelegramBot, orderId: string, order: { amount: number; buyerId: string; sellerId: string } | null, d: { buyerStatement: string | null; sellerStatement: string | null }) {
  const admin = SUPER_ADMIN_ID();
  if (!admin) return;
  await send(bot, admin,
    `⚠️ نزاع جاهز للمراجعة — طلب #${shortId(orderId)} بقيمة $${order?.amount.toFixed(2)}\n\n` +
      `🟦 المشتري (#${shortId(order?.buyerId || "")}):\n${d.buyerStatement}\n\n` +
      `🟥 البائع (#${shortId(order?.sellerId || "")}):\n${d.sellerStatement}`,
    new InlineKeyboard().text("✅ الإفراج للبائع", `jresolve|${orderId}|seller`).text("↩️ استرداد للمشتري", `jresolve|${orderId}|buyer`));
}
export async function notifyAdminMessage(bot: TelegramBot, senderId: string, messageId: string, text: string, suggestion: boolean) {
  const admin = SUPER_ADMIN_ID();
  if (!admin) return;
  await send(bot, admin, suggestion ? `💡 اقتراح جديد من #${shortId(senderId)}:\n\n${text}` : `📩 رسالة جديدة من #${shortId(senderId)}:\n\n${text}`,
    new InlineKeyboard().text("↩️ رد", `jadmin_reply|${senderId}|${messageId}`));
}
