/**
 * ONE message per request in the Telegram chat (owner 2026-10-28), shared by every model (Nova, Sham v2, Sham): it opens within seconds with the understood
 * request + the progress block, is edited as the work goes on, and ends AS the answer (edited in place). Never an "understood" message plus a separate progress
 * message. Neutral module: no model owns it. Edits are throttled for Telegram's rate limits; only a long final answer overflows into follow-up messages.
 */
type Api = { sendMessage: (...a: any[]) => Promise<any>; editMessageText?: (...a: any[]) => Promise<any>; deleteMessage?: (...a: any[]) => Promise<any> };
type Bot = { api: Api };

export const TG_MAX = 4096;
export const EDIT_EVERY_MS = 2000;
export type Card = { msgId?: number; ack: string; lines: string[]; at: number };

export function understoodLine(request: string): string {
  const t = String(request || "").replace(/\s+/g, " ").trim();
  if (!t) return "✅ فهمت طلبك — سأبدأ الآن.";
  return `✅ فهمت طلبك: «${t.length > 90 ? `${t.slice(0, 90)}…` : t}» — سأبدأ الآن.`;
}

export function renderCard(c: Card): string {
  const shown = c.lines.slice(-10);
  const body = shown.length ? shown.map((l, i) => (i === shown.length - 1 ? `▶️ ${l}` : `✅ ${l}`)).join("\n") : "⏳ جارٍ انتظار أول مخرجات النموذج…";
  return `${c.ack}\n\n📋 التقدم\n${body}`.slice(0, 4000);
}

/** Opens the one message right away (before the model has said anything). null when Telegram refused or there is no edit API (callers then keep their older replies). */
export async function openCard(bot: Bot, chatId: number, request: string): Promise<Card | null> {
  if ((process.env.CODER_SINGLE_MESSAGE || "").toLowerCase() === "off" || chatId <= 0 || typeof bot.api.editMessageText !== "function") return null;
  const card: Card = { ack: understoodLine(request), lines: [], at: Date.now() };
  const m = await bot.api.sendMessage(chatId, renderCard(card)).catch(() => null);
  card.msgId = m?.message_id;
  return card.msgId ? card : null;
}

/** A progress line (a tool step, a phase): the same message is edited, at most every EDIT_EVERY_MS. */
export async function cardNote(bot: Bot, chatId: number, card: Card | null | undefined, line: string, force = false): Promise<void> {
  if (!card?.msgId) return;
  const l = String(line || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (l && card.lines[card.lines.length - 1] !== l) card.lines.push(l);
  if (!force && Date.now() - card.at < EDIT_EVERY_MS) return;
  card.at = Date.now();
  await bot.api.editMessageText!(chatId, card.msgId, renderCard(card)).catch(() => null);
}

function chunks(text: string, max = 3800): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(text.length, i + max);
    if (end < text.length) { const nl = text.lastIndexOf("\n", end - 1); if (nl > i + max * 0.4) end = nl + 1; }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

/** The answer takes the one message's place (edited in place); what does not fit 4096 characters goes on in follow-up messages. */
export async function cardFinish(bot: Bot, chatId: number, card: Card | null | undefined, text: string, send: (part: string) => Promise<unknown>): Promise<void> {
  const parts = chunks(text);
  if (!card?.msgId || !parts.length) { for (const p of parts) await send(p); return; }
  const ok = await bot.api.editMessageText!(chatId, card.msgId, parts[0]).then(() => true).catch((e: any) => /not modified/i.test(String(e?.description || e?.message || e)));
  if (!ok) { await bot.api.deleteMessage?.(chatId, card.msgId)?.catch?.(() => null); await send(parts[0]); }
  for (const p of parts.slice(1)) await send(p);
  card.msgId = undefined;
}

/** The message ends as a notice (a failure, a stop, a hand-over line) instead of an answer. */
export async function cardSay(bot: Bot, chatId: number, card: Card | null | undefined, text: string): Promise<boolean> {
  if (!card?.msgId) return false;
  return bot.api.editMessageText!(chatId, card.msgId, text.slice(0, TG_MAX)).then(() => true).catch(() => false);
}

/** Media is sent separately: the card has nothing to say any more. */
export async function cardDrop(bot: Bot, chatId: number, card: Card | null | undefined): Promise<void> {
  if (!card?.msgId) return;
  const id = card.msgId;
  card.msgId = undefined;
  await bot.api.deleteMessage?.(chatId, id)?.catch?.(() => null);
}
