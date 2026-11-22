/**
 * Private-chat topics (Bot API 9.3+, switch in the panel's Telegram tab): when topic mode is on, a message arrives with `message_thread_id` and an answer must carry the
 * SAME id or it lands in the general thread. The webhook records the thread of the update it is handling (AsyncLocalStorage); one API transformer adds it to the outgoing
 * calls for THAT chat. Nothing changes when topic mode is off (no update carries a thread id) or for a call that already names one.
 * (Each topic shares the conversation of the chat; only the place of the answer follows the topic.)
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const threadStore = new AsyncLocalStorage<{ chatId: number; threadId: number }>();

/** Called by the webhook with the incoming update: remembers the topic for the rest of this request. */
export function rememberThread(update: any): void {
  const m = update?.message || update?.edited_message || update?.callback_query?.message;
  const threadId = Number(m?.message_thread_id);
  const chatId = Number(m?.chat?.id);
  if (Number.isFinite(threadId) && threadId > 0 && Number.isFinite(chatId) && (m?.is_topic_message || m?.chat?.type === "private")) threadStore.enterWith({ chatId, threadId });
}

const SEND = /^(send(Message|Photo|Video|Audio|Document|Animation|Voice|VideoNote|Sticker|Location|Venue|Contact|Poll|Dice|MediaGroup|ChatAction|MessageDraft|RichMessage|RichMessageDraft|LivePhoto|Invoice|Gift)?)$/;

/** grammy API transformer: adds message_thread_id for the current update's chat to the send methods. */
export const threadTransformer = (prev: (method: string, payload: any, signal?: any) => Promise<any>) => (method: string, payload: any, signal?: any) => {
  const t = threadStore.getStore();
  if (t && payload && typeof payload === "object" && SEND.test(method) && Number(payload.chat_id) === t.chatId && payload.message_thread_id === undefined) {
    return prev(method, { ...payload, message_thread_id: t.threadId }, signal);
  }
  return prev(method, payload, signal);
};
