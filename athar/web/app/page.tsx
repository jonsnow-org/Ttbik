"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Top, KindBadge, ton, useApi } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import Features from "@/components/Features";
import { DIRECT_KINDS } from "@/lib/kinds";
import { indexOf } from "@/lib/dates";

type Season = { specials?: number; configured: boolean; deployed?: boolean; status?: number; sold?: number; kinds?: { kind: number; price: number | null; cap: number; issued: number }[] };

export default function Home() {
  const { t, dateLabel } = useI18n();
  // "Today" is the visitor's own calendar day, known only in the browser. The page is prerendered at build time, so reading the clock during render
  // gave the server HTML the build day and made React throw hydration error #418 on every later day; set it after mount instead.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  const todayIdx = now ? indexOf(now.getFullYear(), now.getMonth() + 1, now.getDate()) : null;
  const { data: s } = useApi<Season>("/api/season", 15000);
  const live = s?.configured && s.deployed && s.status === 1;
  const steps = [["home.s1t", "home.s1d"], ["home.s2t", "home.s2d"], ["home.s3t", "home.s3d"]] as const;
  const why = [["home.w1h", "home.w1d"], ["home.w2h", "home.w2d"], ["home.w3h", "home.w3d"], ["home.w4h", "home.w4d"]] as const;
  return (
    <>
      <Top />
      <div className="card hero">
        <img src="/api/img/149334.svg?g=3&h=7&live=1" alt="Athar" />
        <h1>{t("home.title")}</h1>
        <p className="muted">{t("home.sub")}</p>
        <Link href="/date" className="btn gold">{t("home.cta")}</Link>
        <p style={{ marginTop: 10 }}><Link href="/market" className="muted" style={{ textDecoration: "underline" }}>{t("home.market")}</Link></p>
      </div>

      <div className="card" style={{ textAlign: "center" }}>
        <h3>{t("home.today")}</h3>
        {todayIdx !== null && <img src={`/api/img/${todayIdx}.svg?live=1`} alt="" style={{ width: "50%", maxWidth: 200, borderRadius: 20, margin: "8px auto", display: "block" }} />}
        <p className="muted" style={{ minHeight: "1.4em" }}>{now ? dateLabel(now.getFullYear(), now.getMonth() + 1, now.getDate()) : ""}</p>
        <Link href={todayIdx !== null ? `/date?i=${todayIdx}` : "/date"} className="btn gold">{t("home.todayCta")}</Link>
      </div>

      <Features />

      <div className="card">
        <div className="row between"><h3>{t("home.season")}</h3><span className={`badge ${live ? "t1" : "t0"}`}>{live ? t("home.open") : t("home.soon")}</span></div>
        <p className="muted">{s?.kinds ? t("home.minted") + ": " + (s.sold ?? 0) : "…"}</p>
        <div className="kinds">
          {DIRECT_KINDS.map((k) => { const kr = s?.kinds?.[k]; return (
            <div className="kindcard" key={k}>
              <KindBadge kind={k} />
              <b>{ton(kr?.price)}</b>
              {kr && kr.cap > 0 && <span>{t("kind.left", { n: Math.max(0, kr.cap - kr.issued), c: kr.cap })}</span>}
            </div>
          ); })}
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
