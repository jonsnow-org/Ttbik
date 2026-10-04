"use client";
import Link from "next/link";
import { Bar, Top, ton, useApi } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import Features from "@/components/Features";

type Season = { configured: boolean; deployed?: boolean; status?: number; sold?: number; size: number; prices?: { common: number; rare: number; ticket: number } };

export default function Home() {
  const { t } = useI18n();
  const { data: s } = useApi<Season>("/api/season", 15000);
  const live = s?.configured && s.deployed && s.status === 1;
  const steps = [["home.s1t", "home.s1d"], ["home.s2t", "home.s2d"], ["home.s3t", "home.s3d"]] as const;
  const why = [["home.w1h", "home.w1d"], ["home.w2h", "home.w2d"], ["home.w3h", "home.w3d"], ["home.w4h", "home.w4d"]] as const;
  return (
    <>
      <Top />
      <div className="card hero">
        <img src="/api/img/18262.svg?t=2&g=3&h=7&live=1" alt="Athar" />
        <h1>{t("home.title")}</h1>
        <p className="muted">{t("home.sub")}</p>
        <Link href="/date" className="btn gold">{t("home.cta")}</Link>
      </div>

      <Features />

      <div className="card">
        <div className="row between"><h3>{t("home.season")}</h3><span className={`badge ${live ? "t1" : "t0"}`}>{live ? t("home.open") : t("home.soon")}</span></div>
        <p className="muted">{s ? t("home.size", { n: s.size }) : "…"}</p>
        <Bar value={s && s.sold != null ? s.sold / s.size : 0} />
        <div className="row" style={{ marginTop: 14 }}>
          <div className="stat"><b>{s?.sold ?? 0}</b><span>{t("home.minted")}</span></div>
          <div className="stat"><b>{ton(s?.prices?.common)}</b><span>{t("home.pcommon")}</span></div>
          <div className="stat"><b>{ton(s?.prices?.rare)}</b><span>{t("home.prare")}</span></div>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>{t("home.pnote")}</p>
      </div>

      <div className="card">
        <h3>{t("home.how")}</h3>
        <div className="steps">
          {steps.map(([a, b], i) => <div className="step" key={a}><i>{i + 1}</i><div><b>{t(a)}</b><div className="muted">{t(b)}</div></div></div>)}
        </div>
      </div>

      <div className="card">
        <h3>{t("home.why")}</h3>
        {why.map(([a, b]) => <div className="note" key={a}><b>{t(a)}:</b> {t(b)}</div>)}
      </div>

      <div className="row" style={{ gap: 10 }}>
        <Link href="/mystery" className="btn ghost">{t("home.mbtn")}</Link>
        <Link href="/auctions" className="btn ghost">{t("home.abtn")}</Link>
        <Link href="/board" className="btn ghost">{t("board.title")}</Link>
      </div>
      <p className="muted" style={{ textAlign: "center", marginTop: 18 }}>{t("brand.by")}</p>
    </>
  );
}
