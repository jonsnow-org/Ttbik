// 💸 مكتب الحوالات inside the site bot (owner, 2026-11-10): a guided transfer in the chat. Send or receive, countries, what you pay with,
// amount → a live quote of what the recipient gets, recipient wallet (saved for next time) → a «حوالة» with a tracking number, and status
// pushes (waiting → received → exchanging → sent → done). Executed by ChangeNOW's partner API, so the platform earns its partner fee on
// every transfer. The platform never receives or holds money: the sender pays ChangeNOW's pay-in address, ChangeNOW pays the recipient.
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { coinById, createExchange, estimate, exchangeStatus, FINAL, minAmount, PAY_COINS, RECEIVE, STATUS_AR, TRON_ADDRESS, type Coin } from "@/lib/remit/changenow";
import { savedRefLinks } from "@/lib/remit/refLinks";

export const OFFICE_BUTTON = "💸 حوالات USDT";
export const TO_COUNTRIES = [["sy", "🇸🇾 سوريا"], ["tr", "🇹🇷 تركيا"], ["lb", "🇱🇧 لبنان"], ["iq", "🇮🇶 العراق"], ["eg", "🇪🇬 مصر"], ["jo", "🇯🇴 الأردن"], ["ye", "🇾🇪 اليمن"], ["xx", "🌍 بلد آخر"]] as const;
export const FROM_COUNTRIES = [["tr", "🇹🇷 تركيا"], ["de", "🇩🇪 ألمانيا"], ["sa", "🇸🇦 السعودية"], ["ae", "🇦🇪 الإمارات"], ["qa", "🇶🇦 قطر"], ["kw", "🇰🇼 الكويت"], ["se", "🇸🇪 السويد"], ["nl", "🇳🇱 هولندا"], ["xx", "🌍 بلد آخر"]] as const;
const countryName = (list: readonly (readonly [string, string])[], id?: string) => list.find((c) => c[0] === id)?.[1] || "🌍";

export type Draft = { step: "to" | "from" | "coin" | "amount" | "addr" | "name" | "confirm"; to?: string; from?: string; coin?: string; amount?: number; quote?: number; addr?: string; name?: string; recv?: boolean };
export type Ctx = { token: string; site: string; botUsername?: string };

/** The partner API key: env first, then the platform's setting (/ref CHANGENOW_API <key>). */
export async function apiKey(): Promise<string | null> {
  const env = (process.env.CHANGENOW_API_KEY || "").trim();
  if (env) return env;
  const saved = await savedRefLinks().catch(() => ({} as Record<string, string>));
  return (saved.CHANGENOW_API || "").trim() || null;
}

// ---------- pure helpers (tested) ----------
export function parseAmount(text: string): number | null {
  const s = String(text || "").trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, ".").replace(/,/g, ".").replace(/\s|\$/g, "");
  if (!/^\d{1,9}(\.\d{1,8})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}
export function newTrack(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.randomBytes(10);
  let t = "";
  for (let i = 0; i < 10; i++) t += a[b[i] % a.length];
  return `HW-${t}`;
}
export function fmt(n: number, max = 6): string {
  return Number(n.toFixed(max)).toString();
}
export function receiptText(t: { track: string; from_country: string | null; to_country: string | null; from_amount: number; coin: string; to_amount: number; address: string; recipient: string | null; status: string; created_at?: Date }, site: string): string {
  const c = coinById(t.coin);
  return [
    `🧾 حوالة ${t.track}`,
    `${countryName(FROM_COUNTRIES, t.from_country || undefined)} ← ${countryName(TO_COUNTRIES, t.to_country || undefined)}`,
    `المرسَل: ${fmt(t.from_amount)} ${c?.label || t.coin}`,
    `يصل للمستلم: ≈ ${fmt(t.to_amount, 2)} ${RECEIVE.label}`,
    `المستلم: ${t.recipient ? `${t.recipient} · ` : ""}${t.address.slice(0, 6)}…${t.address.slice(-4)}`,
    `الحالة: ${STATUS_AR[t.status] || t.status}`,
    `${site.replace(/\/$/, "")}/remit/r/${t.track}`,
  ].join("\n");
}
export function parseCallback(data: string): { a: string; v: string } | null {
  const m = /^ro:([a-z]{1,8})(?::(.{0,56}))?$/.exec(String(data || ""));
  return m ? { a: m[1], v: m[2] || "" } : null;
}

