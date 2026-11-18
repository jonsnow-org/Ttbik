// Hand the computer to the user (owner's order 2026-11-18: every model's computer must match a modern agent computer).
// A model working on ITS OWN computer reaches a step only the user should do: sign in to the user's own account, type a one-time / 2FA code,
// solve a captcha, confirm a payment. It calls computer_handoff{kind, reason}: the task waits (no time limit), the Mini App opens that model's
// live screen with a "you have control" bar, the user does the step on the screen, taps Done, and the model continues from what is on the screen.
// Model-independent on purpose: each model keeps its own computer (Nova / LFM: the hub session user:model; Sham / Sham Pro: their own Studio's
// embedded desktop). Only the pause, the bar and the resume note live here; nothing of one model's computer is shared with another.

export const HANDOFF_TOOL_NAME = "computer_handoff";
export const HANDOFF_KINDS = ["signin", "code", "captcha", "payment", "confirm", "other"] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];
export type Handoff = { kind: HandoffKind; reason: string };
/** How long a handoff offer stays on the user's screen after the model asked (the chat keeps it longer: the user may answer there too). */
export const HANDOFF_OFFER_MINUTES = 30;

export const HANDOFF_TOOL_DESCRIPTION =
  "Hand YOUR computer screen to the user for a step only they should do on their OWN account: sign in, a one-time / 2FA code, a captcha, a payment or a final confirmation. " +
  "Open the page first (browser or desktop) so the user lands on it. kind = signin | code | captcha | payment | confirm | other; reason = one short line in the user's language saying what to do. " +
  "The task waits; the user does it on the live screen in the Mini App and taps Done. Then look at the screen again (desktop frame / browser look) before you continue. " +
  "Never ask for a password in the chat and never type a password you were not given in the secure box.";

export function cleanHandoff(input: unknown): Handoff | null {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const reason = String(a.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!reason) return null;
  const kind = (HANDOFF_KINDS as readonly string[]).includes(String(a.kind)) ? (String(a.kind) as HandoffKind) : "other";
  return { kind, reason };
}

const ICON: Record<HandoffKind, string> = { signin: "🔑", code: "🔢", captcha: "🧩", payment: "💳", confirm: "✅", other: "🖐" };
export const handoffIcon = (kind: HandoffKind | string | undefined): string => ICON[(kind as HandoffKind) || "other"] || ICON.other;

/** The chat line the user receives (the Mini App opens the screen by itself as well). */
export function handoffChatText(h: Handoff, modelLabel: string): string {
  return `${handoffIcon(h.kind)} ${modelLabel} يحتاجك على حاسوبه: ${h.reason}\n\nافتح التطبيق المصغّر: الشاشة تفتح وحدها والتحكم معك. نفّذ الخطوة على الشاشة ثم اضغط «تم، أكمل». أو اكتب هنا «تم» عندما تنتهي.`;
}

/** What the model is told when the user gives the computer back. Free text the user typed is clipped and marked as theirs. */
export function handoffDoneNote(h: Handoff | null, note?: string, cancelled = false): string {
  const what = h ? `${h.kind}: ${h.reason}` : "the step you asked for";
  if (cancelled) return `The user did NOT do it (${what}) and gave the computer back. Do not retry the same step; continue without it or tell the user what you still need.`;
  const extra = String(note || "").trim().slice(0, 300);
  return `The user finished on your computer (${what}) and gave control back${extra ? `; they said: «${extra}»` : ""}. Look at the screen again (desktop action=frame or browser action=look) before your next step; the session keeps their login.`;
}

/** Sham's round ended with the handoff: the Mini App continues the chat with this short message (Sham reads Arabic first). */
export function shamHandoffFollowup(h: Handoff | null, note?: string, cancelled = false): string {
  const what = h ? ` (${h.reason})` : "";
  const extra = String(note || "").trim().slice(0, 300);
  if (cancelled) return `[الحاسوب] لم أنفّذ الخطوة${what} وأعدت لك التحكم. لا تكررها؛ أكمل بدونها أو قل لي ما تحتاجه.`;
  return `[الحاسوب] انتهيت من الخطوة على شاشتك${what} وأعدت لك التحكم${extra ? `. ملاحظتي: «${extra}»` : ""}. انظر إلى الشاشة من جديد ثم أكمل مهمتي.`;
}

/** The task-log event the Mini App polls for ("screen" kind): which model's screen to open and why. */
export function handoffEvent(model: string, h: Handoff, resume: "run" | "chat", slot = ""): string {
  return JSON.stringify({ model, handoff: h, resume, ...(resume === "run" ? { slot } : {}) });
}

/** Reads a "screen" event (a plain show from Sham, or a handoff from any model). */
/** resume: "run" = a waiting Nova-family task continues (handoff_done with its runId); "chat" = Sham's round ended, a follow-up message continues it. */
export function parseScreenEvent(text: string): { model: string; handoff?: Handoff; resume?: "run" | "chat"; slot?: string } | null {
  try {
    const j = JSON.parse(text) as { model?: unknown; handoff?: unknown; resume?: unknown; slot?: unknown };
    const model = String(j.model || "");
    if (!/^[a-z0-9_]{2,20}$/.test(model)) return null;
    const handoff = j.handoff ? cleanHandoff(j.handoff) : null;
    if (!handoff) return { model };
    return j.resume === "run" ? { model, handoff, resume: "run", slot: String(j.slot ?? "").slice(0, 80) } : { model, handoff, resume: "chat" };
  } catch {
    return null;
  }
}
