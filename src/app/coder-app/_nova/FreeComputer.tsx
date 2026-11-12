"use client";
// The Mini App Computer tab: the reserved private 16 GB computer hub runs ONE real Linux desktop per user and model. Everything
// (terminal, files, browser, the model's own commands) lives INSIDE that desktop's screen and is driven by touching the screen
// (owner 2026-11-09: no tool buttons in the page beside it). Owner only (the server refuses everyone else).
import { useCallback, useEffect, useState } from "react";
import { api } from "./parts";
import GraphicalDesktop from "./GraphicalDesktop";
import type { Lang } from "../i18n";
import { COMPUTER_MODEL_OPTIONS } from "@/lib/computerModels";

const MODELS = COMPUTER_MODEL_OPTIONS;
const mono = { font: "13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace", direction: "ltr" as const, textAlign: "left" as const };

export default function FreeComputer({ lang, defaultModel }: { lang: Lang; defaultModel: string }) {
  const ar = lang === "ar";
  const [model, setModel] = useState(MODELS.some((m) => m.id === defaultModel) ? defaultModel : "coder");
  const [status, setStatus] = useState<any>(null);
  const loadStatus = useCallback(async () => { try { setStatus(await api<any>("box", { model, args: { action: "status" } })); } catch (e: any) { setStatus({ ok: false, error: String(e?.message || e) }); } }, [model]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const chip = (on: boolean) => ({ borderRadius: 999, padding: "6px 12px", border: "1px solid var(--n-line, #8883)", background: on ? "var(--n-accent, #0d9488)" : "transparent", color: on ? "#fff" : "inherit", cursor: "pointer" });
  return (
    <div className="n-page">
      <div className="n-card" style={{ padding: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
          {MODELS.map((m) => <button key={m.id} type="button" style={chip(model === m.id)} onClick={() => setModel(m.id)}>{m.label}</button>)}
        </div>
        <div className="n-meta" style={{ ...mono, fontSize: 12 }}>
          {status == null ? "…" : status.ok
            ? `${ar ? "الحاسوب متصل" : "computer online"} · ${status.your_disk_mb ?? 0} MB`
            : `⚠ ${String(status.error || (ar ? "الحاسوب غير متاح الآن (الاستوديو يعمل أو يعيد التشغيل)" : "computer unavailable now"))}`}
        </div>
      </div>
      {model === "sham" || model === "sham_v2" ? (
        <div className="n-card" style={{ padding: 12 }}>
          <div className="n-meta">
            {ar
              ? "حاسوب هذا النموذج مدمج داخله (الطرفية والملفات والمتصفح تعمل داخل استوديو النموذج نفسه). الحاسوب المركزي الرسومي لنوفا وحده، ولا يُشارَك مع شام. سطح مكتب رسومي خاص بهذا النموذج لم يُدمج بعد."
              : "This model's computer is embedded in it (terminal, files and browser run inside the model's own Studio). The shared graphical hub is Nova's only and is not shared with Sham. A graphical desktop of its own is not embedded yet."}
          </div>
        </div>
      ) : <GraphicalDesktop key={model} model={model} ar={ar} />}
    </div>
  );
}
