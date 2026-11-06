/**
 * Shared state of a live reply: the Stop press of Telegram's `sendMessageDraft`.
 *
 * `sendMessageDraft` streams a partial answer while a model writes, and `can_stop: true` shows a Stop button. The press
 * arrives as its own update (`stopped_message_generation`) in the webhook, but the answering loop runs elsewhere, so the
 * flag has to be readable from both. It is per chat: one chat's Stop must not stop another's work.
 *
 * (core.telegram.org/bots/api#sendmessagedraft: the draft is ephemeral; the finished text is still sent with sendMessage.)
 */

/** A Stop press is remembered briefly, so a loop that reloads its state still sees it. */
const stoppedAt = new Map<number, number>();
const STOP_MEMORY_MS = 10 * 60_000;

/** The webhook calls this on `stopped_message_generation`. */
export function markStopped(chatId: number): void {
  if (Number.isFinite(chatId)) stoppedAt.set(chatId, Date.now());
}

/** A new user message clears the previous Stop. */
export function clearStopped(chatId: number): void {
  stoppedAt.delete(chatId);
}

/** The Stop button was pressed for this chat and no newer request has begun. */
export function draftStopped(chatId: number): boolean {
  const at = stoppedAt.get(chatId);
  if (at === undefined) return false;
  if (Date.now() - at > STOP_MEMORY_MS) { stoppedAt.delete(chatId); return false; }
  return true;
}

/** Tests only: forget every Stop press. */
export function _resetLiveReply(): void {
  stoppedAt.clear();
}