// ---------- storage ----------
let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS remit_office_state (chat_id TEXT PRIMARY KEY, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS remit_transfers (track TEXT PRIMARY KEY, chat_id TEXT NOT NULL, cn_id TEXT UNIQUE NOT NULL, coin TEXT NOT NULL, from_amount DOUBLE PRECISION NOT NULL, to_amount DOUBLE PRECISION NOT NULL, address TEXT NOT NULL, recipient TEXT, from_country TEXT, to_country TEXT, status TEXT NOT NULL DEFAULT 'waiting', payin TEXT NOT NULL, payin_extra TEXT, payout_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS remit_transfers_chat ON remit_transfers (chat_id, created_at DESC)`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS remit_recipients (chat_id TEXT NOT NULL, address TEXT NOT NULL, name TEXT, used_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (chat_id, address))`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
async function getDraft(chatId: string): Promise<Draft | null> {
  await ensure();
  const r = await prisma.$queryRaw<{ state: Draft }[]>`SELECT state FROM remit_office_state WHERE chat_id = ${chatId} AND updated_at > now() - interval '2 hours'`;
  return r[0]?.state || null;
}
async function setDraft(chatId: string, d: Draft | null): Promise<void> {
  await ensure();
  if (!d) await prisma.$executeRaw`DELETE FROM remit_office_state WHERE chat_id = ${chatId}`;
  else await prisma.$executeRaw`INSERT INTO remit_office_state (chat_id, state) VALUES (${chatId}, ${JSON.stringify(d)}::jsonb) ON CONFLICT (chat_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`;
}
export type Transfer = { track: string; chat_id: string; cn_id: string; coin: string; from_amount: number; to_amount: number; address: string; recipient: string | null; from_country: string | null; to_country: string | null; status: string; payin: string; payin_extra: string | null; payout_hash: string | null; created_at: Date };
export async function transferByTrack(track: string): Promise<Transfer | null> {
  await ensure();
  const r = await prisma.$queryRaw<Transfer[]>`SELECT * FROM remit_transfers WHERE track = ${track}`;
  return r[0] || null;
}
async function recipients(chatId: string) {
  await ensure();
  return prisma.$queryRaw<{ address: string; name: string | null }[]>`SELECT address, name FROM remit_recipients WHERE chat_id = ${chatId} ORDER BY used_at DESC LIMIT 8`;
}

// ---------- telegram ----------
type Kb = { text: string; callback_data?: string; url?: string; web_app?: { url: string } }[][];
async function tg(ctx: Ctx, method: string, body: Record<string, unknown>) {
  await fetch(`https://api.telegram.org/bot${ctx.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
}
const say = (ctx: Ctx, chatId: string, text: string, kb?: Kb) => tg(ctx, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) });
const grid = (items: readonly (readonly [string, string])[], prefix: string, per = 2): Kb => {
  const rows: Kb = [];
  items.forEach(([id, label], i) => { if (i % per === 0) rows.push([]); rows[rows.length - 1].push({ text: label, callback_data: `ro:${prefix}:${id}` }); });
  return rows;
};

export async function officeMenu(ctx: Ctx, chatId: string): Promise<void> {
  await setDraft(chatId, null);
  const key = await apiKey();
  const kb: Kb = [
    [{ text: "📤 إرسال حوالة", callback_data: "ro:send" }, { text: "📥 استلام حوالة", callback_data: "ro:recv" }],
    [{ text: "📜 حوالاتي", callback_data: "ro:hist" }, { text: "🔁 كرّر آخر حوالة", callback_data: "ro:again" }],
    [{ text: "👥 المستلمون المحفوظون", callback_data: "ro:book" }],
    [{ text: "🌐 نافذة التبديل", web_app: { url: `${ctx.site.replace(/\/$/, "")}/remit?bot=site&src=tg` } }],
  ];
  await say(ctx, chatId, key
    ? "💸 مكتب الحوالات\nأرسل لأهلك USDT (TRC20) خلال دقائق، تدفع من محفظتك بأي عملة رقمية، ويصل للمستلم مباشرة. المنصة لا تستلم أموالك ولا تحتفظ بها."
    : "💸 مكتب الحوالات\nالإرسال من المحادثة يُفعَّل قريباً. يمكنك الآن التبديل من نافذة التبديل.", key ? kb : kb.slice(3));
}

async function askCoin(ctx: Ctx, chatId: string) {
  await say(ctx, chatId, "💳 بماذا ستدفع؟", grid(PAY_COINS.map((c) => [c.id, c.label] as const), "coin"));
}
async function askAddress(ctx: Ctx, chatId: string) {
  const book = await recipients(chatId);
  const kb: Kb = book.map((r) => [{ text: `👤 ${r.name || `${r.address.slice(0, 6)}…${r.address.slice(-4)}`}`, callback_data: `ro:to:${r.address}` }]);
  await say(ctx, chatId, "👛 أرسل عنوان محفظة المستلم على شبكة TRC20 (يبدأ بحرف T)" + (book.length ? "، أو اختر مستلماً محفوظاً:" : ":"), kb.length ? kb : undefined);
}
async function showConfirm(ctx: Ctx, chatId: string, d: Draft) {
  const c = coinById(d.coin || "")!;
  await say(ctx, chatId, [
    "📋 راجع الحوالة:",
    `${countryName(FROM_COUNTRIES, d.from)} ← ${countryName(TO_COUNTRIES, d.to)}`,
    `تدفع: ${fmt(d.amount || 0)} ${c.label}`,
    `يصل للمستلم: ≈ ${fmt(d.quote || 0, 2)} ${RECEIVE.label}`,
    `المستلم: ${d.name ? `${d.name} · ` : ""}${d.addr}`,
    "",
    "السعر تقديري ويُثبَّت لحظة وصول دفعتك. تأكد من العنوان: التحويل لعنوان خاطئ لا يُسترد.",
  ].join("\n"), [[{ text: "✅ تأكيد وإنشاء الحوالة", callback_data: "ro:ok" }], [{ text: "✏️ تعديل المبلغ", callback_data: "ro:amt" }, { text: "✖️ إلغاء", callback_data: "ro:menu" }]]);
}

async function quote(ctx: Ctx, chatId: string, d: Draft, key: string): Promise<boolean> {
  const c = coinById(d.coin || "")!;
  const min = await minAmount(c);
  if (min && (d.amount || 0) < min) {
    await say(ctx, chatId, `⚠️ أقل مبلغ لهذه العملة الآن ${fmt(min)} ${c.label}. اكتب مبلغاً أكبر:`);
    return false;
  }
  try {
    const q = await estimate(key, c, d.amount || 0);
    d.quote = q.toAmount;
    return true;
  } catch {
    await say(ctx, chatId, "⚠️ تعذّر حساب السعر الآن. جرّب مبلغاً آخر أو بعد قليل:");
    return false;
  }
}

/** The bot's /start payload pay_<TRC20 address>: a recipient's "send me" link pre-fills the address. */
export async function officeStart(ctx: Ctx, chatId: string, payload: string): Promise<boolean> {
  const m = /^pay_(T[1-9A-HJ-NP-Za-km-z]{33})$/.exec(payload);
  if (!m) return false;
  if (!(await apiKey())) { await officeMenu(ctx, chatId); return true; }
  await setDraft(chatId, { step: "to", addr: m[1] });
  await say(ctx, chatId, "📤 إرسال حوالة لهذا المستلم\n🌍 إلى أي بلد؟", grid(TO_COUNTRIES, "dst"));
  return true;
}

/** Text typed while a transfer is being filled in. Returns false when the office is not waiting for text. */
export async function officeText(ctx: Ctx, chatId: string, text: string): Promise<boolean> {
  if (text === OFFICE_BUTTON || /^\/remit(@\w+)?$/i.test(text)) { await officeMenu(ctx, chatId); return true; }
  const d = await getDraft(chatId).catch(() => null);
  if (!d || !["amount", "addr", "name"].includes(d.step)) return false;
  const key = await apiKey();
  if (!key) { await officeMenu(ctx, chatId); return true; }
  if (d.step === "amount") {
    const n = parseAmount(text);
    if (!n) { await say(ctx, chatId, "اكتب المبلغ بالأرقام فقط، مثل 100 أو 0.005"); return true; }
    d.amount = n;
    if (!(await quote(ctx, chatId, d, key))) { await setDraft(chatId, d); return true; }
    if (d.addr) { d.step = "confirm"; await setDraft(chatId, d); await showConfirm(ctx, chatId, d); return true; }
    d.step = "addr";
    await setDraft(chatId, d);
    await say(ctx, chatId, `💡 المستلم يحصل على ≈ ${fmt(d.quote || 0, 2)} ${RECEIVE.label}`);
    await askAddress(ctx, chatId);
    return true;
  }
  if (d.step === "addr") {
    const a = text.trim();
    if (!TRON_ADDRESS.test(a)) { await say(ctx, chatId, "⚠️ هذا ليس عنوان TRC20. العنوان يبدأ بحرف T وطوله 34 حرفاً. أرسله مرة أخرى:"); return true; }
    if (d.recv) {
      await setDraft(chatId, null);
      const link = ctx.botUsername ? `https://t.me/${ctx.botUsername}?start=pay_${a}` : "";
      await say(ctx, chatId, link ? `✅ رابط الاستلام الخاص بك، أرسله لمن سيحوّل لك:\n${link}` : `✅ أعطِ المرسل عنوانك:\n${a}`, link ? [[{ text: "📤 مشاركة الرابط", url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("أرسل لي حوالة USDT من هنا:")}` }]] : undefined);
      return true;
    }
    d.addr = a;
    d.step = "name";
    await setDraft(chatId, d);
    await say(ctx, chatId, "✍️ اسم المستلم (للحفظ فقط، مثل «أمي»)؟", [[{ text: "تخطّي", callback_data: "ro:noname" }]]);
    return true;
  }
  d.name = text.trim().slice(0, 30);
  d.step = "confirm";
  await setDraft(chatId, d);
  await showConfirm(ctx, chatId, d);
  return true;
}

/** Inline buttons `ro:*`. Returns false for any other callback. */
export async function officeCallback(ctx: Ctx, chatId: string, data: string): Promise<boolean> {
  const cb = parseCallback(data);
  if (!cb) return false;
  const key = await apiKey();
  const d: Draft = (await getDraft(chatId).catch(() => null)) || { step: "to" };
  switch (cb.a) {
    case "menu": await officeMenu(ctx, chatId); return true;
    case "send":
      if (!key) { await officeMenu(ctx, chatId); return true; }
      await setDraft(chatId, { step: "to" });
      await say(ctx, chatId, "🌍 إلى أي بلد ترسل؟", grid(TO_COUNTRIES, "dst"));
      return true;
    case "dst":
      d.to = cb.v; d.step = "from"; await setDraft(chatId, d);
      await say(ctx, chatId, "📍 من أي بلد ترسل؟", grid(FROM_COUNTRIES, "src", 3));
      return true;
    case "src":
      d.from = cb.v; d.step = "coin"; await setDraft(chatId, d);
      await askCoin(ctx, chatId);
      return true;
    case "coin": {
      const c = coinById(cb.v);
      if (!c) return true;
      d.coin = c.id; d.step = "amount"; await setDraft(chatId, d);
      const min = await minAmount(c);
      await say(ctx, chatId, `🔢 كم ${c.label} سترسل؟${min ? `\n(الحد الأدنى الآن ${fmt(min)})` : ""}`);
      return true;
    }
    case "amt": d.step = "amount"; await setDraft(chatId, d); await say(ctx, chatId, "🔢 اكتب المبلغ الجديد:"); return true;
    case "to":
      if (!TRON_ADDRESS.test(cb.v)) return true;
      d.addr = cb.v;
      d.name = (await recipients(chatId)).find((r) => r.address === cb.v)?.name || undefined;
      d.step = "confirm"; await setDraft(chatId, d);
      await showConfirm(ctx, chatId, d);
      return true;
    case "noname": d.step = "confirm"; await setDraft(chatId, d); await showConfirm(ctx, chatId, d); return true;
    case "ok": await createTransfer(ctx, chatId, d, key); return true;
    case "recv":
      await setDraft(chatId, { step: "addr", recv: true });
      await say(ctx, chatId, "📥 لاستلام حوالة:\n1) افتح محفظة تدعم USDT على شبكة TRC20 (مثل Trust Wallet) وانسخ عنوانك (يبدأ بحرف T).\n2) أرسله هنا، فأعطيك رابطاً تشاركه مع المرسل يفتح له الحوالة جاهزة لعنوانك.\n3) بعد الوصول تصرف USDT لدى مكتب صرافة أو منصة مرخّصة في بلدك.");
      return true;
    case "hist": await history(ctx, chatId); return true;
    case "rc": {
      const t = await transferByTrack(cb.v);
      if (t && t.chat_id === chatId) await say(ctx, chatId, receiptText(t, ctx.site), [[{ text: "🔄 تحديث الحالة", callback_data: `ro:upd:${t.track}` }]]);
      return true;
    }
    case "upd": {
      const t = await transferByTrack(cb.v);
      if (t && t.chat_id === chatId && key) await refresh(ctx, t, key, true);
      return true;
    }
    case "again": {
      await ensure();
      const last = (await prisma.$queryRaw<Transfer[]>`SELECT * FROM remit_transfers WHERE chat_id = ${chatId} ORDER BY created_at DESC LIMIT 1`)[0];
      if (!last || !key) { await say(ctx, chatId, "لا توجد حوالة سابقة بعد.", [[{ text: "📤 إرسال حوالة", callback_data: "ro:send" }]]); return true; }
      const nd: Draft = { step: "amount", to: last.to_country || "xx", from: last.from_country || "xx", coin: last.coin, addr: last.address, name: last.recipient || undefined, amount: last.from_amount };
      if (!(await quote(ctx, chatId, nd, key))) { await setDraft(chatId, nd); return true; }
      nd.step = "confirm"; await setDraft(chatId, nd);
      await showConfirm(ctx, chatId, nd);
      return true;
    }
    case "book": {
      const book = await recipients(chatId);
      if (!book.length) { await say(ctx, chatId, "لا يوجد مستلمون محفوظون بعد. يُحفظ المستلم تلقائياً مع أول حوالة له."); return true; }
      await say(ctx, chatId, "👥 المستلمون المحفوظون (اضغط للإرسال، 🗑 للحذف):", book.map((r) => [{ text: `📤 ${r.name || r.address.slice(0, 8) + "…"}`, callback_data: `ro:to:${r.address}` }, { text: "🗑", callback_data: `ro:del:${r.address}` }]));
      return true;
    }
    case "del":
      await ensure();
      await prisma.$executeRaw`DELETE FROM remit_recipients WHERE chat_id = ${chatId} AND address = ${cb.v}`;
      await say(ctx, chatId, "🗑 حُذف المستلم.");
      return true;
  }
  return true;
}

export type CreatedTransfer = { track: string; coin: Coin; fromAmount: number; toAmount: number; payin: string; payinExtra: string | null };
/**
 * Creates the partner exchange and records the transfer and the recipient (the chat and the Mini App share it). `chatId` is the
 * sender's Telegram chat, i.e. his user id in a private chat. Returns null when the draft is incomplete; throws the partner's error.
 */
export async function createTransferRecord(chatId: string, d: Draft, key: string): Promise<CreatedTransfer | null> {
  const c: Coin | null = coinById(d.coin || "");
  if (!key || !c || !d.amount || !d.addr || !TRON_ADDRESS.test(d.addr)) return null;
  const track = newTrack();
  const ex = await createExchange(key, c, d.amount, d.addr, track);
  await ensure();
  await prisma.$executeRaw`INSERT INTO remit_transfers (track, chat_id, cn_id, coin, from_amount, to_amount, address, recipient, from_country, to_country, payin, payin_extra) VALUES (${track}, ${chatId}, ${ex.id}, ${c.id}, ${ex.fromAmount}, ${ex.toAmount || d.quote || 0}, ${d.addr}, ${d.name || null}, ${d.from || null}, ${d.to || null}, ${ex.payinAddress}, ${ex.payinExtraId})`;
  await prisma.$executeRaw`INSERT INTO remit_recipients (chat_id, address, name) VALUES (${chatId}, ${d.addr}, ${d.name || null}) ON CONFLICT (chat_id, address) DO UPDATE SET used_at = now(), name = COALESCE(EXCLUDED.name, remit_recipients.name)`;
  return { track, coin: c, fromAmount: ex.fromAmount, toAmount: ex.toAmount || d.quote || 0, payin: ex.payinAddress, payinExtra: ex.payinExtraId };
}

async function createTransfer(ctx: Ctx, chatId: string, d: Draft, key: string | null) {
  if (!key) { await officeMenu(ctx, chatId); return; }
  let t: CreatedTransfer | null;
  try {
    t = await createTransferRecord(chatId, d, key);
  } catch (e) {
    await say(ctx, chatId, `⚠️ تعذّر إنشاء الحوالة الآن (${String((e as Error).message || "").slice(0, 80)}). جرّب بعد قليل أو بمبلغ آخر.`, [[{ text: "✏️ تعديل المبلغ", callback_data: "ro:amt" }]]);
    return;
  }
  if (!t) { await officeMenu(ctx, chatId); return; }
  const { track, coin: c } = t;
  await setDraft(chatId, null);
  await say(ctx, chatId, [
    `✅ أُنشئت الحوالة ${track}`,
    "",
    `أرسل الآن بالضبط: ${fmt(t.fromAmount)} ${c.label}`,
    `إلى العنوان:`,
    t.payin,
    ...(t.payinExtra ? ["", `⚠️ مع المذكرة (Memo) إلزامياً: ${t.payinExtra}`] : []),
    "",
    `يصل للمستلم ≈ ${fmt(t.toAmount, 2)} ${RECEIVE.label} خلال دقائق من تأكيد دفعتك. سنبلغك هنا بكل تغيير في الحالة.`,
  ].join("\n"), [[{ text: "🧾 الإيصال", callback_data: `ro:rc:${track}` }, { text: "🔄 تحديث الحالة", callback_data: `ro:upd:${track}` }]]);
}

/** Quote for a draft amount: the partner's live minimum first, then the estimate (chat and Mini App). */
export async function quoteAmount(c: Coin, amount: number, key: string): Promise<{ ok: true; quote: number; min: number | null } | { ok: false; reason: "min" | "quote"; min: number | null }> {
  const min = await minAmount(c);
  if (min && amount < min) return { ok: false, reason: "min", min };
  try {
    const q = await estimate(key, c, amount);
    return { ok: true, quote: q.toAmount, min };
  } catch {
    return { ok: false, reason: "quote", min };
  }
}

/** The sender's last transfers, newest first. */
export async function transfersOf(chatId: string, limit = 10): Promise<Transfer[]> {
  await ensure();
  return prisma.$queryRaw<Transfer[]>`SELECT * FROM remit_transfers WHERE chat_id = ${chatId} ORDER BY created_at DESC LIMIT ${limit}`;
}
export const savedRecipients = (chatId: string) => recipients(chatId);
export async function deleteRecipient(chatId: string, address: string): Promise<void> {
  await ensure();
  await prisma.$executeRaw`DELETE FROM remit_recipients WHERE chat_id = ${chatId} AND address = ${address}`;
}

/** Reads the partner's status and stores a change (compare-and-swap on the old status). null when the partner can't be reached. */
export async function syncTransferStatus(t: Transfer, key: string): Promise<{ changed: boolean; transfer: Transfer; payoutHash: string | null } | null> {
  const s = await exchangeStatus(key, t.cn_id).catch(() => null);
  if (!s) return null;
  const changed = s.status !== t.status;
  if (changed || s.payoutHash !== t.payout_hash) {
    await prisma.$executeRaw`UPDATE remit_transfers SET status = ${s.status}, payout_hash = ${s.payoutHash}, to_amount = COALESCE(${s.amountTo}, to_amount), updated_at = now() WHERE track = ${t.track} AND status = ${t.status}`;
  }
  return { changed, transfer: { ...t, status: s.status, to_amount: s.amountTo || t.to_amount, payout_hash: s.payoutHash }, payoutHash: s.payoutHash };
}

async function history(ctx: Ctx, chatId: string) {
  await ensure();
  const rows = await prisma.$queryRaw<Transfer[]>`SELECT * FROM remit_transfers WHERE chat_id = ${chatId} ORDER BY created_at DESC LIMIT 10`;
  if (!rows.length) { await say(ctx, chatId, "📜 لا توجد حوالات بعد.", [[{ text: "📤 إرسال حوالة", callback_data: "ro:send" }]]); return; }
  await say(ctx, chatId, "📜 آخر حوالاتك:", rows.map((t) => [{ text: `${(STATUS_AR[t.status] || t.status).split(" ")[0]} ${t.track} · ${fmt(t.to_amount, 2)} USDT`, callback_data: `ro:rc:${t.track}` }]));
}

async function refresh(ctx: Ctx, t: Transfer, key: string, reply: boolean): Promise<boolean> {
  const r = await syncTransferStatus(t, key);
  if (!r) { if (reply) await say(ctx, t.chat_id, "تعذّر جلب الحالة الآن، حاول بعد قليل."); return false; }
  const { changed, transfer: fresh } = r;
  if (changed || reply) {
    const extra = fresh.status === "finished" && r.payoutHash ? `\n🔗 https://tronscan.org/#/transaction/${r.payoutHash}` : "";
    await say(ctx, t.chat_id, `${changed ? "🔔 تحديث الحوالة\n" : ""}${receiptText(fresh, ctx.site)}${extra}`);
  }
  return changed;
}

/** Cron: pushes every status change of open transfers to their chats. */
export async function pollTransfers(ctx: Ctx): Promise<{ checked: number; changed: number }> {
  const key = await apiKey();
  if (!key) return { checked: 0, changed: 0 };
  await ensure();
  const open = await prisma.$queryRaw<Transfer[]>`SELECT * FROM remit_transfers WHERE status <> ALL(${FINAL}::text[]) AND created_at > now() - interval '3 days' ORDER BY created_at LIMIT 100`;
  let changed = 0;
  for (const t of open) if (await refresh(ctx, t, key, false).catch(() => false)) changed++;
  return { checked: open.length, changed };
}
