/**
 * Anonymous stranger chat for the Mini App — a thin window onto the BOT's own
 * random chat (owner spec: «exactly the bot»). Every step calls the bot's
 * functions in matchBotLogic.ts: startRandomChat (same queue, 60s window,
 * pairing rules, atomic claim, 🎛 filters, fake partners), relayRandomChatText
 * (text-only relay, banned words, 15-message contact offer), endRandomChat with
 * the same exit reasons, reportRandomChat and requestRandomChatContact.
 * Nothing here has its own rules.
 */
import { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { anonMessagesSince, ensureMatchAppTables, getAnonFilterRow } from "@/lib/match/appStore";
import { CONTACT_BLOCKED_TEXT } from "@/lib/match/contactGuard";
import { activeFilterFor, describeAnonFilter } from "@/lib/match/anonRules";
import { after } from "next/server";
import { recordAnonMessage } from "@/lib/match/appStore";
import { pingAnonSession } from "@/lib/match/realtime";
import { isAppActive, touchAppPresence } from "@/lib/match/surface";
import { getVoice, saveVoice, voiceMarker } from "@/lib/match/extras";
import {
  fakeSessionId, handleFakeBotReply,
  EXIT_REASON_LABELS, endRandomChat, relayRandomChatText, reportRandomChat, requestRandomChatContact, startRandomChat,
} from "@/lib/matchBotLogic";

type Pending = { mode?: string; sessionId?: string; partnerId?: string } | null;
const pendingOf = async (id: string): Promise<Pending> =>
  ((await prisma.matchUser.findUnique({ where: { id }, select: { pendingAction: true } }))?.pendingAction as Pending) ?? null;

export const ANON_EXIT_REASONS = [
  { code: "no_match", label: "🙏 عدم توافق بالشروط" },
  { code: "satisfied", label: "✅ اكتفيت، شكراً" },
  { code: "no_time", label: "⏱ لا وقت كافٍ الآن" },
  { code: "other", label: "➡️ إنهاء بدون سبب محدد" },
] as const;

/** Same as pressing «🔀 مراسلة عشوائية» in the bot (without the Telegram-only search animation). */
export async function anonStart(bot: TelegramBot, botRow: BotRow, me: string, ignoreFilter = false): Promise<void> {
  const p = await pendingOf(me);
  if (p?.mode === "random_chatting" || p?.mode === "fake_chatting") return;
  await touchAppPresence(me); // started from the app → deliver here, not to Telegram
  await startRandomChat(bot, Number(me), botRow, me, { quiet: true, ignoreFilter });
}

export type AnonPoll =
  | { state: "idle" }
  | { state: "waiting"; filter: string | null }
  | { state: "timeout"; filter: string | null }
  | { state: "chatting"; sessionId: string; fake?: boolean; messages: { id: number; mine: boolean; text: string; at: string }[]; voice?: boolean; contact: "hidden" | "offered" | "requested_by_me" | "requested_by_partner"; partnerRead?: number; partnerTyping?: boolean }
  | { state: "ended" };

export async function anonPoll(me: string, afterId: number, lastSessionId?: string): Promise<AnonPoll> {
  await touchAppPresence(me); // app is the active surface while it polls
  const p = await pendingOf(me);
  if (p?.mode === "random_waiting") {
    // Like the bot: no auto-extension. After the 60s window the user re-presses.
    const row = await prisma.randomChatQueue.findFirst({ where: { userId: me }, orderBy: { created_at: "desc" } });
    const fr = await getAnonFilterRow(me).catch(() => null);
    const f = activeFilterFor(fr as any, row?.id);
    const filter = f ? describeAnonFilter(f) : null;
    if (!row || row.status !== "WAITING" || row.expiresAt <= new Date()) return { state: "timeout", filter };
    return { state: "waiting", filter };
  }
  if (p?.mode === "fake_chatting") {
    // Same scripted partner as the bot, rendered in the app from the shared history.
    const sid = fakeSessionId(me);
    const msgs = await anonMessagesSince(sid, afterId);
    return { state: "chatting", sessionId: sid, fake: true, contact: "hidden", messages: msgs.map((m) => ({ id: m.id, mine: m.sender_id === me, text: m.text, at: m.created_at.toISOString() })) };
  }
  if (p?.mode === "random_chatting" && p.sessionId && p.partnerId) {
    const [session, msgs] = await Promise.all([
      prisma.randomChatSession.findUnique({ where: { id: p.sessionId } }),
      anonMessagesSince(p.sessionId, afterId),
    ]);
    if (!session || session.status !== "ACTIVE") return { state: "ended" };
    const partner = session.user1Id === me ? session.user2Id : session.user1Id;
    const seen = Math.max(afterId, ...msgs.map((m) => Number(m.id)));
    const st = await chatState(p.sessionId, me, partner, seen).catch(() => ({ partnerRead: 0, partnerTyping: false }));
    const contact = !session.contactOfferSent ? "hidden"
      : !session.contactRequestedBy ? "offered"
      : session.contactRequestedBy === me ? "requested_by_me" : "requested_by_partner";
    return {
      state: "chatting",
      sessionId: p.sessionId,
      messages: msgs.map((m) => ({ id: m.id, mine: m.sender_id === me, text: m.text, at: m.created_at.toISOString() })),
      contact,
      voice: await isAppActive(partner).catch(() => false),   // voice notes only while the partner is reading in the app too
      partnerRead: st.partnerRead,
      partnerTyping: st.partnerTyping,
    };
  }
  if (lastSessionId) return { state: "ended" };
  return { state: "idle" };
}

export async function anonSend(bot: TelegramBot, me: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const t = text.trim();
  if (!t) return { ok: false, error: "رسالة فارغة" };
  const p = await pendingOf(me);
  await touchAppPresence(me);
  if (p?.mode === "fake_chatting") {
    // Exactly the bot's fake-chat step (same script, same 5-min timeout), run after the response.
    await recordAnonMessage(fakeSessionId(me), me, t);
    await pingAnonSession(fakeSessionId(me));
    const step = async () => { await handleFakeBotReply(bot, Number(me), me, p as any, t); };
    try { after(() => step().catch(() => null)); } catch { await step(); }
    return { ok: true };
  }
  if (p?.mode !== "random_chatting" || !p.sessionId || !p.partnerId) return { ok: false, error: "لا توجد محادثة نشطة" };
  const r = await relayRandomChatText(bot, Number(me), me, { sessionId: p.sessionId, partnerId: p.partnerId }, t);
  if (r === "contact") return { ok: false, error: CONTACT_BLOCKED_TEXT };
  return r === "banned" ? { ok: false, error: "⚠️ هذه الرسالة تحتوي على محتوى غير مسموح به ولم يتم إرسالها." } : { ok: true };
}

/** End (with one of the bot's exit reasons), block, or cancel waiting — exactly the bot's paths. */
export async function anonEnd(bot: TelegramBot, me: string, kind: "end" | "block", reasonCode?: string): Promise<void> {
  const p = await pendingOf(me);
  if (p?.mode === "random_chatting" && p.sessionId && p.partnerId) {
    const label = kind === "end" && reasonCode ? EXIT_REASON_LABELS[reasonCode] || EXIT_REASON_LABELS.other : undefined;
    await endRandomChat(bot, me, p.sessionId, p.partnerId, kind, label);
  } else if (p?.mode === "fake_chatting") {
    await prisma.matchUser.update({ where: { id: me }, data: { pendingAction: null as any } }); // bot's «⏹» on a fake chat
  } else if (p?.mode === "random_waiting") {
    await prisma.randomChatQueue.updateMany({ where: { userId: me, status: "WAITING" }, data: { status: "CANCELLED" } });
    await prisma.matchUser.update({ where: { id: me }, data: { pendingAction: null as any } });
  }
}

export async function anonReport(bot: TelegramBot, me: string): Promise<boolean> {
  const p = await pendingOf(me);
  if (p?.mode !== "random_chatting" || !p.partnerId) return false;
  await reportRandomChat(bot, Number(me), me, p.partnerId);
  return true;
}

/** «📇 طلب تبادل التواصل الرسمي» — only after the bot's 15-message offer, mutual consent. */
export async function anonContact(bot: TelegramBot, me: string): Promise<string> {
  const p = await pendingOf(me);
  if (p?.mode !== "random_chatting" || !p.sessionId || !p.partnerId) return "لا توجد محادثة نشطة";
  const r = await requestRandomChatContact(bot, me, { sessionId: p.sessionId, partnerId: p.partnerId });
  return {
    ended: "انتهت هذه المحادثة.",
    not_offered: "يظهر هذا الخيار بعد 15 رسالة، كما في البوت.",
    requested: "تم إرسال الطلب، بانتظار موافقة الطرف الآخر",
    already: "طلبك قيد الانتظار بالفعل",
    revealed: "✅ تم تبادل بيانات التواصل (وصلتكما في محادثة البوت)",
  }[r];
}


// ---- ✓✓ read receipts + typing indicator (app ↔ app; a bot-side partner just shows ✓) ----
async function chatState(sessionId: string, me: string, partner: string, seen: number): Promise<{ partnerRead: number; partnerTyping: boolean }> {
  await ensureMatchAppTables();
  if (seen > 0) {
    await prisma.$executeRaw`INSERT INTO match_anon_state (session_id, user_id, last_read) VALUES (${sessionId}, ${me}, ${seen})
      ON CONFLICT (session_id, user_id) DO UPDATE SET last_read = GREATEST(match_anon_state.last_read, EXCLUDED.last_read)`;
  }
  const rows = await prisma.$queryRaw<{ last_read: bigint; typing_at: Date | null }[]>`SELECT last_read, typing_at FROM match_anon_state WHERE session_id = ${sessionId} AND user_id = ${partner}`;
  const r = rows[0];
  return { partnerRead: Number(r?.last_read ?? 0), partnerTyping: !!r?.typing_at && Date.now() - r.typing_at.getTime() < 8000 };
}
/** Marks me as typing in my current real session (no-op otherwise). */
export async function anonTyping(me: string): Promise<void> {
  const p = await pendingOf(me);
  if (p?.mode !== "random_chatting" || !p.sessionId) return;
  await ensureMatchAppTables();
  await prisma.$executeRaw`INSERT INTO match_anon_state (session_id, user_id, typing_at) VALUES (${p.sessionId}, ${me}, now())
    ON CONFLICT (session_id, user_id) DO UPDATE SET typing_at = now()`;
}


/** A voice note in the anonymous chat: only between two people who are both in the app (the partner's Telegram cannot play it), at most 30 s. */
export async function anonVoiceSend(me: string, mime: string, dur: number, b64: string): Promise<{ ok: boolean; error?: string }> {
  const p = await pendingOf(me);
  await touchAppPresence(me);
  if (p?.mode !== "random_chatting" || !p.sessionId || !p.partnerId) return { ok: false, error: "الرسائل الصوتية مع شريك حقيقي فقط" };
  if (!(await isAppActive(p.partnerId))) return { ok: false, error: "الطرف الآخر ليس في التطبيق الآن، أرسل رسالة نصية" };
  const v = await saveVoice(p.sessionId, me, mime, dur, b64);
  if (!v.ok) return v;
  await recordAnonMessage(p.sessionId, me, voiceMarker(v.id, dur));
  await pingAnonSession(p.sessionId);
  return { ok: true };
}
export async function anonVoiceGet(me: string, id: number): Promise<{ ok: boolean; mime?: string; b64?: string; error?: string }> {
  const p = await pendingOf(me);
  if (p?.mode !== "random_chatting" || !p.sessionId) return { ok: false, error: "انتهت المحادثة" };
  const v = await getVoice(id, p.sessionId);
  return v ? { ok: true, mime: v.mime, b64: v.b64 } : { ok: false, error: "الرسالة الصوتية لم تعد متاحة" };
}
