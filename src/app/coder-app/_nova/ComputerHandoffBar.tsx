"use client";
// "You have control" bar of a model's computer (computer_handoff). Kept in its own component so the per-model screens beside it can change freely.
// The model handed its OWN screen to the user for a step only they should do (their sign-in, a code, a captcha); the user does it on the live
// screen and taps Done. Nova-family tasks continue from their waiting run; Sham's round ended with the handoff, so Done sends a short follow-up.
import { useState } from "react";
import { api } from "./parts";
import { handoffIcon } from "@/lib/computerHandoff";

export type HandoffOffer = { model: string; handoff: { kind: string; reason: string }; resume?: "run" | "chat"; runId?: string; slot?: string };

const KIND_AR: Record<string, string> = { signin: "تسجيل دخول", code: "رمز تحقق", captcha: "تحقق بشري", payment: "دفع", confirm: "تأكيد", other: "خطوة منك" };
const KIND_EN: Record<string, string> = { signin: "Sign in", code: "Verification code", captcha: "Captcha", payment: "Payment", confirm: "Confirmation", other: "Your step" };

export default function ComputerHandoffBar({ offer, ar, onDone, onOpen }: { offer: HandoffOffer; ar: boolean; onDone?: () => void; onOpen?: () => void }) {
  const [busy, setBusy] = useState<"" | "done" | "cancel">("");
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const give = async (cancel: boolean) => {
    if (busy) return;
    setBusy(cancel ? "cancel" : "done");
    setError("");
    try {
      const r = await api<{ followup?: string }>("handoff_done", {
        model: offer.model,
        handoff: offer.handoff,
        ...(offer.resume === "run" && offer.runId ? { runId: offer.runId, slot: offer.slot || "" } : {}),
        ...(cancel ? { cancel: true } : {}),
      });
      if (r?.followup) await api("send", { text: r.followup, model: offer.model });
      setFinished(true);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : ar ? "تعذّر إرجاع التحكم. أعد المحاولة." : "Could not give control back. Try again.");
    } finally {
      setBusy("");
    }
  };
  const kind = (ar ? KIND_AR : KIND_EN)[offer.handoff.kind] || (ar ? KIND_AR.other : KIND_EN.other);
  const btn = (primary: boolean) => ({
    border: primary ? "none" : "1px solid var(--n-line, #8884)", borderRadius: 999, padding: "8px 14px", font: "600 13px/1.2 inherit",
    background: primary ? "var(--n-accent, #0d9488)" : "transparent", color: primary ? "#fff" : "inherit", cursor: "pointer", opacity: busy ? 0.7 : 1,
  });
  if (finished) {
    return (
      <div role="status" className="n-card" style={{ padding: "10px 12px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span aria-hidden>🤖</span>{ar ? "عاد التحكم إلى النموذج، وسيكمل مما على الشاشة." : "Control is back with the model; it continues from the screen."}
      </div>
    );
  }
  return (
    <div role="alert" aria-live="assertive" className="n-card" data-testid="computer-handoff-bar"
      style={{ padding: 12, marginBottom: 8, borderInlineStart: "4px solid var(--n-accent, #0d9488)", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: "#22c55e", boxShadow: "0 0 0 4px #22c55e33", flex: "0 0 auto" }} />
        <strong style={{ fontSize: 14 }}>{ar ? "التحكم معك الآن" : "You have control"}</strong>
        <span className="n-meta" style={{ fontSize: 12, marginInlineStart: "auto" }}>{handoffIcon(offer.handoff.kind)} {kind}</span>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>{offer.handoff.reason}</div>
      <div className="n-meta" style={{ fontSize: 12 }}>
        {ar ? "النموذج متوقف بانتظارك. نفّذ الخطوة على الشاشة؛ يبقى تسجيل الدخول في حاسوبه فقط. لا تكتب كلمة السر في المحادثة." : "The model is paused for you. Do the step on the screen; the login stays on its computer only. Never type a password in the chat."}
      </div>
      {error ? <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn(true)} disabled={!!busy} onClick={() => void give(false)}>{busy === "done" ? "…" : ar ? "✓ تم، أكمل" : "✓ Done, continue"}</button>
        {onOpen ? <button type="button" style={btn(false)} disabled={!!busy} onClick={onOpen}>{ar ? "🖥 افتح الشاشة" : "🖥 Open screen"}</button> : null}
        <button type="button" style={btn(false)} disabled={!!busy} onClick={() => void give(true)}>{busy === "cancel" ? "…" : ar ? "ليس الآن" : "Not now"}</button>
      </div>
    </div>
  );
}
