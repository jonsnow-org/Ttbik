/**
 * Owner/admin-only notices (training reports, diverted checkpoint lists).
 * Never posted into the Sham 2 model chat the user is talking in.
 */
export function shamAdminChatId(currentChatId?: number | string): string {
  const admin = String(process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID || process.env.SHAM_TRAINING_REPORT_CHAT_ID || process.env.SUPER_ADMIN_TELEGRAM_ID || "").trim();
  if (!admin) return "";
  if (currentChatId !== undefined && String(currentChatId) === admin) return "";
  return admin;
}

export function shamAdminBotToken(): string {
  return String(process.env.TELEGRAM_ADMIN_BOT_TOKEN || process.env.AI_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

/** Best-effort: log always; send to the admin chat when it is distinct from the model chat. Never throws. */
export async function shamAdminNotice(text: string, currentChatId?: number | string): Promise<boolean> {
  const body = String(text || "").trim().slice(0, 3900);
  if (!body) return false;
  console.warn("[sham-admin]", body.slice(0, 240).replace(/\s+/g, " "));
  const chat = shamAdminChatId(currentChatId);
  const token = shamAdminBotToken();
  if (!chat || !token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: body }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
