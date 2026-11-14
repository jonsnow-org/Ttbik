/**
 * One panel switch for every bot with an owner panel (owner's order, 2026-11-14): the platform owner (SUPER_ADMIN_TELEGRAM_ID) sees
 * the admin panel by default and moves to the user panel, and back, with a button inside the panel itself, instead of an ID trick.
 *
 *  - The mode lives in bot_settings (`owner_user_view:<botId>`), per bot. Anything unreadable counts as "admin" (the owner's usual view).
 *  - `ownerGate` is called by a bot at its owner gate: it consumes the two switch buttons (re-entering the bot with «/start» so the right
 *    panel opens) and tells the bot whether to run its admin branch or its regular user flow.
 *  - `ownerPanelTransformer` (grammy API transformer) adds the switch button as the last row of every reply keyboard sent to the owner's
 *    private chat, unless that keyboard already carries one of the two buttons. Inline keyboards and notifications are untouched.
 */
import type { Transformer } from "grammy";

export const USER_VIEW_BTN = "👤 لوحة المستخدم";
export const ADMIN_VIEW_BTN = "🛠 لوحة الإدارة";
export const ownerId = () => String(process.env.SUPER_ADMIN_TELEGRAM_ID || "").trim();
export const isOwnerUser = (id: unknown) => !!ownerId() && String(id ?? "") === ownerId();

const key = (botId: string) => `owner_user_view:${botId}`;
const cache = new Map<string, { at: number; v: boolean }>();
const TTL = 15_000;

export async function ownerInUserView(botId: string): Promise<boolean> {
  const c = cache.get(botId);
  if (c && Date.now() - c.at < TTL) return c.v;
  let v = false;
  try {
    const { supabaseAdmin } = await import("@/lib/supabase");
    const { data } = await supabaseAdmin().from("bot_settings").select("value").eq("key", key(botId)).maybeSingle();
    v = (data as { value?: unknown } | null)?.value === true;
  } catch {
    v = false;
  }
  cache.set(botId, { at: Date.now(), v });
  return v;
}

export async function setOwnerUserView(botId: string, on: boolean): Promise<void> {
  cache.set(botId, { at: Date.now(), v: on }); // visible at once on this server even if the write is slow
  try {
    const { supabaseAdmin } = await import("@/lib/supabase");
    await supabaseAdmin().from("bot_settings").upsert({ key: key(botId), value: on, updated_at: new Date().toISOString() });
  } catch {
    /* the in-memory value still serves this process; the next change retries the write */
  }
}

export type OwnerGate = "admin" | "user" | "handled";
/** For a message of the owner at a bot's owner gate. "handled": a switch button, the bot was re-entered with «/start» in the new mode. */
export async function ownerGate(botId: string, text: string, reenter: (text: string) => Promise<void>): Promise<OwnerGate> {
  if (text === USER_VIEW_BTN || text === ADMIN_VIEW_BTN) {
    await setOwnerUserView(botId, text === USER_VIEW_BTN);
    await reenter("/start");
    return "handled";
  }
  return (await ownerInUserView(botId)) ? "user" : "admin";
}

const label = (b: unknown): string => (typeof b === "string" ? b : String((b as { text?: unknown })?.text ?? ""));

/** The switch row to append to a reply keyboard, or null when the keyboard already carries a switch button (or is not a reply keyboard). Pure. */
export function withSwitchRow<T extends { keyboard?: unknown }>(markup: T, userView: boolean): T | null {
  const rows = (markup as { keyboard?: unknown[][] }).keyboard;
  if (!Array.isArray(rows)) return null;
  if (rows.some((r) => Array.isArray(r) && r.some((b) => label(b) === USER_VIEW_BTN || label(b) === ADMIN_VIEW_BTN))) return null;
  return { ...markup, keyboard: [...rows, [{ text: userView ? ADMIN_VIEW_BTN : USER_VIEW_BTN }]] };
}

export function ownerPanelTransformer(botId: string): Transformer {
  return async (prev, method, payload, signal) => {
    try {
      const p = payload as Record<string, unknown>;
      if (method === "sendMessage" && isOwnerUser(p.chat_id) && p.reply_markup && typeof p.reply_markup === "object") {
        const rm = p.reply_markup as { toJSON?: () => unknown };
        const plain = (typeof rm.toJSON === "function" ? rm.toJSON() : rm) as { keyboard?: unknown };
        const next = withSwitchRow(plain, await ownerInUserView(botId));
        if (next) return prev(method, { ...p, reply_markup: next } as never, signal);
      }
    } catch {
      /* the switch button is a convenience: never block a message because of it */
    }
    return prev(method, payload, signal);
  };
}

/** Templates whose owner gate uses this switch (the chains bot has its own pair of buttons with the same labels; Athar has its own toggle). */
export const OWNER_PANEL_TEMPLATES = new Set(["JOBS_BOT", "MEDICAL_BOT", "CONFESSION_BOT"]);
