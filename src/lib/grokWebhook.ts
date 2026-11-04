
const OWNER_TRIGGER_PREFIX = "مرحبا جروك انا المالك";

type TelegramMessage = {
  text?: unknown;
  chat?: { id?: unknown; type?: unknown };
  from?: { id?: unknown; is_bot?: unknown };
};

/**
 * A trigger phrase is not authentication. Only an explicitly allowed human
 * sender in their own private Telegram chat may activate the Grok bridge.
 */
export function grokNotificationFrom(
  body: unknown,
  allowedUserIds: readonly (string | number)[],
): { chatId: string; text: string } | null {
  if (!body || typeof body !== "object") return null;
  const message = (body as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;

  const candidate = message as TelegramMessage;
  if (typeof candidate.text !== "string" || !candidate.text.startsWith(OWNER_TRIGGER_PREFIX)) return null;
  if (candidate.chat?.type !== "private" || candidate.from?.is_bot === true) return null;
  if (candidate.chat.id == null || candidate.from?.id == null) return null;

  const chatId = String(candidate.chat.id);
  const senderId = String(candidate.from.id);
  if (chatId !== senderId) return null;

  if (!allowedUserIds.some((id) => String(id).trim() === senderId)) return null;
  return { chatId, text: candidate.text.slice(0, 500) };
}
