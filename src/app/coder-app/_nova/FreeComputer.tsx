"use client";
// The Mini App Computer tab: the computer of the SELECTED model only (owner 2026-11-18: every model is independent; no picker that opens another
// model's computer). Nova 1 / Nova 2 work on the Mini App computer (each in its own private session); Sham / Sham Pro on their own embedded
// computer inside their own Studio. Everything (terminal, files, browser, the model's own commands) lives INSIDE that desktop's screen and is
// driven by touching the screen. Owner only (the server refuses everyone else).
import { useCallback, useEffect, useState } from "react";
import { api } from "./parts";
import GraphicalDesktop from "./GraphicalDesktop";
import type { Lang } from "../i18n";
import type { ComputerHome } from "@/lib/computerModels";

const mono = { font: "13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace", direction: "ltr" as const, textAlign: "left" as const };

export default function FreeComputer({ lang, model, home, modelLabel }: { lang: Lang; model: string; home: ComputerHome; modelLabel: string }) {
  const ar = lang === "ar";
  const [status, setStatus] = useState<any>(null);
  // the hub answers `box status` (disk use); an embedded Sham computer answers its own `desktop status`
  const loadStatus = useCallback(async () => {
    try { setStatus(home === "embedded" ? await api<any>("desktop", { model, args: { action: "status" } }) : await api<any>("box", { model, args: { action: "status" } })); }
    catch (e: any) { setStatus({ ok: false, error: String(e?.message || e) }); }
  }, [model, home]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  const where = home === "embedded"
    ? (ar ? "الحاسوب الداخلي المدمج في النموذج" : "the model's own embedded computer")
    : (ar ? "حاسوب التطبيق المصغّر · جلسة خاصة بهذا النموذج" : "the Mini App computer · a session private to this model");
  return (
    <div className="n-page">
      <div className="n-card" style={{ padding: 10, marginBottom: 8 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }} dir="auto">💻 {ar ? `حاسوب ${modelLabel}` : `${modelLabel}'s computer`}</div>
        <div className="n-meta" dir="auto" style={{ marginBottom: 4 }}>{where}</div>
        <div className="n-meta" style={{ ...mono, fontSize: 12 }}>
          {status == null ? "…" : status.ok !== false
            ? `${ar ? "الحاسوب متصل" : "computer online"}${status.your_disk_mb != null ? ` · ${status.your_disk_mb} MB` : ""}`
            : `⚠ ${String(status.error || (ar ? "الحاسوب غير متاح الآن (الاستوديو يعمل أو يعيد التشغيل)" : "computer unavailable now"))}`}
        </div>
      </div>
      <GraphicalDesktop key={model} model={model} ar={ar} />
    </div>
  );
}
