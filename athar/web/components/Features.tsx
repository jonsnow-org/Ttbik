"use client";
import { useI18n } from "@/lib/i18n";

/** What a token does, in plain words: shown where a buyer decides (home, date, token pages). */
export default function Features({ supply, event }: { supply?: number; event?: string | null }) {
  const { t } = useI18n();
  const rows = ["f1", "f2", "f3", "f4", "f5", "f6"] as const;
  return (
    <div className="card">
      <h3>{t("feat.title")}</h3>
      <div className="steps">
        {event && <div className="step"><i>★</i><div><b>{t("feat.event")}</b><div className="muted">{event}</div></div></div>}
        {supply ? <div className="step"><i>#</i><div><b>{t("feat.supply", { n: supply })}</b><div className="muted">{t("feat.supplyD")}</div></div></div> : null}
        {rows.map((k) => <div className="step" key={k}><i>{t(`feat.${k}i` as "feat.f1i")}</i><div><b>{t(`feat.${k}` as "feat.f1")}</b><div className="muted">{t(`feat.${k}d` as "feat.f1")}</div></div></div>)}
      </div>
    </div>
  );
}
