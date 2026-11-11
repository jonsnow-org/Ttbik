import { publicSiteUrl } from "@/lib/siteUrl";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";

// The ads & earn wallet's crypto deposit (NOWPayments hosted invoice), shared by /pay (POST /api/payments/create-invoice) and the
// bot's Mini App: same order id (the Telegram id), same IPN (/api/payments/webhook credits User.balance), same limits.
export const WALLET_DEPOSIT_MIN_USD = 1;
export const WALLET_DEPOSIT_MAX_USD = 100000;

export function walletDepositAmount(v: unknown): number {
  return Math.max(WALLET_DEPOSIT_MIN_USD, Math.min(WALLET_DEPOSIT_MAX_USD, Number(v) || 0));
}

export async function createWalletDepositInvoice(uid: string, amountIn: unknown): Promise<{ ok: true; invoiceUrl: string } | { ok: false; error: string; status: number }> {
  if (!isNowPaymentsConfigured()) return { ok: false, error: "الدفع بعملة رقمية غير مُفعَّل بعد.", status: 400 };
  const amount = walletDepositAmount(amountIn);
  // Telegram ids are digits only: rejects junk that would create stray accounts or break the success/cancel URLs below.
  if (!/^\d{3,20}$/.test(uid) || !amount) return { ok: false, error: "رابط الإيداع غير صالح — افتحه من زر «إيداع» داخل البوت.", status: 400 };
  const base = publicSiteUrl();
  const result = await createInvoice({
    priceAmount: amount,
    orderId: uid,
    orderDescription: `Ttbik wallet deposit`,
    ipnCallbackUrl: `${base}/api/payments/webhook`,
    successUrl: `${base}/pay?uid=${uid}&paid=1`,
    cancelUrl: `${base}/pay?uid=${uid}`,
  });
  if (!result.ok || !result.invoiceUrl) return { ok: false, error: result.error || "تعذّر إنشاء فاتورة الدفع", status: 502 };
  return { ok: true, invoiceUrl: result.invoiceUrl };
}
