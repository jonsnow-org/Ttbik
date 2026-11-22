/**
 * Telegram Rich Messages (Bot API 10.1–10.3, core.telegram.org/bots/api#rich-messages): a message written in Markdown (GitHub style: tables, fenced code, collapsible
 * <details>, footnotes), up to 32,768 characters and 500 blocks instead of 4,096, with a right-to-left switch (`is_rtl`) and a streamed draft (`sendRichMessageDraft`) that
 * keeps the same Stop button as `sendMessageDraft`.
 *
 * Why we use it: an answer longer than 4,096 characters used to be cut into several messages (or stripped of its formatting), and a Markdown table or a long code
 * block had no good rendering in Telegram's HTML mode. Here the model's own Markdown goes in as it is.
 *
 * Rules: always with a fallback to the old HTML path (any refusal, an unsupported chat, a method the Bot API does not have: the caller sends the way it did before and
 * this module stops trying for an hour); `skip_entity_detection` so a model's `@name`, `#tag` or `/command` is never turned into a live mention or command; Arabic text sets
 * `is_rtl`. Who gets it: env TG_RICH = "owner" (default: the owner's chats first, to look at it live), "all", or "off".
 */
type Api = { raw?: Record<string, (payload: Record<string, unknown>) => Promise<unknown>> } & Record<string, unknown>;

export const RICH_MAX = 30000;            // characters one rich message / draft may hold (Telegram: 32,768)
export const RICH_LONG = 3800;            // above this the old path would have split the answer

let refusedAt = 0;                        // a refusal that looks like "not supported here": not tried again for an hour
const RETRY_AFTER_MS = 3600_000;

export type RichMode = "off" | "owner" | "all";
let override: RichMode | null = null;       // the owner's switch in the control panel (src/lib/tgFeatures.ts) wins over the env default
export const setRichOverride = (m: RichMode | null): void => { override = m; };
export function richMode(): RichMode {
  if (override) return override;
  const v = (process.env.TG_RICH || "owner").trim().toLowerCase();
  return v === "off" || v === "all" ? v : "owner";
}
export function richOnFor(isOwnerChat: boolean): boolean {
  const m = richMode();
  if (m === "off" || Date.now() - refusedAt < RETRY_AFTER_MS) return false;
  return m === "all" || isOwnerChat;
}
export const _resetRichRefusal = (): void => { refusedAt = 0; override = null; };

export const isArabicText = (t: string): boolean => /[؀-ۿ]/.test(t);
/** A GitHub-style Markdown table: the case HTML mode cannot draw. */
export const hasMarkdownTable = (t: string): boolean => /^\s*\|.+\|\s*\n\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/m.test(t);
/** Worth sending as a rich message: longer than the old limit, or a table. */
export const wantsRich = (t: string): boolean => t.length > RICH_LONG || hasMarkdownTable(t);

function call(api: Api, method: string, payload: Record<string, unknown>): Promise<unknown> | null {
  const fn = (api.raw && api.raw[method]) || (api as Record<string, unknown>)[method];
  return typeof fn === "function" ? (fn as (p: Record<string, unknown>) => Promise<unknown>).call(api.raw || api, payload) : null;
}
const body = (markdown: string) => ({ markdown: markdown.slice(0, RICH_MAX), is_rtl: isArabicText(markdown), skip_entity_detection: true });
const refuse = (e: unknown): false => {
  const msg = String((e as { description?: string; message?: string })?.description || (e as Error)?.message || e);
  if (/unknown method|method\b.*\bnot (found|exist|supported|available)|METHOD_NOT|rich.*(unsupported|not supported)/i.test(msg)) refusedAt = Date.now();   // a missing method, not a one-off "chat not found"
  return false;
};

/** One finished rich message. True when Telegram took it; false means "send it the old way". */
export async function richSend(api: Api, chatId: number, markdown: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  if (!markdown.trim()) return false;
  const p = call(api, "sendRichMessage", { chat_id: chatId, rich_message: body(markdown), ...extra });
  if (!p) return false;
  return p.then(() => true).catch(refuse);
}

/** A streamed rich draft (private chats). Same Stop button as the plain draft. */
export async function richDraft(api: Api, chatId: number, draftId: number, markdown: string, opts: { canStop?: boolean; keepOnStop?: boolean } = {}): Promise<boolean> {
  if (!markdown.trim()) return false;
  const p = call(api, "sendRichMessageDraft", { chat_id: chatId, draft_id: draftId, rich_message: body(markdown), ...(opts.canStop ? { can_stop: true } : {}), ...(opts.keepOnStop ? { keep_on_stop: true } : {}) });
  if (!p) return false;
  return p.then(() => true).catch(refuse);
}
