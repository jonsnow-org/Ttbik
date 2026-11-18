/**
 * Sham 2 live typist for Telegram (and a fallback for any chat that has a bot API).
 *
 * Reuses Nova's long-reply pattern without touching Nova's runner:
 *   - sendMessageDraft when the Bot API has it, throttled for rate limits
 *   - otherwise a real message that is editMessageText'd in place
 *   - an empty draft is pulsed so Telegram does not expire the "Thinking…" placeholder (~30 s)
 *
 * The finished answer is still committed with sendMessage when a draft was used
 * (drafts are ephemeral). An edit-mode typist already holds the text, so the
 * caller should finalize that message instead of sending a second copy.
 */
import type { Bot as TelegramBot } from "grammy";

export const SHAM_DRAFT_EVERY_MS = 1500;
export const SHAM_DRAFT_MAX = 3600;
export const SHAM_DRAFT_PULSE_MS = 18_000;

export type ShamLiveMode = "draft" | "edit" | "none";
export type ShamLiveState = {
  draftId?: number;
  draftAt?: number;
  draftText?: string;
  noDraft?: boolean;
  msgId?: number;
  lastEditAt?: number;
};

export type ShamTypist = {
  push(fullText: string): void;
  flush(): Promise<void>;
  pulse(): Promise<void>;
  finish(): Promise<{ mode: ShamLiveMode; msgId?: number; text: string }>;
  state(): ShamLiveState;
  text(): string;
};

let draftRefusedAt = 0;

const liveDraftOn = () => (process.env.SHAM_LIVE_DRAFT || process.env.CODER_LIVE_DRAFT || "").toLowerCase() !== "off"
  && Date.now() - draftRefusedAt > 3600_000;

export function _resetShamLiveReply(): void {
  draftRefusedAt = 0;
}

export function createShamTypist(
  bot: TelegramBot,
  chatId: number,
  opts: { state?: ShamLiveState; minIntervalMs?: number; now?: () => number } = {},
): ShamTypist {
  const state: ShamLiveState = { ...(opts.state || {}) };
  const interval = opts.minIntervalMs ?? SHAM_DRAFT_EVERY_MS;
  const now = opts.now || Date.now;
  const api = bot.api as any;
  let full = "";
  let inflight: Promise<void> | null = null;
  let pending = false;

  const tailOf = (text: string): string => {
    if (text.length <= SHAM_DRAFT_MAX) return text;
    return text.slice(text.length - SHAM_DRAFT_MAX);
  };

  const sendDraft = async (text: string): Promise<boolean> => {
    if (!liveDraftOn() || state.noDraft || chatId <= 0 || typeof api.sendMessageDraft !== "function") return false;
    state.draftId = state.draftId || 1 + Math.floor(Math.random() * 2_000_000_000);
    const body = tailOf(text);
    let ok = await api.sendMessageDraft(chatId, state.draftId, body.slice(0, 4096), { can_stop: true, keep_on_stop: true }).then(() => true).catch(() => false);
    if (!ok) ok = await api.sendMessageDraft(chatId, state.draftId, body.slice(0, 4096)).then(() => true).catch(() => false);
    if (ok) {
      state.draftAt = now();
      state.draftText = body;
      return true;
    }
    state.noDraft = true;
    draftRefusedAt = now();
    return false;
  };

  const sendEdit = async (text: string): Promise<boolean> => {
    const body = (text.trim() ? text : "…").slice(0, 4096);
    if (!state.msgId) {
      const m = await api.sendMessage(chatId, body).catch(() => null);
      const mid = Number(m?.message_id);
      if (!Number.isFinite(mid) || mid <= 0) return false;
      state.msgId = mid;
      state.lastEditAt = now();
      state.draftText = body;
      return true;
    }
    const ok = await api.editMessageText(chatId, state.msgId, body).then(() => true).catch((e: any) => /not modified/i.test(String(e?.description || e?.message || e)));
    if (ok) {
      state.lastEditAt = now();
      state.draftText = body;
    }
    return ok;
  };

  const paint = async (force: boolean): Promise<void> => {
    const text = full;
    if (!force && text === state.draftText) return;
    const last = state.draftAt || state.lastEditAt || 0;
    if (!force && last && now() - last < interval && text !== "") return;
    if (await sendDraft(text)) return;
    if (!text.trim()) return;                        // no placeholder message when drafts are unavailable; wait for tokens
    await sendEdit(text);
  };

  const flush = async (force = false): Promise<void> => {
    if (inflight) {
      pending = true;
      await inflight;
      if (!pending) return;
    }
    pending = false;
    const work = paint(force).catch(() => undefined);
    inflight = work;
    try { await work; } finally { if (inflight === work) inflight = null; }
    if (pending) {
      pending = false;
      await flush(force);
    }
  };

  return {
    push(text: string) {
      full = text;
      if (!inflight) void flush(false);
      else pending = true;
    },
    flush: () => flush(true),
    async pulse() {
      if (full) return flush(false);
      if (!state.draftId || state.draftText) return;
      if (now() - (state.draftAt || 0) < SHAM_DRAFT_PULSE_MS) return;
      if (typeof api.sendMessageDraft !== "function") return;
      const ok = await api.sendMessageDraft(chatId, state.draftId, "", { can_stop: true }).then(() => true).catch(() => false)
        || await api.sendMessageDraft(chatId, state.draftId, "").then(() => true).catch(() => false);
      if (ok) state.draftAt = now();
    },
    async finish() {
      await flush(true);
      const mode: ShamLiveMode = !full.trim() ? "none" : state.noDraft && state.msgId ? "edit" : state.draftId && !state.noDraft ? "draft" : state.msgId ? "edit" : "none";
      return { mode, msgId: state.msgId, text: full };
    },
    state: () => ({ ...state }),
    text: () => full,
  };
}

/** Keep a growing edit-mode message in sync with the final answer; leftover length is sent as new messages. */
export async function finalizeShamEdit(bot: TelegramBot, chatId: number, msgId: number, text: string): Promise<void> {
  const api = bot.api as any;
  const first = text.slice(0, 4096);
  if (first.trim()) {
    await api.editMessageText(chatId, msgId, first).then(() => true).catch((e: any) => /not modified/i.test(String(e?.description || e?.message || e)));
  }
  if (text.length > 4096) {
    for (let i = 4096; i < text.length;) {
      let end = Math.min(text.length, i + 3800);
      if (end < text.length) { const nl = text.lastIndexOf("\n", end - 1); if (nl > i + 1500) end = nl + 1; }
      await api.sendMessage(chatId, text.slice(i, end)).catch(() => null);
      i = end;
    }
  }
}

/** Merge a (possibly replayed) Gradio stream onto text already received, so a reconnect does not double the answer. */
export function mergeResumedStream(already: string, incoming: string): string {
  if (!incoming) return already;
  if (!already) return incoming;
  if (incoming.startsWith(already)) return incoming;
  if (already.startsWith(incoming)) return already;
  for (let n = Math.min(already.length, incoming.length); n > 0; n--) {
    if (already.endsWith(incoming.slice(0, n))) return already + incoming.slice(n);
  }
  return already + incoming;
}

export function isRetryableStreamError(e: unknown): boolean {
  const name = String((e as { name?: string })?.name || "");
  const msg = String((e as Error)?.message || e);
  if (name === "TimeoutError" || name === "AbortError" || name === "TypeError") return true;
  if (/timeout|aborted|network|fetch|ECONNRESET|ETIMEDOUT|socket/i.test(msg)) return true;
  if (/HTTP 502|HTTP 503|HTTP 504/.test(msg)) return true;
  return false;
}
