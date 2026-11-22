/**
 * «📅 بطاقة اليوم» for the Athar bot: a Bot API 10.4 widget (private chat only) that shows one calendar day of Athar, which of its three kinds
 * (normal / silver / gold) are still free, and lets the viewer step through days with ◀ ▶ — no leaving the chat.
 *
 * READ-ONLY by design (owner's order 2026-11-22 for the Athar bot, never payments): it reads the same public date data the mini apps use
 * (`atharDay`), buys nothing, signs nothing and never touches a contract or a wallet. "Open this day" just opens Athar's own page.
 *
 * Flow: sendWidget(html, chat_data = the day's state) → the tap calls TelegramWidget.request("n:YYYY-MM-DD:±1") → `widget_query` update →
 * handleAtharWidgetQuery answers with the new state (answerWidgetQuery) and refreshes the bubble (editMessageWidgetData).
 * Limits (Bot API): html ≤ 32768 B (≤ 4096 compressed), chat_data ≤ 1024 B, request ≤ 64 B, answer ≤ 1024 B; no network inside the widget.
 * When Telegram refuses the widget (not rolled out for this bot) the caller falls back to a plain message with a button.
 */
import type { Bot as TelegramBot } from "grammy";
import { rawCall } from "@/lib/telegramRaw";
import { atharDay, atharDateLink, dayKeyOf, parseYmd, ymdOf, type Ymd } from "@/lib/atharDay";

export const ATHAR_WIDGET_CAPTION = "📅 بطاقة يوم من أثر: تنقّل بين الأيام واعرف أيّ أنواعه ما زال متاحًا.";
const REQUEST_RE = /^n:(\d{4}-\d{2}-\d{2}):(-1|\+1|T)$/; // T = jump back to today

/** Next day / previous day / same day, inside Athar's range (1950–2049); out of range stays on the same day. Pure. */
export function stepDay(x: Ymd, delta: -1 | 0 | 1): Ymd {
  if (delta === 0) return x;
  const d = new Date(Date.UTC(x.y, x.m - 1, x.d + delta));
  const n = ymdOf(d);
  return n.y < 1950 || n.y > 2049 ? x : n;
}

type DayLike = { label: string; link: string; kinds: { name: string; free: boolean | null }[]; anyFree: boolean | null };

/** The state kept in the bubble: { d: day key, l: label, k: [free flags 1/0/-1 for normal, silver, gold], u: Athar page of the day }. ≤ 1024 bytes. Pure. */
export function dayState(x: Ymd, day: DayLike | null): string {
  const key = dayKeyOf(x);
  if (!day) return JSON.stringify({ d: key, l: key, k: [-1, -1, -1], u: "" });
  const k = day.kinds.map((e) => (e.free === null ? -1 : e.free ? 1 : 0));
  return JSON.stringify({ d: key, l: day.label, k, u: day.link });
}

