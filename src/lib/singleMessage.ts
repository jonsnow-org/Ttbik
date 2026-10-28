/**
 * ONE message per request in the Telegram chat (owner 2026-10-28), shared by every model (Nova, Sham v2, Sham): it opens within seconds with the understood
 * request + the progress block, is edited as the work goes on, and ends AS the answer (edited in place). Never an "understood" message plus a separate progress
 * message. Neutral module: no model owns it. Edits are throttled for Telegram's rate limits; only a long final answer overflows into follow-up messages.
 */
type Api = { sendMessage: (...a: any[]) => Promise<any>; editMessageText?: (...a: any[]) => Promise<any>; deleteMessage?: (...a: any[]) => Promise<any> };
type Bot = { api: Api };
import { beginStep, endStep, newTimeline, renderTimeline, understandRequest, type Step, type Timeline } from "@/lib/agentCard";

export const TG_MAX = 4096;
export const EDIT_EVERY_MS = 2000;
export type Card = Timeline & { msgId?: number; at: number; done?: boolean; chain: Promise<unknown>; timer?: ReturnType<typeof setTimeout>; dirty?: boolean; ack?: string };

/** Kept for callers that still want a one-line echo (not used by the cards any more: the line on the card is the model's own, see agentCard.ts). */
export function understoodLine(request: string): string {
  const t = String(request || "").replace(/\s+/g, " ").trim();
  if (!t) return "✅ فهمت طلبك — سأبدأ الآن.";
  return `✅ فهمت طلبك: «${t.length > 90 ? `${t.slice(0, 90)}…` : t}» — سأبدأ الآن.`;
}

export function renderCard(c: Card): string { return renderTimeline(c); }

const editOnce = (bot: Bot, chatId: number, card: Card, text: string): Promise<unknown> => {
  card.chain = card.chain.then(() => (card.done || !card.msgId ? null : bot.api.editMessageText!(chatId, card.msgId, text).catch(() => null)));
  return card.chain;
};
/** Edits the card now (serialised: a late edit can never land after the final answer). */
async function flush(bot: Bot, chatId: number, card: Card): Promise<void> {
  if (card.timer) { clearTimeout(card.timer); card.timer = undefined; }
  card.dirty = false;
  card.at = Date.now();
  await editOnce(bot, chatId, card, renderCard(card));
}
/** An event happened: edit at most every EDIT_EVERY_MS (Telegram's rate limits); an edit that has to wait is sent by a timer, so the last event always shows. */
async function touch(bot: Bot, chatId: number, card: Card, force = false): Promise<void> {
  if (!card.msgId || card.done) return;
  const wait = EDIT_EVERY_MS - (Date.now() - card.at);
  if (force || wait <= 0) return flush(bot, chatId, card);
  card.dirty = true;
  if (!card.timer) { card.timer = setTimeout(() => { card.timer = undefined; void flush(bot, chatId, card); }, wait); (card.timer as { unref?: () => void }).unref?.(); }
}

/**
 * Opens the one message right away (before the model has said anything): date + time, the neutral "received" line and the first step. `understand` (optional) asks the MODEL
 * for its own one-line understanding in parallel (a tiny call, ~3 s cap, see understandRequest); it is edited into the card when it arrives and never delays anything.
 * null when Telegram refused or there is no edit API (callers then keep their older replies).
 */
export async function openCard(bot: Bot, chatId: number, request: string, opts: { understand?: () => Promise<string | null | undefined> } = {}): Promise<Card | null> {
  if ((process.env.CODER_SINGLE_MESSAGE || "").toLowerCase() === "off" || chatId <= 0 || typeof bot.api.editMessageText !== "function") return null;
  const card: Card = { ...newTimeline(), at: Date.now(), chain: Promise.resolve() };
  beginStep(card, "phase", "received", "استلام الطلب", card.startedAt);
  const m = await bot.api.sendMessage(chatId, renderCard(card)).catch(() => null);
  card.msgId = m?.message_id;
  if (!card.msgId) return null;
  if (opts.understand) {
    const put = (line: string) => { if (card.done || !card.msgId) return; card.ack = line; void touch(bot, chatId, card, true); };
    void understandRequest(opts.understand, request, { onLate: put }).then((line) => { if (line) put(line); });
  }
  return card;
}

