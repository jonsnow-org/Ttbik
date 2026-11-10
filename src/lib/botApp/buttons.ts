// The ads & earn bots' (AD_BOT) own Mini App (src/app/bot-app/[botId]): the chat buttons that open one of its sections.
// Inline web_app buttons (not reply-keyboard web_app buttons): only those carry the signed initData the app's API needs.
export const APP_BUTTON = "📱 التطبيق";
export const APP_INTRO = "📱 تطبيق البوت: الإعلانات والربح والمحفظة والحوالات وبورصة القنوات في مكان واحد داخل تيليجرام. اضغط الزر:";
export const EXCHANGE_BUTTON = "📣 بورصة القنوات";
export const EXCHANGE_INTRO = "📣 بورصة القنوات والجروبات: اشترِ إعلاناً في قناة موثّقة أو اعرض قناتك وابدأ ببيع الإعلانات، والمبلغ محفوظ لدى المنصة حتى التحقق من النشر. اضغط الزر:";

export function isExchangeRequest(text: string | null | undefined): boolean {
  const t = String(text || "").trim();
  return t === EXCHANGE_BUTTON || /^\/exchange(@\w+)?$/i.test(t);
}

/** `/start pay_<TRC20 address>`: a recipient's «send me» link. Returns the address, or null for any other payload. Pure. */
export function remitPayPayload(payload: string | null | undefined): string | null {
  const m = /^pay_(T[1-9A-HJ-NP-Za-km-z]{33})$/.exec(String(payload || "").trim());
  return m ? m[1] : null;
}

/** The sections the app can be opened on (`?s=`). */
export const APP_SECTIONS = ["home", "earn", "create", "ads", "wallet", "referrals", "remit", "exchange"] as const;
export type AppSection = (typeof APP_SECTIONS)[number];
export function appSection(v: unknown): AppSection {
  const s = String(Array.isArray(v) ? v[0] : v ?? "");
  return (APP_SECTIONS as readonly string[]).includes(s) ? (s as AppSection) : "home";
}
