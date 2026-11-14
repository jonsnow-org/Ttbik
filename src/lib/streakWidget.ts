/**
 * «🧩 لوحة سلاسلي» — the inline board that always works (boardText/handleBoardTap), plus an experimental Bot API 10.4 widget (2026-11-09) for the chains bot (STREAK_BOT, @Slaselbot): the four daily chains with a
 * «سجّلت اليوم» button right inside the chat bubble. Private chats only (production restriction of widgets).
 *
 * Flow: sendWidget(html, chat_data = the chains state) → the tap calls TelegramWidget.request("ci:<category>") → the bot receives
 * a `widget_query` update, runs the same checkInCore as the chat and the Mini App, and answers with the new state within 15 s
 * (answerWidgetQuery), then also refreshes the message's chat_data (editMessageWidgetData). No network inside the widget, nothing
 * paid, no new table. Limits: html ≤ 32768 bytes (≤ 4096 compressed), chat_data ≤ 1024 bytes, request data ≤ 64 bytes, answer ≤ 1024 bytes.
 */
import type { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { rawCall } from "@/lib/telegramRaw";
import { STREAK_CATEGORIES, checkInCore, ensureStreakUser, todayKey, yesterdayKey } from "@/lib/streakBotLogic";
import { InlineKeyboard } from "grammy";

export const WIDGET_BUTTON = "🧩 لوحة سلاسلي";
export const WIDGET_CAPTION = "🧩 لوحة سلاسلك التفاعلية: سجّل يومك بضغطة واحدة.\nإن لم تظهر اللوحة حدّث تيليجرام، أو استخدم «🧩 لوحة سلاسلي» من القائمة.";
export const BOARD_PREFIX = "sk|";
const REQUEST_RE = /^ci:([a-z]{2,12})$/;

type EntryLike = { category: string; currentStreak: number; lastCheckInDate: string | null };

/** State kept in the message: { <category>: [currentStreak, lastCheckInDay (UTC days since epoch)] }. Compact (≤ 1024 bytes). Pure. */
export function widgetState(entries: EntryLike[]): string {
  const out: Record<string, [number, number]> = {};
  for (const c of STREAK_CATEGORIES) {
    const e = entries.find((x) => x.category === c.id);
    const day = e?.lastCheckInDate ? Math.floor(Date.parse(e.lastCheckInDate) / 86_400_000) : -9;
    out[c.id] = [e?.currentStreak || 0, Number.isFinite(day) ? day : -9];
  }
  return JSON.stringify(out);
}

/** The widget page. The date logic runs in the widget (UTC day), so an old bubble never shows yesterday's «done». Pure. */
export function widgetHtml(): string {
  const cats = JSON.stringify(STREAK_CATEGORIES.map((c) => [c.id, c.emoji, c.title]));
  return `<style>
body{margin:0;font:15px system-ui,sans-serif;direction:rtl}
.r{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid rgba(128,128,128,.25)}
.e{font-size:22px}.t{flex:1}.n{font-weight:700}.s{font-size:12px;opacity:.7}
button{border:0;border-radius:10px;padding:8px 12px;background:#2563eb;color:#fff;font:inherit}
button[disabled]{background:#16a34a;opacity:.9}
#m{padding:6px 12px;font-size:12px;color:#dc2626;min-height:16px}
</style><div id="l"></div><div id="m"></div>
<script>
var C=${cats},W=window.TelegramWidget,busy=false,ov=null;
function st(){if(ov)return ov;try{return JSON.parse(W.chatData||"{}")}catch(e){return{}}}
function day(){return Math.floor(Date.now()/864e5)}
function render(){
 var s=st(),t=day(),h="";
 for(var i=0;i<C.length;i++){
  var v=s[C[i][0]]||[0,-9],alive=v[1]>=t-1,n=alive?v[0]:0,done=v[1]===t;
  h+='<div class="r"><span class="e">'+C[i][1]+'</span><span class="t"><div class="n">'+C[i][2]+'</div><div class="s">🔥 '+n+' يوم</div></span>'+
   '<button data-c="'+C[i][0]+'"'+(done?' disabled>✅ تم اليوم':'>سجّلت اليوم')+'</button></div>';
 }
 document.getElementById("l").innerHTML=h;
 var b=document.querySelectorAll("button");
 for(var j=0;j<b.length;j++)b[j].addEventListener("click",go);
}
function go(ev){
 if(busy)return;busy=true;
 var id=ev.currentTarget.getAttribute("data-c");
 document.getElementById("m").textContent="";
 W.request("ci:"+id).then(function(a){
  busy=false;
  try{ov=JSON.parse(a.result)}catch(e){}
  render();
 },function(er){
  busy=false;
  document.getElementById("m").textContent=er.code==="RATE_LIMITED"?"مهلاً، حاول بعد لحظات":"تعذّر التسجيل، جرّب «سجلت اليوم» من القائمة";
  render();
 });
}
W.onEvent("chatDataChanged",function(){ov=null;render()});
render();
</script>`;
}

async function stateFor(userId: string): Promise<string> {
  const entries = await prisma.streakEntry.findMany({ where: { userId }, select: { category: true, currentStreak: true, lastCheckInDate: true } });
  return widgetState(entries);
}

/** Sends the widget in a private chat. Returns null on success, or Telegram's own refusal text (never throws). */
export async function sendStreakWidget(bot: TelegramBot, chatId: number, userId: string): Promise<string | null> {
  const state = await stateFor(userId);
  try {
    await rawCall(bot, "sendWidget", { chat_id: chatId, html: widgetHtml(), width: 360, height: 232, chat_data: state, caption: WIDGET_CAPTION, allow_queries: true });
    return null;
  } catch (e) {
    return String((e as { description?: string; message?: string })?.description || (e as Error)?.message || "unknown error").slice(0, 300);
  }
}

/** Owner-only diagnosis of «INPUT_MEDIA_WIDGET_NOT_ALLOWED»: sends four widgets from the smallest to the full one and reports the first that Telegram refuses.
 *  If the smallest is refused the bot itself is not allowed; if only a later one is, the refused parameter is the cause. Returns report lines. */
export async function probeWidgets(bot: TelegramBot, chatId: number, userId: string): Promise<string[]> {
  const state = await stateFor(userId);
  const steps: [string, Record<string, unknown>][] = [
    ["1) html فقط", { html: "<b>1</b>" }],
    ["2) + width/height", { html: "<b>2</b>", width: 300, height: 80 }],
    ["3) + chat_data", { html: "<b>3</b>", width: 300, height: 80, chat_data: state }],
    ["4) + allow_queries", { html: "<b>4</b>", width: 300, height: 80, chat_data: state, allow_queries: true }],
  ];
  const out: string[] = [];
  for (const [name, params] of steps) {
    try {
      await rawCall(bot, "sendWidget", { chat_id: chatId, ...params });
      out.push(`✅ ${name}`);
    } catch (e) {
      out.push(`❌ ${name}: ${String((e as { description?: string; message?: string })?.description || (e as Error)?.message || "?").slice(0, 120)}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// «🧩 لوحة سلاسلي» — the board that always works: one message, one button per chain (inline callbacks, no widget needed).
// ---------------------------------------------------------------------
/** Streak shown to the user: a chain that missed yesterday and today is broken (0), even though the row keeps its old number until the next check-in. Pure. */
export function shownStreak(e: { currentStreak: number; lastCheckInDate: string | null } | undefined, today = todayKey(), yesterday = yesterdayKey()): number {
  if (!e || (e.lastCheckInDate !== today && e.lastCheckInDate !== yesterday)) return 0;
  return e.currentStreak;
}

export function boardText(entries: EntryLike[], today = todayKey(), yesterday = yesterdayKey()): string {
  const lines = STREAK_CATEGORIES.map((c) => {
    const e = entries.find((x) => x.category === c.id);
    const done = e?.lastCheckInDate === today;
    return `${c.emoji} ${c.title} — 🔥 ${shownStreak(e, today, yesterday)} يوم${done ? "  ✅ سجّلت اليوم" : ""}`;
  });
  return `🧩 لوحة سلاسلك\n\n${lines.join("\n")}\n\nاضغط على التصنيف لتسجيل يومك.`;
}

export function boardKeyboard(entries: EntryLike[], today = todayKey()): InlineKeyboard {
  const kb = new InlineKeyboard();
  STREAK_CATEGORIES.forEach((c, i) => {
    const done = entries.find((x) => x.category === c.id)?.lastCheckInDate === today;
    kb.text(done ? `✅ ${c.emoji} ${c.title}` : `${c.emoji} سجّل ${c.title}`, `${BOARD_PREFIX}${c.id}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

async function entriesFor(userId: string): Promise<EntryLike[]> {
  return prisma.streakEntry.findMany({ where: { userId }, select: { category: true, currentStreak: true, lastCheckInDate: true } });
}

export async function sendBoard(bot: TelegramBot, chatId: number, userId: string): Promise<void> {
  const entries = await entriesFor(userId);
  await bot.api.sendMessage(chatId, boardText(entries), { reply_markup: boardKeyboard(entries) });
}

/** A tap on a board button (`sk|<category>`): the same checkInCore as the chat and the Mini App, then the board is redrawn in place. */
export async function handleBoardTap(bot: TelegramBot, botRow: BotRow, cq: any): Promise<boolean> {
  const id = String(cq?.data || "").startsWith(BOARD_PREFIX) ? String(cq.data).slice(BOARD_PREFIX.length) : "";
  if (!id) return false;
  const toast = (text: string) => bot.api.answerCallbackQuery(cq.id, { text }).catch(() => null);
  const userId = String(cq.from?.id || "");
  if (!userId || !STREAK_CATEGORIES.some((c) => c.id === id)) { await toast("خيار غير معروف."); return true; }
  const user = await ensureStreakUser(botRow.id, userId);
  if (user.isBanned || (user.mutedUntil && user.mutedUntil > new Date())) { await toast("غير متاح لك الآن."); return true; }
  const r = await checkInCore(botRow.id, userId, id);
  await toast(r.already ? "✅ سجّلت اليوم بالفعل، عد غداً" : `${r.continued ? "🔥" : "🌱"} تم التسجيل! سلسلتك ${r.entry.currentStreak} يوم`);
  const entries = await entriesFor(userId);
  const chat = cq.message?.chat?.id, mid = cq.message?.message_id;
  if (chat && mid) await bot.api.editMessageText(chat, mid, boardText(entries), { reply_markup: boardKeyboard(entries) }).catch(() => null); // "message is not modified" on a repeat tap is fine
  return true;
}

/** A `widget_query` update of this bot. Always answers (the widget waits 15 s), never throws. */
export async function handleStreakWidgetQuery(bot: TelegramBot, botRow: BotRow, wq: any): Promise<void> {
  const answer = (data?: string) => rawCall(bot, "answerWidgetQuery", { widget_query_id: String(wq?.id || ""), ...(data ? { data } : {}) }).catch(() => null);
  try {
    const userId = String(wq?.from?.id || "");
    const m = REQUEST_RE.exec(String(wq?.data || ""));
    if (!userId || !m || !STREAK_CATEGORIES.some((c) => c.id === m[1])) { await answer(); return; }
    const user = await ensureStreakUser(botRow.id, userId);
    if (user.isBanned || (user.mutedUntil && user.mutedUntil > new Date())) { await answer(); return; }
    await checkInCore(botRow.id, userId, m[1]);
    const state = await stateFor(userId);
    await answer(state);
    if (wq.chat?.id && wq.message_id) await rawCall(bot, "editMessageWidgetData", { chat_id: wq.chat.id, message_id: wq.message_id, chat_data: state }).catch(() => null);
  } catch {
    await answer();
  }
}
