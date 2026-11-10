import crypto from "crypto";

// NOWPayments IPN: HMAC-SHA512 of the JSON body with keys sorted
// alphabetically and no extra whitespace (their documented signing scheme).
// Shared by both IPN consumers on this site — the bot-wallet deposit
// webhook and the website order-checkout webhook — so the verification
// logic only ever lives in one place.
function sortedJson(obj: any): string {
  if (Array.isArray(obj)) return `[${obj.map(sortedJson).join(",")}]`;
  if (obj && typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(obj);
}

export function verifyNowPaymentsSignature(body: any, signature: string): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET || "";
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha512", secret).update(sortedJson(body)).digest("hex");
  const a = Buffer.from(String(signature).toLowerCase());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
