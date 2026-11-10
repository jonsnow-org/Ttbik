// ChangeNOW partner API v2 (checked 2026-11-10: /exchange/min-amount answers without a key, estimated-amount and create need
// `x-changenow-api-key`). The API key is the partner attribution: every exchange created with it pays the platform's partner fee.
// Non-custodial: the user sends to ChangeNOW's pay-in address and ChangeNOW pays the recipient's wallet directly.
const API = "https://api.changenow.io/v2";

export type Coin = { id: string; label: string; currency: string; network: string };
/** What the sender can pay with. The recipient always gets USDT on TRON (TRC20): cheapest to cash out locally. */
export const PAY_COINS: Coin[] = [
  { id: "usdtbsc", label: "USDT (BEP20)", currency: "usdt", network: "bsc" },
  { id: "usdterc", label: "USDT (ERC20)", currency: "usdt", network: "eth" },
  { id: "usdtton", label: "USDT (TON)", currency: "usdt", network: "ton" },
  { id: "usdtsol", label: "USDT (Solana)", currency: "usdt", network: "sol" },
  { id: "usdtrx", label: "USDT (TRC20)", currency: "usdt", network: "trx" },
  { id: "btc", label: "Bitcoin", currency: "btc", network: "btc" },
  { id: "eth", label: "Ethereum", currency: "eth", network: "eth" },
  { id: "bnb", label: "BNB", currency: "bnb", network: "bsc" },
  { id: "trx", label: "TRX", currency: "trx", network: "trx" },
  { id: "ton", label: "TON", currency: "ton", network: "ton" },
  { id: "sol", label: "Solana", currency: "sol", network: "sol" },
];
export const RECEIVE = { currency: "usdt", network: "trx", label: "USDT (TRC20)" } as const;
export const coinById = (id: string) => PAY_COINS.find((c) => c.id === id) || null;

export const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export type CnStatus = "new" | "waiting" | "confirming" | "exchanging" | "sending" | "finished" | "failed" | "refunded" | "verifying" | "expired";
export const FINAL: CnStatus[] = ["finished", "failed", "refunded", "expired"];
export const STATUS_AR: Record<string, string> = {
  new: "🕐 بانتظار إرسالك",
  waiting: "🕐 بانتظار إرسالك",
  confirming: "📥 وصل المبلغ، يُؤكَّد على الشبكة",
  exchanging: "🔄 جارٍ التحويل",
  sending: "📤 يُرسل للمستلم",
  finished: "✅ وصلت للمستلم",
  failed: "❌ فشلت",
  refunded: "↩️ أُعيد المبلغ للمرسل",
  verifying: "🔎 قيد التحقق لدى خدمة التبديل",
  expired: "⌛ انتهت مهلة الإرسال",
};

type Fetch = typeof fetch;
async function call(path: string, key: string | null, init: RequestInit = {}, f: Fetch = fetch): Promise<any> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(key ? { "x-changenow-api-key": key } : {}) };
  const r = await f(`${API}${path}`, { ...init, headers, signal: AbortSignal.timeout(12_000) });
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = { message: text }; }
  if (!r.ok) throw new Error(String(body?.message || body?.error || r.status).slice(0, 160));
  return body;
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export async function minAmount(c: Coin, f?: Fetch): Promise<number | null> {
  const b = await call(`/exchange/min-amount?${q({ fromCurrency: c.currency, toCurrency: RECEIVE.currency, fromNetwork: c.network, toNetwork: RECEIVE.network, flow: "standard" })}`, null, {}, f).catch(() => null);
  const n = Number(b?.minAmount);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function estimate(key: string, c: Coin, amount: number, f?: Fetch): Promise<{ toAmount: number }> {
  const b = await call(`/exchange/estimated-amount?${q({ fromCurrency: c.currency, toCurrency: RECEIVE.currency, fromNetwork: c.network, toNetwork: RECEIVE.network, fromAmount: String(amount), flow: "standard", type: "direct" })}`, key, {}, f);
  const n = Number(b?.toAmount);
  if (!(n > 0)) throw new Error("no quote");
  return { toAmount: n };
}

export type Created = { id: string; payinAddress: string; payinExtraId: string | null; fromAmount: number; toAmount: number };
export async function createExchange(key: string, c: Coin, amount: number, address: string, ref: string, f?: Fetch): Promise<Created> {
  const b = await call(`/exchange`, key, {
    method: "POST",
    body: JSON.stringify({ fromCurrency: c.currency, fromNetwork: c.network, toCurrency: RECEIVE.currency, toNetwork: RECEIVE.network, fromAmount: String(amount), address, flow: "standard", type: "direct", payload: { ref } }),
  }, f);
  if (!b?.id || !b?.payinAddress) throw new Error("no exchange");
  return { id: String(b.id), payinAddress: String(b.payinAddress), payinExtraId: b.payinExtraId ? String(b.payinExtraId) : null, fromAmount: Number(b.fromAmount) || amount, toAmount: Number(b.toAmount) || 0 };
}

export type ExchangeState = { status: CnStatus; amountTo: number | null; payoutHash: string | null };
export async function exchangeStatus(key: string, id: string, f?: Fetch): Promise<ExchangeState> {
  const b = await call(`/exchange/by-id?${q({ id })}`, key, {}, f);
  return { status: String(b?.status || "waiting") as CnStatus, amountTo: Number(b?.amountTo ?? b?.toAmount) || null, payoutHash: b?.payoutHash ? String(b.payoutHash) : null };
}