/** The card as plain JSON (what a long task keeps between legs): no timers, no promise chain. */
export function cardSnapshot(c: Card): { msgId?: number; startedAt: number; ack?: string; steps: Step[]; at: number } {
  return { msgId: c.msgId, startedAt: c.startedAt, ack: c.ack, steps: c.steps.map((x) => ({ ...x })), at: c.at };
}
/** The card of the next leg, from what cardSnapshot saved (an older saved card with only text lines starts a fresh timeline on the same message). */
export function cardRestore(raw: { msgId?: number; startedAt?: number; ack?: string; steps?: unknown[]; at?: number }): Card {
  const steps = Array.isArray(raw.steps) ? (raw.steps as Step[]).filter((x) => x && typeof x.t0 === "number" && typeof x.label === "string") : [];
  return { startedAt: raw.startedAt || Date.now(), ack: typeof raw.ack === "string" ? raw.ack : undefined, steps, msgId: raw.msgId, at: 0, chain: Promise.resolve() };
}
/** The card's text with extra lines under it (a hand-over line); the running step ends first. */
export function cardRender(card: Card | null | undefined, tail: string[] = []): string {
  if (!card) return tail.join("\n");
  endStep(card, true);
  return renderTimeline(card, Date.now(), { tail });
}

/** A phase of the model (thinking, writing, sending, queued…): a real state it is in now. Same key again only refreshes the label. */
export async function cardPhase(bot: Bot, chatId: number, card: Card | null | undefined, key: string, label: string): Promise<void> {
  if (!card?.msgId) return;
  const changed = beginStep(card, "phase", key, label);
  void changed;
  await touch(bot, chatId, card);
}
/** A tool the agent really called (قراءة ملف …); it stays "running" until cardToolDone. */
export async function cardTool(bot: Bot, chatId: number, card: Card | null | undefined, label: string): Promise<void> {
  if (!card?.msgId) return;
  beginStep(card, "tool", "tool", label);
  await touch(bot, chatId, card);
}
/** The running step ended (ok / failed). The next event starts the next step; nothing is invented in between. */
export async function cardStepDone(bot: Bot, chatId: number, card: Card | null | undefined, ok = true): Promise<void> {
  if (!card?.msgId) return;
  endStep(card, ok);
  await touch(bot, chatId, card);
}
/** Legacy single line (an info event): a phase step with that text. */
export async function cardNote(bot: Bot, chatId: number, card: Card | null | undefined, line: string, force = false): Promise<void> {
  if (!card?.msgId) return;
  const l = String(line || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!l) return;
  beginStep(card, "phase", `note:${l}`, l);
  await touch(bot, chatId, card, force);
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
  if (card?.timer) { clearTimeout(card.timer); card.timer = undefined; }
  if (card) await card.chain.catch(() => null);
  if (card) card.done = true;
  if (!card?.msgId || !parts.length) { for (const p of parts) await send(p); return; }
  const ok = await bot.api.editMessageText!(chatId, card.msgId, parts[0]).then(() => true).catch((e: any) => /not modified/i.test(String(e?.description || e?.message || e)));
  if (!ok) { await bot.api.deleteMessage?.(chatId, card.msgId)?.catch?.(() => null); await send(parts[0]); }
  for (const p of parts.slice(1)) await send(p);
  card.msgId = undefined;
}

/** The message ends as a notice (a failure, a stop, a hand-over line) instead of an answer. */
export async function cardSay(bot: Bot, chatId: number, card: Card | null | undefined, text: string): Promise<boolean> {
  if (!card?.msgId) return false;
  if (card.timer) { clearTimeout(card.timer); card.timer = undefined; }
  await card.chain.catch(() => null);
  card.done = true;
  return bot.api.editMessageText!(chatId, card.msgId, text.slice(0, TG_MAX)).then(() => true).catch(() => false);
}

/** Media is sent separately: the card has nothing to say any more. */
export async function cardDrop(bot: Bot, chatId: number, card: Card | null | undefined): Promise<void> {
  if (!card?.msgId) return;
  if (card.timer) { clearTimeout(card.timer); card.timer = undefined; }
  await card.chain.catch(() => null);
  card.done = true;
  const id = card.msgId;
  card.msgId = undefined;
  await bot.api.deleteMessage?.(chatId, id)?.catch?.(() => null);
}
