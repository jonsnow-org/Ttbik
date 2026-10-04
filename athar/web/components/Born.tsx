"use client";
import { useApi } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

type Row = { name: string; about: string; year: number };
type Data = { exact: Row[]; other: Row[]; source: string };

/** Names and one-line descriptions only (public facts, no pictures). */
export default function Born({ index }: { index: number }) {
  const { t, lang } = useI18n();
  const { data } = useApi<Data>(`/api/born?index=${index}&lang=${lang}`);
  const { data: sp } = useApi<{ special: { ar: string; en: string } | null }>(`/api/special?index=${index}`);
  const note = sp?.special ? (lang === "ar" ? sp.special.ar : sp.special.en) : null;
  if (!data) return null;
  const rows = data.exact.length ? data.exact : data.other;
  const special = note ? <div className="card"><h3>{t("special.title")}</h3><div className="note">{note}</div></div> : null;
  if (!rows.length) return <>{special}<div className="card"><h3>{t("born.title")}</h3><p className="muted">{t("born.none")}</p></div></>;
  return (
    <>{special}<div className="card">
      <h3>{t("born.title")}</h3>
      <p className="muted">{data.exact.length ? t("born.exact") : t("born.other")}</p>
      {rows.map((r, i) => <div className="kv" key={i}><span>{r.name}{r.about ? ` · ${r.about}` : ""}</span><span>{r.year}</span></div>)}
      <p className="muted"><a href={data.source} target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>{t("born.source")}</a></p>
    </div></>
  );
}
