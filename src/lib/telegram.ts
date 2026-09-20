const TG_API = "https://api.telegram.org";

function botUrl(method: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return `${TG_API}/bot${token}/${method}`;
}

export interface SendMessageResult {
  message_id: string | null;
  chat_id: string | null;
}

/**
 * Sends the "new order" alert to the admin with inline Approve/Reject buttons.
 * Returns the Telegram message_id/chat_id so it can be edited later once a
 * decision is made (from either Telegram itself or the web dashboard).
 */
export async function sendOrderAlert(params: {
  orderId: string;
  orderCode: string;
  serviceName: string;
  priceUsd: number;
  customerName: string;
  customerContact: string;
  paymentMethod: string;
  transferReference: string;
}): Promise<SendMessageResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) return { message_id: null, chat_id: null };

  // Plain text on purpose: params.customerName/customerContact/transferReference
  // are raw customer input. With parse_mode "Markdown", an unescaped _ * ` [
  // (e.g. a Telegram @handle like @ahmed_2024) makes Telegram reject the whole
  // sendMessage call with 400 — silently, since the failure just falls through
  // to {message_id: null, chat_id: null} below. An internal admin alert doesn't
  // need bold/code formatting badly enough to risk losing the notification.
  const text = [
    `🛒 طلب جديد ${params.orderCode}`,
    `الخدمة: ${params.serviceName}`,
    `السعر: $${params.priceUsd}`,
    `العميل: ${params.customerName}`,
    `التواصل: ${params.customerContact}`,
    `طريقة الدفع: ${
      params.paymentMethod === "bank" ? "تحويل بنكي (ACH)" : params.paymentMethod === "crypto_auto" ? "⚡ دفع تلقائي (NOWPayments)" : "USDT (يدوي)"
    }`,
    `مرجع التحويل: ${params.transferReference}`,
  ].join("\n");

  const res = await fetch(botUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "موافقة ✅", callback_data: `approve:${params.orderId}` },
            { text: "رفض ❌", callback_data: `reject:${params.orderId}` },
          ],
        ],
      },
    }),
  });

  const data = await res.json().catch(() => null);
  if (!data?.ok) {
    console.error("sendOrderAlert failed:", data?.description || "no response body");
    return { message_id: null, chat_id: null };
  }
  return {
    message_id: String(data.result.message_id),
    chat_id: String(data.result.chat.id),
  };
}

/** Edits the original alert message to reflect the final decision. */
export async function editOrderAlert(
  chatId: string,
  messageId: string,
  extraLine: string
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  // Telegram doesn't let us easily append without the original text, so we
  // just remove the buttons and send a follow-up confirmation instead.
  await fetch(botUrl("editMessageReplyMarkup"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: Number(messageId),
      reply_markup: { inline_keyboard: [] },
    }),
  }).catch(() => null);

  await fetch(botUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: extraLine }),
  }).catch(() => null);
}

/** Plain informational message to the admin chat — no inline buttons. */
export async function sendAdminNotice(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(botUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => null);
}

/** Answers a Telegram callback_query so the loading spinner on the button stops. */
export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(botUrl("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  }).catch(() => null);
}
