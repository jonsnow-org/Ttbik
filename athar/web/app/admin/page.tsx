"use client";
import { Address } from "@ton/core";
import { TonConnectButton, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToastHost, useToast } from "@/components/ui";
import { auctionMsgs, chunk, commitOf, launchSteps, newSecret, pauseMsg, revealMsg, sweepMsg } from "@/lib/launch";
import { buildPool, SEASON_1, seasonSize } from "@/lib/seasons";
import { SITE_URL } from "@/lib/config";
import { ruleTier } from "@/lib/dates";
import { tx } from "@/lib/tx";

type St = { siteUrl: string; envAdmin: string; collection: string; minter: string; collectionActive: boolean; minterActive: boolean; balance: number | null; payout?: string | null; minted?: number; status?: number; soldCount?: number; priceCommon?: number; priceRare?: number; poolSize?: number; poolLoaded?: number; ticketsSold?: number; revealed?: boolean; revealAt?: number; commitSet?: boolean };
const KEY = "athar_secret_s1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Admin() {
  const address = useTonAddress();
  const [ui] = useTonConnectUI();
  const toast = useToast();
  const [st, setSt] = useState<St | null>(null);
  const [payout, setPayout] = useState("");
  const [startAt, setStartAt] = useState(() => { const d = new Date(Date.now() + 20 * 60000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const [maxMsgs, setMaxMsgs] = useState(4);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [secretShown, setSecretShown] = useState("");
  const stRef = useRef<St | null>(null);
  stRef.current = st;

  const refresh = useCallback(async () => {
    if (!address) return null;
    const r = await fetch(`/api/admin/state?admin=${encodeURIComponent(address)}`, { cache: "no-store" });
    const j = await r.json(); setSt(j); return j as St;
  }, [address]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 20000); return () => clearInterval(t); }, [refresh]);

  const payoutOk = useMemo(() => { try { Address.parse(payout.trim()); return true; } catch { return false; } }, [payout]);
  const size = seasonSize(SEASON_1);
  const pool = useMemo(() => buildPool(SEASON_1), []);
  const mythic = useMemo(() => { let n = 0; for (let i = SEASON_1.rangeStart; i <= SEASON_1.rangeEnd; i++) if (ruleTier(i) === 2) n++; return n; }, []);
  const checks = [
    { ok: !!address, t: "المحفظة مربوطة (هي محفظة الإدارة)" },
    { ok: SITE_URL.startsWith("https://"), t: "عنوان الموقع مضبوط وبـHTTPS" },
    { ok: !!st && (!st.envAdmin || st.envAdmin === address || (() => { try { return Address.parse(st.envAdmin).equals(Address.parse(address)); } catch { return false; } })()), t: "محفظة الإدارة تطابق إعداد الموقع" },
    { ok: payoutOk, t: "عنوان استلام الأرباح صحيح" },
    { ok: !!st && (st.balance ?? 0) >= 2.5 || !!st?.collectionActive, t: "رصيد الإدارة 2.5 TON على الأقل للنشر" },
  ];
  const ready = checks.every((c) => c.ok);

  const push = (m: string) => setLog((l) => [...l, m]);
  async function waitFor(pred: (s: St) => boolean, label: string) {
    for (let i = 0; i < 40; i++) { await sleep(5000); const s = await refresh(); if (s && pred(s)) return true; }
    push(`⏳ لم يظهر "${label}" بعد على الشبكة. اضغط «تابع الإطلاق» بعد دقيقة.`); return false;
  }
  async function sendGroups(msgs: Parameters<typeof tx>[0]) {
    for (const g of chunk(msgs, maxMsgs)) await ui.sendTransaction(tx(g));
  }

  async function launch() {
    setRunning(true); setLog([]);
    try {
      let secretHex = localStorage.getItem(KEY);
      let secret: bigint;
      if (secretHex) secret = BigInt("0x" + secretHex);
      else {
        secret = newSecret(); secretHex = secret.toString(16).padStart(64, "0"); localStorage.setItem(KEY, secretHex);
        const blob = new Blob([JSON.stringify({ season: 1, secret: secretHex, note: "احتفظ بهذا الملف. بدونه تكشف صناديق الغموض بعد 3 أيام تلقائياً بالطريقة العامة." }, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "athar-season1-secret.json"; a.click();
      }
      setSecretShown(secretHex);
      const commit = await commitOf(secret);
      const startTs = Math.floor(new Date(startAt).getTime() / 1000);
      const revealAt = startTs + SEASON_1.mysteryDays * 86400;
      const { steps } = await launchSteps(Address.parse(address), Address.parse(payout.trim()), SEASON_1, { startAt: startTs, commit, revealAt });
      let cur = (await refresh()) as St;
      const done = [
        (s: St) => s.collectionActive && s.minterActive,
        (s: St) => (s.priceRare ?? 0) > 0 && !!s.commitSet,
        (s: St) => (s.poolSize ?? 0) >= pool.dates.length && s.poolLoaded === s.poolSize,
        (s: St) => s.status === 1,
      ];
      for (let i = 0; i < steps.length; i++) {
        if (done[i](cur)) { push(`✅ ${steps[i].title} (منجز)`); continue; }
        push(`⏳ ${steps[i].title}: أكّد في محفظتك...`);
        await sendGroups(steps[i].messages);
        push(`⌛ بانتظار ظهورها على الشبكة...`);
        if (!(await waitFor(done[i], steps[i].title))) return;
        cur = (stRef.current as St);
        push(`✅ ${steps[i].title}`);
      }
      push("🎉 تم النشر. سيبدأ البيع في الموعد الذي حددته.");
      toast("تم نشر الموسم الأول");
    } catch (e) { push("⚠️ توقفت العملية (ألغيتَ أو رُفضت من المحفظة). يمكنك المتابعة من حيث توقفت."); }
    finally { setRunning(false); refresh(); }
  }

  const launched = st?.status === 1 || st?.status === 2;
  const secretLocal = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
  async function run(fn: () => Promise<void>) { setRunning(true); try { await fn(); toast("تم الإرسال"); } catch { toast("لم تكتمل العملية"); } finally { setRunning(false); setTimeout(refresh, 8000); } }

  return (
    <>
      <div className="top"><span className="logo">أثر<b>.</b> إدارة</span><TonConnectButton /></div>
      <div className="card">
        <h3>الموسم الأول</h3>
        <div className="kv"><span>عدد التواريخ</span><span>{size.toLocaleString("ar")}</span></div>
        <div className="kv"><span>أسطوري (مزادات)</span><span>{mythic - pool.composition.mythic + SEASON_1.specials.filter((s) => s.tier === 2).length}</span></div>
        <div className="kv"><span>صناديق الغموض</span><span>{pool.dates.length} (أسطوري {pool.composition.mythic} · نادر {pool.composition.rare} · عادي {pool.composition.common})</span></div>
        <div className="kv"><span>تواريخ تاريخية خاصة</span><span>{SEASON_1.specials.length}</span></div>
        <div className="kv"><span>أسعار البدء</span><span>عادي {SEASON_1.common.start} · نادر {SEASON_1.rare.start} · غموض {SEASON_1.ticket.start}</span></div>
        <div className="kv"><span>سقف الشراء اليومي للمحفظة</span><span>{SEASON_1.walletDailyCap}</span></div>
      </div>

      {!launched && (
        <div className="card">
          <h3>الإطلاق</h3>
          <div className="gap">
            <label className="muted">عنوان استلام الأرباح (عام، ولا تضع أي كلمات سرية هنا)</label>
            <input type="text" dir="ltr" placeholder="UQ…" value={payout} onChange={(e) => setPayout(e.target.value)} />
            <label className="muted">موعد فتح البيع</label>
            <input type="datetime-local" dir="ltr" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            <label className="muted">أقصى عدد رسائل في تأكيد واحد (4 للمحافظ القديمة، 255 للحديثة)</label>
            <select value={maxMsgs} onChange={(e) => setMaxMsgs(Number(e.target.value))}><option value={4}>4</option><option value={1}>1</option><option value={20}>20</option><option value={255}>255</option></select>
          </div>
          <div className="steps" style={{ marginTop: 12 }}>{checks.map((c, i) => <div key={i} className={`step ${c.ok ? "done" : ""}`}><i>{c.ok ? "✓" : "•"}</i><span>{c.t}</span></div>)}</div>
          <button className="btn gold" style={{ marginTop: 14 }} disabled={!ready || running} onClick={launch}>{st?.collectionActive ? "تابع الإطلاق" : "أطلق الموسم الأول"}</button>
          <p className="muted">سيطلب منك المحفظة الدفع والتأكيد بضع مرات (حسب أقصى عدد رسائل). التكلفة التقريبية 2–3 TON، أغلبها يعود. لا يُحفظ أي مفتاح هنا.</p>
          {log.map((l, i) => <div className="note" key={i}>{l}</div>)}
          {secretShown && <div className="note">سرّ الكشف (احفظه). حُمّل ملف نسخة احتياطية:<div className="mono">{secretShown}</div></div>}
        </div>
      )}

      {st && (
        <div className="card">
          <h3>الحالة</h3>
          <div className="kv"><span>المجموعة</span><span className="mono">{st.collection}</span></div>
          <div className="kv"><span>البائع</span><span className="mono">{st.minter}</span></div>
          <div className="kv"><span>منشورة؟</span><span>{st.collectionActive && st.minterActive ? "نعم" : "لا"}</span></div>
          <div className="kv"><span>حالة البيع</span><span>{st.status === 1 ? "مفتوح" : st.status === 2 ? "متوقف" : "مسودة"}</span></div>
          <div className="kv"><span>المُصكوك</span><span>{st.soldCount ?? 0}</span></div>
          <div className="kv"><span>تذاكر الغموض</span><span>{st.ticketsSold ?? 0} / {st.poolSize ?? 0}</span></div>
          <div className="kv"><span>رصيد الإدارة</span><span>{st.balance != null ? st.balance.toFixed(2) : "—"} TON</span></div>
          <p className="muted">الأرباح تصل إلى عنوان الاستلام فور كل عملية بيع، ولا تُحفظ في العقود.</p>
        </div>
      )}

      {launched && st && (
        <div className="card">
          <h3>أدوات ما بعد الإطلاق</h3>
          <div className="gap">
            <button className="btn" disabled={running} onClick={() => run(async () => { for (const g of chunk(auctionMsgs(st.minter, SEASON_1), maxMsgs)) await ui.sendTransaction(tx(g)); })}>ابدأ مزادات التواريخ الأسطورية</button>
            <button className="btn ghost" disabled={running} onClick={() => run(async () => { await ui.sendTransaction(tx([pauseMsg(st.minter, st.status === 1)])); })}>{st.status === 1 ? "أوقف البيع مؤقتاً" : "استأنف البيع"}</button>
            <button className="btn gold" disabled={running || !secretLocal || (st.revealAt ?? 0) * 1000 > Date.now() || !!st.revealed} onClick={() => run(async () => { await ui.sendTransaction(tx([revealMsg(st.minter, BigInt("0x" + secretLocal!))])); })}>
              {st.revealed ? "تم كشف الصناديق" : (st.revealAt ?? 0) * 1000 > Date.now() ? `كشف الصناديق (يُتاح ${new Date((st.revealAt ?? 0) * 1000).toLocaleString("ar")})` : "اكشف الصناديق الآن"}
            </button>
            <button className="btn ghost" disabled={running} onClick={() => run(async () => { await ui.sendTransaction(tx([sweepMsg(st.minter)])); })}>سحب بقايا الغاز من البائع</button>
          </div>
          {!secretLocal && <p className="muted bad">سرّ الكشف غير موجود في هذا المتصفح. إن لم تكشف بنفسك، يكشف أي شخص بعد 3 أيام من الموعد بالطريقة العامة.</p>}
        </div>
      )}
    </>
  );
}

export default function Page() {
  return <Admin />;
}
