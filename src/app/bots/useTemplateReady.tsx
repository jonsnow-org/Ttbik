"use client";

import { useEffect, useState } from "react";

export const GATED_TEMPLATES = ["QUIZ_BOT", "STREAK_BOT", "PRAYER_BOT", "CAPSULE_BOT"] as const;
export type GatedTemplate = (typeof GATED_TEMPLATES)[number];
export type ReadyEntry = { ready: boolean; migrationFile: string | null; missingTables?: string[] };

const LABELS: Record<GatedTemplate, string> = {
  QUIZ_BOT: "اختبارات الشخصية",
  STREAK_BOT: "السلاسل اليومية",
  PRAYER_BOT: "مواقيت الصلاة",
  CAPSULE_BOT: "كبسولة الزمن",
};

/** Fetch /api/bots/template-ready and expose gated <option>s + Arabic migration hints. */
export function useTemplateReady(isOwner: boolean, setTemplate: (fn: (prev: string) => string) => void) {
  const [templateReady, setTemplateReady] = useState<Partial<Record<GatedTemplate, ReadyEntry>> | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bots/template-ready", { credentials: "include", signal: AbortSignal.timeout(12_000) });
        if (!res.ok) {
          if (!cancelled) setTemplateReady({});
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (!data?.templates) {
          setTemplateReady({});
          return;
        }
        const next: Partial<Record<GatedTemplate, ReadyEntry>> = {};
        for (const id of GATED_TEMPLATES) {
          const row = data.templates[id];
          if (row) {
            next[id] = {
              ready: !!row.ready,
              migrationFile: row.migrationFile || data.migrations?.[id] || null,
              missingTables: row.missingTables,
            };
          }
        }
        setTemplateReady(next);
        setTemplate((prev) => {
          if (
            GATED_TEMPLATES.includes(prev as GatedTemplate) &&
            next[prev as GatedTemplate] &&
            !next[prev as GatedTemplate]!.ready
          ) {
            return "AD_BOT";
          }
          return prev;
        });
      } catch {
        if (!cancelled) setTemplateReady({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, setTemplate]);

  function gatedOption(id: GatedTemplate, label: string) {
    if (!isOwner) return null;
    const info = templateReady?.[id];
    if (templateReady && info && !info.ready) return null;
    const loading = isOwner && templateReady === null;
    return (
      <option key={id} value={id} disabled={loading}>
        {label}
        {loading ? " …" : ""}
      </option>
    );
  }

  const notReadyHints =
    isOwner && templateReady
      ? GATED_TEMPLATES.filter((id) => templateReady[id] && !templateReady[id]!.ready).map((id) => ({
          id,
          label: LABELS[id],
          file: templateReady[id]!.migrationFile || "?",
        }))
      : [];

  return { gatedOption, notReadyHints };
}
