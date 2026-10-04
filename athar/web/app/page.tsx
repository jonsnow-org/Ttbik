"use client";
import Link from "next/link";
import { Bar, Top, ton, useApi } from "@/components/ui";

type Season = { configured: boolean; deployed?: boolean; status?: number; sold?: number; size: number; name: string; prices?: { common: number; rare: number; ticket: number }; pool: { mythic: number; rare: number; common: number } };

export default function Home() {
  const { data: s } = useApi<Season>("/api/season", 15000);
  const live = s?.configured && s.deployed && s.status === 1;
  return (
    <>
      <Top />
      <div className="card hero">
        <img src="/api/img/18262.svg?t=2&g=3&h=7" alt="أثر" />
        <h1>لكل يوم أثر. واليوم الذي يخصّك لك وحدك.</h1>
        <p className="muted">رمز واحد فقط لكل تاريخ بين 1950 و2049. يحفظ من امتلكه وما كتبوه، ويكبر شكله كلما احتُفظ به.</p>
        <Link href="/date" className="btn gold">ابحث عن تاريخك</Link>
      </div>

      <div className="card">
        <div className="row between"><h3>{s?.name ?? "الموسم الأول"}</h3><span className={`badge ${live ? "t1" : "t0"}`}>{live ? "مفتوح الآن" : "قريباً"}</span></div>
        <p className="muted">{s ? `${s.size.toLocaleString("ar")} تاريخاً في هذا الموسم` : "…"}</p>
        <Bar value={s && s.sold != null ? s.sold / s.size : 0} />
        <div className="row" style={{ marginTop: 14 }}>
          <div className="stat"><b>{s?.sold ?? 0}</b><span>مُصكوك</span></div>
          <div className="stat"><b>{ton(s?.prices?.common)}</b><span>سعر العادي الآن</span></div>
          <div className="stat"><b>{ton(s?.prices?.rare)}</b><span>سعر النادر الآن</span></div>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>الأسعار تتحرك وحدها: ترتفع مع كل عملية شراء وتنخفض عندما يهدأ الطلب. اشترِ مبكراً.</p>
      </div>

      <div className="card">
        <h3>كيف يعمل؟</h3>
        <div className="steps">
          <div className="step"><i>1</i><div><b>اختر تاريخك</b><div className="muted">ميلادك، زواجك، أو يوم تحبه.</div></div></div>
          <div className="step"><i>2</i><div><b>اصنع أثرك</b><div className="muted">تدفع من محفظتك مباشرة. لا حساب ولا وسيط.</div></div></div>
          <div className="step"><i>3</i><div><b>اكتب ذاكرتك</b><div className="muted">انقش سطراً يبقى مع الرمز للأبد، ومن بعدك يقرؤه.</div></div></div>
        </div>
      </div>

      <div className="card">
        <h3>ما الذي يجعله مختلفاً؟</h3>
        <div className="note"><b>ذاكرة:</b> كل من امتلك الرمز يترك فيه أثراً مكتوباً.</div>
        <div className="note"><b>ينضج:</b> يتغير شكله مع طول الاحتفاظ به، وأي نقل يعيد العدّاد.</div>
        <div className="note"><b>ندرة حقيقية:</b> قواعد الندرة معلنة ومكتوبة في العقد. لا أحد يعرف ولا يغيّر شيئاً بعد النشر.</div>
        <div className="note"><b>عدالة:</b> صناديق الغموض تُكشف بعشوائية لا يعرفها حتى نحن.</div>
      </div>

      <div className="row" style={{ gap: 10 }}>
        <Link href="/mystery" className="btn ghost">صندوق الغموض</Link>
        <Link href="/auctions" className="btn ghost">المزادات الأسطورية</Link>
      </div>
      <p className="muted" style={{ textAlign: "center", marginTop: 18 }}>من شام AI</p>
    </>
  );
}
