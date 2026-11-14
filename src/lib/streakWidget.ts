/**
 * «🧩 لوحة سلاسلي» — a Bot API 10.4 widget (2026-11-09) for the chains bot (STREAK_BOT, @Slaselbot): the four daily chains with a
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
import { STREAK_CATEGORIES, checkInCore, ensureStreakUser } from "@/lib/streakBotLogic";

export const WIDGET_BUTTON = "🧩 لوحة سلاسلي";
export const WIDGET_CAPTION = "🧩 لوحة سلاسلك: سجّل يومك بضغطة واحدة.\nإن لم تظهر اللوحة حدّث تيليجرام، أو استخدم «📊 كل سلاسلي».";
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

/** Sends the widget in a private chat. Returns false (and sends the plain list instead) when Telegram refuses it. */
export async function sendStreakWidget(bot: TelegramBot, chatId: number, userId: string): Promise<boolean> {
  const state = await stateFor(userId);
  try {
    await rawCall(bot, "sendWidget", { chat_id: chatId, html: widgetHtml(), width: 360, height: 232, chat_data: state, caption: WIDGET_CAPTION, allow_queries: true });
    return true;
  } catch {
    const entries = await prisma.streakEntry.findMany({ where: { userId } });
    const lines = STREAK_CATEGORIES.map((c) => `${c.emoji} ${c.title}: 🔥 ${entries.find((e) => e.category === c.id)?.currentStreak || 0} يوم`).join("\n");
    await bot.api.sendMessage(chatId, `📊 سلاسلك:\n\n${lines}\n\nاختر تصنيفاً من القائمة ثم «✅ سجلت اليوم».`).catch(() => null);
    return false;
  }
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