/** The widget page: renders from chat_data, buttons ◀ ▶ and «اليوم» ask the bot for another day, «افتح اليوم» opens Athar. Pure. */
export function atharWidgetHtml(): string {
  return `<style>
body{margin:0;font:15px system-ui,sans-serif;direction:rtl;text-align:center;padding:10px 12px}
.d{font-size:20px;font-weight:700;margin:4px 0 2px}.s{font-size:12px;opacity:.7;margin-bottom:8px}
.k{display:flex;justify-content:center;gap:8px;margin:8px 0}
.k span{flex:1;border-radius:10px;padding:8px 4px;background:rgba(128,128,128,.15)}
.k b{display:block;font-size:12px;opacity:.8}.f{color:#16a34a}.t{color:#dc2626}.u{opacity:.6}
.b{display:flex;gap:8px;margin-top:8px}
button{flex:1;border:0;border-radius:10px;padding:9px 6px;background:#7c3aed;color:#fff;font:inherit}
button.g{background:rgba(128,128,128,.25);color:inherit}
#m{font-size:12px;color:#dc2626;min-height:15px;margin-top:4px}
</style><div class="d" id="d"></div><div class="s" id="s"></div><div class="k" id="k"></div>
<div class="b"><button class="g" id="p">◀</button><button class="g" id="t">اليوم</button><button class="g" id="n">▶</button></div>
<div class="b"><button id="o">افتح هذا اليوم في أثر</button></div><div id="m"></div>
<script>
var W=window.TelegramWidget,N=["عادي","فضي","ذهبي"],ov=null,busy=false;
function st(){if(ov)return ov;try{return JSON.parse(W.chatData||"{}")}catch(e){return{}}}
function render(){
 var s=st(),k=s.k||[-1,-1,-1],h="";
 document.getElementById("d").textContent=s.l||"";
 var any=false,known=k[0]!==-1;for(var i=0;i<3;i++)if(k[i]===1)any=true;
 document.getElementById("s").textContent=known?(any?"فيه أنواع متاحة":"كل أنواعه مأخوذة"):"تعذّر قراءة الحالة الآن";
 for(var j=0;j<3;j++)h+='<span><b>'+N[j]+'</b>'+(k[j]===1?'<i class="f">متاح</i>':k[j]===0?'<i class="t">مأخوذ</i>':'<i class="u">؟</i>')+'</span>';
 document.getElementById("k").innerHTML=h;
}
function go(dl){
 if(busy)return;busy=true;document.getElementById("m").textContent="";
 var s=st();
 W.request("n:"+(s.d||"")+":"+dl).then(function(a){busy=false;try{ov=JSON.parse(a.result)}catch(e){}render()},
  function(er){busy=false;document.getElementById("m").textContent=er.code==="RATE_LIMITED"?"مهلاً، حاول بعد لحظات":"تعذّر التحديث، أعد المحاولة"});
}
document.getElementById("p").addEventListener("click",function(){go("-1")});
document.getElementById("n").addEventListener("click",function(){go("+1")});
document.getElementById("t").addEventListener("click",function(){go("T")});
document.getElementById("o").addEventListener("click",function(){var u=st().u;if(u)W.openLink(u)});
W.onEvent("chatDataChanged",function(){ov=null;render()});
render();
</script>`;
}

/** State for the day containing `now`, or for the given day. Never throws (a read failure gives «unknown» kinds). */
export async function stateForDay(x: Ymd): Promise<string> {
  let day: Awaited<ReturnType<typeof atharDay>> = null;
  try { day = await atharDay(x); } catch { day = null; }
  return dayState(x, day);
}

/** Sends the widget in a private chat. Returns null on success, or Telegram's own refusal text (never throws). */
export async function sendAtharWidget(bot: TelegramBot, chatId: number, now = new Date()): Promise<string | null> {
  const state = await stateForDay(ymdOf(now));
  try {
    await rawCall(bot, "sendWidget", { chat_id: chatId, html: atharWidgetHtml(), width: 340, height: 250, chat_data: state, caption: ATHAR_WIDGET_CAPTION, allow_queries: true });
    return null;
  } catch (e) {
    return String((e as { description?: string; message?: string })?.description || (e as Error)?.message || "unknown error").slice(0, 300);
  }
}

/** The plain fallback when widgets are refused: the day as text with its link (so the command always gives the user something). */
export async function dayFallbackText(now = new Date()): Promise<{ text: string; link: string | null }> {
  const x = ymdOf(now);
  const day = await atharDay(x).catch(() => null);
  if (!day) return { text: `📅 ${dayKeyOf(x)}`, link: atharDateLink(x) };
  const kinds = day.kinds.map((k) => `${k.name}: ${k.free === null ? "؟" : k.free ? "متاح" : "مأخوذ"}`).join(" · ");
  return { text: `📅 ${day.label}\n${kinds}`, link: day.link };
}

/** A `widget_query` update of the Athar bot. Always answers (the widget waits 15 s), never throws. Read-only. */
export async function handleAtharWidgetQuery(bot: TelegramBot, wq: any): Promise<void> {
  const answer = (data?: string) => rawCall(bot, "answerWidgetQuery", { widget_query_id: String(wq?.id || ""), ...(data ? { data } : {}) }).catch(() => null);
  try {
    const m = REQUEST_RE.exec(String(wq?.data || ""));
    const cur = m ? parseYmd(m[1]) : null;
    if (!m || !cur) { await answer(); return; }
    const state = await stateForDay(m[2] === "T" ? ymdOf(new Date()) : stepDay(cur, m[2] === "-1" ? -1 : 1));
    await answer(state);
    if (wq.chat?.id && wq.message_id) await rawCall(bot, "editMessageWidgetData", { chat_id: wq.chat.id, message_id: wq.message_id, chat_data: state }).catch(() => null);
  } catch {
    await answer();
  }
}
