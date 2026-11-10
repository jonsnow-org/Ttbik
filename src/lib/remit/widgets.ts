// The swap widget on top of /remit: the one place the page itself earns on every transfer.
// Non-custodial: the user swaps on the provider's own page inside an iframe, sends from their wallet, and the provider pays the
// owner a partner commission. Our site never sees or holds the money.
//
// Formats checked on 2026-11-10:
//   ChangeNOW  https://changenow.io/embeds/exchange-widget/v2/widget.html?…&link_id=<id>  (params as in ChangeNOW's own embed code;
//              the partner id is the `link_id` in the owner's referral link, e.g. https://changenow.io/?link_id=123040aec1d261)
//              plus https://changenow.io/embeds/exchange-widget/v2/stepper-connector.js, which resizes the iframe (id "iframe-widget").
//   StealthEX  https://stealthex.io/widget/<widget-id>/  (what their @stealthex-io/widget library builds; the id is in the partner
//              profile, Code tab), 330px high.
// FixedFloat and Exolix publish no documented embed URL, so they only get a referral button.

export type SwapWidget = { provider: "CHANGENOW" | "STEALTHEX"; name: string; src: string; height: number; script?: string };

const ID = /^[A-Za-z0-9_-]{6,64}$/;

/** The ChangeNOW partner id from a referral link (or a bare id). Null when there is none. Pure. */
export function changenowLinkId(v?: string | null): string | null {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^[A-Za-z0-9]{8,40}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/(^|\.)changenow\.(io|app\.link)$/i.test(u.hostname)) return null;
    const id = u.searchParams.get("link_id");
    return id && /^[A-Za-z0-9]{6,40}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** A StealthEX widget id (bare id only: it is not the same thing as a referral link). Pure. */
export function stealthexWidgetId(v?: string | null): string | null {
  const s = String(v || "").trim();
  return ID.test(s) ? s : null;
}

export function changenowSrc(linkId: string): string {
  const q = new URLSearchParams({
    FAQ: "false", amount: "0.01", amountFiat: "200", backgroundColor: "FFFFFF", darkMode: "false",
    from: "btc", fromFiat: "usd", horizontal: "false", lang: "en-US", link_id: linkId, locales: "true",
    logo: "false", primaryColor: "0369A1", to: "usdttrc20", toFiat: "usdttrc20", toTheMoon: "true",
  });
  return `https://changenow.io/embeds/exchange-widget/v2/widget.html?${q.toString()}`;
}

/**
 * The widget to show, from the owner's settings (Telegram /ref, then env). ChangeNOW first, StealthEX next; null hides the block
 * (no partner id = no commission, so no widget). Pure.
 */
export function pickWidget(saved: Record<string, string>, env: Record<string, string | undefined> = process.env): SwapWidget | null {
  const cn = changenowLinkId(saved.CHANGENOW || env.REMIT_REF_CHANGENOW);
  if (cn) return { provider: "CHANGENOW", name: "ChangeNOW", src: changenowSrc(cn), height: 356, script: "https://changenow.io/embeds/exchange-widget/v2/stepper-connector.js" };
  const sx = stealthexWidgetId(saved.STEALTHEX_WIDGET || env.REMIT_STEALTHEX_WIDGET);
  if (sx) return { provider: "STEALTHEX", name: "StealthEX", src: `https://stealthex.io/widget/${encodeURIComponent(sx)}/`, height: 330 };
  return null;
}
