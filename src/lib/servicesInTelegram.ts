/**
 * «🧭 خدمات وأرباح» inside Telegram (owner, 2026-11-10): the site's service pages (remit, channel exchange, channel
 * audit, advertising, khatma, contests, shops) open as Mini App pages from the existing bots, via INLINE web_app
 * buttons (they carry signed initData and need no BotFather domain setup). Same list as the site menu.
 */
import { InlineKeyboard } from "grammy";
import { SERVICE_LINKS, CHAINS_BOT_USERNAME, chainsBotLink } from "@/config/navigation";
export { CHAINS_BOT_USERNAME, IN_CHAINS_BOT, IN_STORE_BOT, STORE_BOT_USERNAME, chainsBotLink } from "@/config/navigation";
import { SITE_URL } from "@/lib/siteUrl";

export const SERVICES_BUTTON = "🧭 خدمات وأرباح";
export type ServiceId = (typeof SERVICE_LINKS)[number]["id"];

export function isServicesRequest(text: string | null | undefined): boolean {
  const t = String(text || "").trim();
  return t === SERVICES_BUTTON || /^\/services(@\w+)?$/i.test(t);
}

/** Absolute https URL of a service page, marked as opened from Telegram (`?src=tg`, for analytics only). */
export function serviceUrl(href: string, site = SITE_URL): string {
  return `${site.replace(/\/$/, "")}${href}?src=tg`;
}

/** Two buttons per row; `first` puts the bot's own services at the top. Khatma and contests open the chains bot, shops the store bot. */
export function servicesKeyboard(first: readonly ServiceId[] = [], site = SITE_URL, chainsBot = CHAINS_BOT_USERNAME): InlineKeyboard {
  const ordered = [...SERVICE_LINKS].sort((a, b) => Number(first.includes(b.id)) - Number(first.includes(a.id)));
  const kb = new InlineKeyboard();
  ordered.forEach((s, i) => {
    const tme = chainsBotLink(s.id, chainsBot);
    if (tme) kb.url(s.label, tme);
    else kb.webApp(s.label, serviceUrl(s.href, site));
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

export const SERVICES_TEXT = "🧭 خدمات وأرباح المنصة — تفتح هنا داخل تيليجرام:";

type Api = { sendMessage: (chatId: number, text: string, other?: any) => Promise<unknown> };
export async function sendServices(bot: { api: Api }, chatId: number, first: readonly ServiceId[] = [], chainsBot = CHAINS_BOT_USERNAME): Promise<void> {
  await bot.api.sendMessage(chatId, SERVICES_TEXT, { reply_markup: servicesKeyboard(first, SITE_URL, chainsBot) }).catch(() => null);
}
