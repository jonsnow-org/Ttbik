"use client";
import { Address } from "@ton/core";
import { TonConnectButton, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToastHost, useToast } from "@/components/ui";
import { applyBaseUriMsg, proposeBaseUriMsg, repriceMsg, setItemFeesMsg, setPhotoFeesMsg, auctionMsgs, chunk, commitOf, launchSteps, newSecret, pauseMsg, revealMsg, specialAuctionMsg, sweepMsg } from "@/lib/launch";
import { buildPool, SEASON_1, seasonSize, specialIndex } from "@/lib/seasons";
import { compressPhoto } from "@/lib/photo";
import { waxPhoto } from "@/lib/wax";
import { ymd } from "@/lib/dates";
import { SITE_URL } from "@/lib/config";
import { ruleTier } from "@/lib/dates";
import { buyMsg, tx } from "@/lib/tx";

type St = { siteUrl: string; envAdmin: string; collection: string; minter: string; collectionActive: boolean; minterActive: boolean; balance: number | null; payout?: string | null; minted?: number; status?: number; soldCount?: number; priceCommon?: number; priceRare?: number; poolSize?: number; poolLoaded?: number; ticketsSold?: number; revealed?: boolean; revealAt?: number; commitSet?: boolean };
const KEY = "athar_secret_s1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function AdminPanel() {
  const address = useTonAddress();
  const [ui] = useTonConnectUI();
  const toast = useToast();
  useEffect(() => { document.body.dataset.admin = "1"; return () => { delete document.body.dataset.admin; }; }, []);
  const [st, setSt] = useState<St | null>(null);
  const [payout, setPayout] = useState(() => { try { return localStorage.getItem("athar_payout") || ""; } catch { return ""; } });   // survives a reload or a reconnect
  useEffect(() => { try { localStorage.setItem("athar_payout", payout); } catch { /* private mode */ } }, [payout]);
  type Ov = { deployed?: boolean; minted?: number; size?: number; byTier?: number[]; holders?: number; top?: { owner: string; tokens: number }[]; revenue?: number; salesToday?: number; recent?: { at: number; ton: number }[]; revenueNote?: string; payout?: string; mine?: number[] };
  const [ov, setOv] = useState<Ov | null>(null);
  const [startAt, setStartAt] = useState(() => { const d = new Date(Date.now() + 20 * 60000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const [maxMsgs, setMaxMsgs] = useState(4);
  const maxMsgsPicked = useRef(false);   // once the owner picks a number, the wallet's own value no longer overrides it
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [secretShown, setSecretShown] = useState("");
  const [pasted, setPasted] = useState("");
  const [hiddenRows, setHiddenRows] = useState<{ kind: string; key: string; at: number; note: string }[]>([]);
  const [hKind, setHKind] = useState<"token" | "ref">("token");
  const [hKey, setHKey] = useState("");
  const [hNote, setHNote] = useState("");
  const adm = () => ({ "x-athar-adm": window.location.pathname.slice(1), "content-type": "application/json" });
  const loadHidden = useCallback(async () => { const r = await fetch("/api/admin/hide", { headers: adm(), cache: "no-store" }); if (r.ok) setHiddenRows((await r.json()).rows); }, []);
  useEffect(() => { loadHidden(); }, [loadHidden]);
  async function hideAct(action: "hide" | "unhide", kind = hKind, key = hKey) {
    const r = await fetch("/api/admin/hide", { method: "POST", headers: adm(), body: JSON.stringify({ kind, key, note: hNote, action }) });
    if (r.ok) { setHiddenRows((await r.json()).rows); if (action === "hide") { setHKey(""); setHNote(""); } } else toast("مفتاح غير صالح");
  }
  // special (gold) dates: the admin picks the picture, it gets the waxed-gold treatment, is shown for approval, stored for good,
  // and only then is the long auction started with that picture attached
  const [newBase, setNewBase] = useState("");
  const [feeE, setFeeE] = useState("0.1"), [feeM, setFeeM] = useState("0.1"), [feeC, setFeeC] = useState("0.5");
  const [feeP, setFeeP] = useState("0.15"), [feeS, setFeeS] = useState("0.3");
  const [bandTier, setBandTier] = useState(0), [bandFloor, setBandFloor] = useState("0.25"), [bandCap, setBandCap] = useState("8");
  const [feeSeen, setFeeSeen] = useState<{ itemFees?: { engrave: number; media: number; change: number }; fees?: { photo: number; silver: number }; prices?: { common: number; rare: number; ticket: number } } | null>(null);
  useEffect(() => { fetch("/api/season", { cache: "no-store" }).then((r) => r.json()).then((j) => { setFeeSeen(j); if (j?.fees) { setFeeP(String(j.fees.photo)); setFeeS(String(j.fees.silver)); } if (j?.itemFees) { setFeeE(String(j.itemFees.engrave)); setFeeM(String(j.itemFees.media)); setFeeC(String(j.itemFees.change)); } }).catch(() => undefined); }, []);
  const [spIdx, setSpIdx] = useState(() => specialIndex(SEASON_1.specials[0]));
  const [spPhoto, setSpPhoto] = useState<string | null>(null);
  const [spSvg, setSpSvg] = useState("");
  const [spReserve, setSpReserve] = useState(SEASON_1.specialReserve);
  const [spDays, setSpDays] = useState(String(SEASON_1.specialDays));
  const [spBusy, setSpBusy] = useState(false);
  const spPick = async (f: File | undefined) => {
    if (!f) return;
    setSpBusy(true); setSpSvg("");
    try {
      const r = await compressPhoto(f);
      const gold = r ? await waxPhoto(r.uri, "gold") : null;
      if (!gold) { toast("تعذّر تجهيز الصورة"); return; }
      setSpPhoto(gold);
      const pr = await fetch("/api/admin/special", { method: "POST", headers: adm(), body: JSON.stringify({ index: spIdx, photo: gold, preview: true }) });
      const pj = await pr.json(); if (pr.ok) setSpSvg(pj.svg); else toast(pj.error || "فشلت المعاينة");
    } catch { toast("تعذّر تجهيز الصورة"); } finally { setSpBusy(false); }
  };
  const spGen = async () => {
    setSpBusy(true); setSpSvg("");
    try {
      const pr = await fetch("/api/admin/special", { method: "POST", headers: adm(), body: JSON.stringify({ index: spIdx, auto: true, preview: true }) });
      const pj = await pr.json(); if (!pr.ok) { toast(pj.error || "تعذّر رسم الصورة"); return; }
      setSpPhoto("auto"); setSpSvg(pj.svg);
    } catch { toast("تعذّر رسم الصورة"); } finally { setSpBusy(false); }
  };
  // every special date at once: draw, store for good, then send the long auctions in batches
  const spAll = () => run(async () => {
    const msgs = [];
    for (const x of SEASON_1.specials) {
      const i = specialIndex(x);
      const info = await (await fetch(`/api/date/${i}`, { cache: "no-store" })).json().catch(() => null);
      if (info?.taken || info?.auction?.live || (info?.auction && info.auction.highBid > 0)) continue;       // already sold or running
      const r = await fetch("/api/admin/special", { method: "POST", headers: adm(), body: JSON.stringify({ index: i, auto: true }) });
      if (r.status === 400) continue;      // no drawing of ours for this date
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "store failed");
      msgs.push(specialAuctionMsg(st!.minter, SEASON_1, i, BigInt(j.ref), spReserve, Number(spDays)));
    }
    for (const g of chunk(msgs, maxMsgs)) await ui.sendTransaction(tx(g));
  });
  const spStart = () => run(async () => {
    const r = await fetch("/api/admin/special", { method: "POST", headers: adm(), body: JSON.stringify(spPhoto === "auto" ? { index: spIdx, auto: true } : { index: spIdx, photo: spPhoto }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "store failed");
    await ui.sendTransaction(tx([specialAuctionMsg(st!.minter, SEASON_1, spIdx, BigInt(j.ref), spReserve, Number(spDays))]));
    setSpPhoto(null); setSpSvg("");
  });
  // The owner's own gold-wax mint: any direct-sale date, a photo given the gold-wax treatment, no picture fee (the owner pays none).
  const [gmY, setGmY] = useState(2003), [gmM, setGmM] = useState(3), [gmD, setGmD] = useState(14), [gmTo, setGmTo] = useState("");
  const [gmPhoto, setGmPhoto] = useState<string | null>(null), [gmSvg, setGmSvg] = useState(""), [gmBusy, setGmBusy] = useState(false);
  const gmIndex = () => { const i = Date.UTC(gmY, gmM - 1, Math.min(gmD, new Date(Date.UTC(gmY, gmM, 0)).getUTCDate())) / 86400000 - Date.UTC(1950, 0, 1) / 86400000; return i; };
  const gmPreview = async (photo: string) => {
    const r = await fetch("/api/admin/goldmint", { method: "POST", headers: adm(), body: JSON.stringify({ index: gmIndex(), photo, preview: true }) });
    const j = await r.json(); if (!r.ok) { toast(j.error || "فشلت المعاينة"); return false; }
    setGmSvg(j.svg); return true;
  };
  const gmPick = async (f: File | undefined) => {
    if (!f) return;
    setGmBusy(true); setGmSvg(""); setGmPhoto(null);
    try {
      const c = await compressPhoto(f); const gold = c ? await waxPhoto(c.uri, "gold") : null;
      if (!gold) { toast("تعذّر تجهيز الصورة"); return; }
      if (await gmPreview(gold)) setGmPhoto(gold);
    } catch { toast("تعذّر تجهيز الصورة"); } finally { setGmBusy(false); }
  };
  const gmMint = () => run(async () => {
    const index = gmIndex();
    const info = await (await fetch(`/api/date/${index}`, { cache: "no-store" })).json();
    if (info.taken) throw new Error("taken");
    if (info.price == null) { toast("هذا التاريخ ليس للبيع المباشر (مزاد أو صندوق غموض أو خارج الموسم)"); throw new Error("not direct"); }
    const r = await fetch("/api/admin/goldmint", { method: "POST", headers: adm(), body: JSON.stringify({ index, photo: gmPhoto }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "store failed");
    let to: string | undefined; const t = gmTo.trim();
    if (t) { try { Address.parse(t); to = t; } catch { toast("عنوان المستلم غير صالح"); throw new Error("bad address"); } }
    await ui.sendTransaction(tx([buyMsg(st!.minter, index, info.price, to, 0, BigInt(j.ref), 0, 0)]));
    setGmPhoto(null); setGmSvg("");
  });
  const stRef = useRef<St | null>(null);
  stRef.current = st;

  const refresh = useCallback(async () => {
    if (!address) return null;
    const r = await fetch(`/api/admin/state?admin=${encodeURIComponent(address)}`, { cache: "no-store", headers: { "x-athar-adm": window.location.pathname.slice(1) } });
    const j = await r.json(); setSt(j); return j as St;
  }, [address]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 20000); return () => clearInterval(t); }, [refresh]);

  // the wallet says how many messages it can sign at once: use it, so a modern wallet needs only a few confirmations
  useEffect(() => {
    const f: any = (ui.wallet as any)?.device?.features?.find?.((x: any) => x?.name === "SendTransaction");
    const n = Number(f?.maxMessages);
    if (n > 0 && !maxMsgsPicked.current) setMaxMsgs(Math.min(255, n));
  }, [ui.wallet]);

  const payoutOk = useMemo(() => { try { Address.parse(payout.trim()); return true; } catch { return false; } }, [payout]);
  const size = seasonSize(SEASON_1);
  const pool = useMemo(() => buildPool(SEASON_1), []);
  const mythic = useMemo(() => { let n = 0; for (let i = SEASON_1.rangeStart; i <= SEASON_1.rangeEnd; i++) if (ruleTier(i) === 2) n++; return n; }, []);
  const checks = [
    { ok: !!address, t: "المحفظة مربوطة (هي محفظة الإدارة)" },
    { ok: SITE_URL.startsWith("https://"), t: "عنوان الموقع مضبوط وبـHTTPS" },
    { ok: !!st && (!st.envAdmin || st.envAdmin === address || (() => { try { return Address.parse(st.envAdmin).equals(Address.parse(address)); } catch { return false; } })()), t: "محفظة الإدارة تطابق إعداد الموقع" },
    { ok: payoutOk, t: "عنوان استلام الأرباح صحيح" },
    { ok: !!st && (st.balance ?? 0) >= 3.5 || !!st?.collectionActive, t: "رصيد محفظة الإدارة 3.5 Gram على الأقل (يعود منه نحو 2 Gram)" },
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
      // the first launch fixes this wallet as the management wallet (its public address only), so the app can find the contracts afterwards
      if (!st?.envAdmin) {
        const cr = await fetch("/api/admin/claim", { method: "POST", headers: adm(), body: JSON.stringify({ address }) });
        if (!cr.ok) { push("⚠️ " + ((await cr.json().catch(() => ({}))).error || "تعذّر اعتماد محفظة الإدارة")); return; }
      }
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
  useEffect(() => {
    if (!launched) return;
    const load = () => fetch("/api/admin/overview", { cache: "no-store", headers: { "x-athar-adm": window.location.pathname.slice(1) } }).then((r) => r.ok ? r.json() : null).then((j) => j && setOv(j)).catch(() => undefined);
    load(); const t = setInterval(load, 60000); return () => clearInterval(t);
  }, [launched]);
  const savedSecret = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
  const pastedClean = pasted.replace(/\s+/g, "").toLowerCase().replace(/^0x/, "");   // the secret copied from the screen wraps over two lines
  const secretLocal = savedSecret || (/^[0-9a-f]{64}$/.test(pastedClean) ? pastedClean : null);
  async function run(fn: () => Promise<void>) { setRunning(true); try { await fn(); toast("تم الإرسال"); } catch { toast("لم تكتمل العملية"); } finally { setRunning(false); setTimeout(refresh, 8000); } }

  const stranger = !!address && !!st?.envAdmin && !checks[2].ok;
  if (stranger) return (
    <>
      <div className="top"><span className="logo">أثر<b>.</b></span><TonConnectButton /></div>
      <div className="card"><p className="muted">هذه الصفحة لمحفظة الإدارة فقط.</p></div>
    </>
  );
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
            {!!address && !payout && <button className="btn ghost" onClick={() => setPayout(address)}>استخدم محفظتي هذه مؤقتاً (يمكن تغييرها لاحقاً بإشعار 48 ساعة)</button>}
            <label className="muted">موعد فتح البيع</label>
            <input type="datetime-local" dir="ltr" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            <label className="muted">أقصى عدد رسائل في تأكيد واحد (4 للمحافظ القديمة، 255 للحديثة)</label>
            <select value={maxMsgs} onChange={(e) => { maxMsgsPicked.current = true; setMaxMsgs(Number(e.target.value)); }}><option value={4}>4</option><option value={1}>1</option><option value={20}>20</option><option value={255}>255</option></select>
          </div>
          <div className="steps" style={{ marginTop: 12 }}>{checks.map((c, i) => <div key={i} className={`step ${c.ok ? "done" : ""}`}><i>{c.ok ? "✓" : "•"}</i><span>{c.t}</span></div>)}</div>
          <button className="btn gold" style={{ marginTop: 14 }} disabled={!ready || running} onClick={launch}>{st?.collectionActive ? "تابع الإطلاق" : "أطلق الموسم الأول"}</button>
          <p className="muted">سيطلب منك المحفظة الدفع والتأكيد بضع مرات (حسب أقصى عدد رسائل). يلزم نحو 3.5 Gram في المحفظة، يعود منها نحو 2 Gram، فالتكلفة الفعلية قرابة 1 Gram. لا يُحفظ أي مفتاح هنا.</p>
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
          <div className="kv"><span>رصيد الإدارة</span><span>{st.balance != null ? st.balance.toFixed(2) : "—"} Gram</span></div>
          <p className="muted">الأرباح تصل إلى عنوان الاستلام فور كل عملية بيع، ولا تُحفظ في العقود.</p>
        </div>
      )}

      <div className="card">
        <h3>الإخفاء القانوني للصور</h3>
        <p className="muted">يُخفي الصورة من التطبيق ومن بيانات الرمز عند ورود أمر قانوني مثبَت. الملف الخام على Arweave لا يُحذف. بعد الإخفاء يحتاج السوق لتحديث البيانات ليظهر ذلك عنده.</p>
        <div className="gap">
          <select value={hKind} onChange={(e) => setHKind(e.target.value as "token" | "ref")}><option value="token">كل صور رمز (رقم الرمز)</option><option value="ref">ملف محدد (معرّف Arweave)</option></select>
          <input type="text" dir="ltr" placeholder={hKind === "token" ? "رقم الرمز، مثل 18262" : "معرّف Arweave من 43 حرفاً"} value={hKey} onChange={(e) => setHKey(e.target.value)} />
          <input type="text" placeholder="مرجع القضية أو الطلب (يُحفظ في السجل)" value={hNote} onChange={(e) => setHNote(e.target.value)} />
          <button className="btn" disabled={!hKey.trim()} onClick={() => hideAct("hide")}>أخفِ</button>
        </div>
        {hiddenRows.map((r) => (
          <div className="kv" key={r.kind + r.key} style={{ alignItems: "center" }}>
            <span className="mono">{r.kind === "token" ? "رمز " : "ملف "}{r.key}<br />{r.note} · {new Date(r.at * 1000).toLocaleDateString("ar")}</span>
            <button className="btn sm ghost" onClick={() => hideAct("unhide", r.kind as "token" | "ref", r.key)}>إلغاء الإخفاء</button>
          </div>
        ))}
      </div>

      {launched && ov?.deployed && (
        <div className="card">
          <h3>نظرة عامة</h3>
          <div className="kv"><span>المُصكوك</span><span>{ov.minted} / {ov.size}</span></div>
          <div className="kv"><span>عادي · نادر · أسطوري</span><span>{ov.byTier?.join(" · ")}</span></div>
          <div className="kv"><span>عدد الحاملين</span><span>{ov.holders}</span></div>
          <div className="kv"><span>وصل إلى محفظة الأرباح</span><span>{ov.revenue != null ? `${ov.revenue.toFixed(2)} Gram` : "..."}</span></div>
          <div className="kv"><span>عمليات اليوم</span><span>{ov.salesToday ?? "..."}</span></div>
          {ov.revenueNote && <p className="muted">{ov.revenueNote}</p>}
          {!!ov.recent?.length && <><b>آخر العمليات</b>{ov.recent.map((x, i) => <div className="kv" key={i}><span>{new Date(x.at * 1000).toLocaleString("ar")}</span><span>{x.ton.toFixed(2)} Gram</span></div>)}</>}
          {!!ov.top?.length && <><b>أكبر الحاملين</b>{ov.top.map((x) => <div className="kv" key={x.owner}><span className="mono">{x.owner.slice(0, 6)}…{x.owner.slice(-4)}</span><span>{x.tokens}</span></div>)}</>}
          {!!ov.mine?.length && <><b>رموزك أنت</b><div className="row" style={{ flexWrap: "wrap", gap: 8 }}>{ov.mine.map((i) => <a key={i} className="btn sm ghost" href={`/token/${i}`}>{i}</a>)}</div></>}
        </div>
      )}
      {launched && st && (
        <div className="card">
          <h3>أدوات ما بعد الإطلاق</h3>
          <div className="gap">
            <button className="btn" disabled={running} onClick={() => run(async () => { for (const g of chunk(auctionMsgs(st.minter, SEASON_1), maxMsgs)) await ui.sendTransaction(tx(g)); })}>ابدأ مزادات التواريخ الأسطورية</button>
            <div className="card" style={{ margin: 0 }}>
              <b>تاريخ خاص بصورة ذهبية (مزاد طويل)</b>
              <div className="gap">
                <select value={spIdx} onChange={(e) => { setSpIdx(Number(e.target.value)); setSpPhoto(null); setSpSvg(""); }}>
                  {SEASON_1.specials.map((x) => { const i = specialIndex(x); const q = ymd(i); return <option key={i} value={i}>{q.d}/{q.m}/{q.y} · {x.note}</option>; })}
                </select>
                <button className="btn ghost" disabled={spBusy} onClick={spGen}>ارسم الصورة تلقائياً (ملوّنة ومتحركة)</button>
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={spBusy} onChange={(e) => spPick(e.target.files?.[0])} title="أو اختر صورة بنفسك: تُحوَّل إلى ذهبي شمعي، وتنتقل زخرفة التاريخ الذهبية إلى شارة صغيرة بجوارها" />
                <div className="muted" style={{ fontSize: 12 }}>صورة شخصية بيدك (مشهور مثلاً) ← تُدمج بالذهبي الشمعي وتبقى زخرفة التاريخ شارة صغيرة تدور وتومض في أسفل اليسار.</div>
                {spSvg && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(spSvg)}`} alt="" style={{ width: "100%", maxWidth: 300, margin: "0 auto", display: "block" }} />}
                <div className="row" style={{ gap: 8 }}>
                  <input type="number" step="1" min="1" value={spReserve} onChange={(e) => setSpReserve(e.target.value)} title="سعر البداية Gram" />
                  <input type="number" step="1" min="1" max="365" value={spDays} onChange={(e) => setSpDays(e.target.value)} title="المدة بالأيام" />
                </div>
                <button className="btn gold" disabled={running || spBusy || !spPhoto} onClick={spStart}>خزّن الصورة وابدأ المزاد</button>
                <button className="btn" disabled={running || spBusy} onClick={spAll}>جهّز وابدأ كل التواريخ الخاصة ({SEASON_1.specials.length})</button>
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <h4>صكّ رمز بصورة ذهبية شمعية (لشخصية مشهورة مثلاً)</h4>
              <div className="muted" style={{ fontSize: 12 }}>أي تاريخ للبيع المباشر. أنت لا تدفع رسم الصورة. تُدمج الصورة بالذهبي الشمعي وتبقى زخرفة التاريخ شارة صغيرة. للتواريخ الأسطورية والخاصة استخدم المزاد أعلاه بسعر مرتفع.</div>
              <div className="gap">
                <div className="row" style={{ gap: 8 }}>
                  <input type="number" min={1} max={31} value={gmD} onChange={(e) => { setGmD(Number(e.target.value)); setGmPhoto(null); setGmSvg(""); }} title="اليوم" />
                  <input type="number" min={1} max={12} value={gmM} onChange={(e) => { setGmM(Number(e.target.value)); setGmPhoto(null); setGmSvg(""); }} title="الشهر" />
                  <input type="number" min={1950} max={2049} value={gmY} onChange={(e) => { setGmY(Number(e.target.value)); setGmPhoto(null); setGmSvg(""); }} title="السنة" />
                </div>
                <input type="text" dir="ltr" placeholder="عنوان المستلم (اختياري، وإلا لمحفظتك)" value={gmTo} onChange={(e) => setGmTo(e.target.value)} />
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={gmBusy} onChange={(e) => gmPick(e.target.files?.[0])} />
                {gmSvg && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(gmSvg)}`} alt="" style={{ width: "100%", maxWidth: 300, margin: "0 auto", display: "block" }} />}
                <button className="btn gold" disabled={running || gmBusy || !gmPhoto} onClick={gmMint}>خزّن الصورة واصكّ الرمز</button>
              </div>
            </div>
            <button className="btn ghost" disabled={running} onClick={() => run(async () => { await ui.sendTransaction(tx([pauseMsg(st.minter, st.status === 1)])); })}>{st.status === 1 ? "أوقف البيع مؤقتاً" : "استأنف البيع"}</button>
            <button className="btn gold" disabled={running || !secretLocal || (st.revealAt ?? 0) * 1000 > Date.now() || !!st.revealed} onClick={() => run(async () => { await ui.sendTransaction(tx([revealMsg(st.minter, BigInt("0x" + secretLocal!))])); })}>
              {st.revealed ? "تم كشف الصناديق" : (st.revealAt ?? 0) * 1000 > Date.now() ? `كشف الصناديق (يُتاح ${new Date((st.revealAt ?? 0) * 1000).toLocaleString("ar")})` : "اكشف الصناديق الآن"}
            </button>
            <div className="card" style={{ margin: 0 }}>
              <b>الأسعار تتبع السوق: رسوم النقش والصورة</b>
              <p className="muted">الحالي: نقش {feeSeen?.itemFees?.engrave ?? "…"} · أول صورة {feeSeen?.itemFees?.media ?? "…"} · تغيير الصورة {feeSeen?.itemFees?.change ?? "…"} Gram. عدّلها عندما يتغيّر سعر Gram أو التضخم. الحد الأعلى 5 Gram لكل رسم، وتغيير الصورة لا ينقص عن الأولى.</p>
              <div className="row" style={{ gap: 8 }}>
                <input type="number" step="0.01" min="0.02" value={feeE} onChange={(e) => setFeeE(e.target.value)} title="نقش" />
                <input type="number" step="0.01" min="0.02" value={feeM} onChange={(e) => setFeeM(e.target.value)} title="أول صورة" />
                <input type="number" step="0.01" min="0.02" value={feeC} onChange={(e) => setFeeC(e.target.value)} title="تغيير الصورة" />
              </div>
              <button className="btn ghost" disabled={running || Number(feeC) < Number(feeM)} onClick={() => run(async () => { await ui.sendTransaction(tx([setItemFeesMsg(st.collection, feeE, feeM, feeC)])); })}>حدّث رسوم النقش والصورة</button>
              <p className="muted">عند الشراء: صورة شخصية {feeSeen?.fees?.photo ?? "…"} · فضية {feeSeen?.fees?.silver ?? "…"} Gram (الفضية تشمل الصورة، فلا تقلّ عنها، وكلاهما حتى 2 Gram).</p>
              <div className="row" style={{ gap: 8 }}>
                <input type="number" step="0.01" min="0" value={feeP} onChange={(e) => setFeeP(e.target.value)} title="صورة شخصية" />
                <input type="number" step="0.01" min="0" value={feeS} onChange={(e) => setFeeS(e.target.value)} title="فضية" />
              </div>
              <button className="btn ghost" disabled={running || Number(feeS) < Number(feeP) || Number(feeS) > 2} onClick={() => run(async () => { await ui.sendTransaction(tx([setPhotoFeesMsg(st.minter, feeP, feeS)])); })}>حدّث رسوم الصورة عند الشراء</button>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <b>تحريك نطاق سعر فئة</b>
              <p className="muted">الأسعار الحالية: عادي {feeSeen?.prices?.common ?? "…"} · نادر {feeSeen?.prices?.rare ?? "…"} · تذكرة {feeSeen?.prices?.ticket ?? "…"} Gram. الأرضية والسقف الجديدان يسحبان السعر الحالي إلى داخلهما (الحدود 0.05 – 2000 Gram).</p>
              <select value={bandTier} onChange={(e) => setBandTier(Number(e.target.value))}><option value={0}>عادي</option><option value={1}>نادر</option><option value={3}>تذاكر الغموض</option></select>
              <div className="row" style={{ gap: 8 }}>
                <input type="number" step="0.05" min="0.05" value={bandFloor} onChange={(e) => setBandFloor(e.target.value)} title="الأرضية" />
                <input type="number" step="0.05" min="0.05" value={bandCap} onChange={(e) => setBandCap(e.target.value)} title="السقف" />
              </div>
              <button className="btn ghost" disabled={running || Number(bandFloor) < 0.05 || Number(bandFloor) > Number(bandCap)} onClick={() => run(async () => { await ui.sendTransaction(tx([repriceMsg(st.minter, bandTier, bandFloor, bandCap)])); })}>طبّق النطاق</button>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <b>مفتاح الطوارئ: نقل عنوان البيانات إلى استضافة أخرى</b>
              <p className="muted">إن سقطت الاستضافة الحالية: اكتب عنوان البديل (ينتهي بـ /api/m/) ثم «اقترح». بعد مهلة الإشعار المعلنة (48 ساعة) اضغط «طبّق».</p>
              <input type="text" dir="ltr" placeholder="https://.../api/m/" value={newBase} onChange={(e) => setNewBase(e.target.value)} />
              <div className="row" style={{ gap: 8 }}>
                <button className="btn ghost" disabled={running || !/^https:\/\/.+\/m\/$/.test(newBase.trim())} onClick={() => run(async () => { await ui.sendTransaction(tx([proposeBaseUriMsg(st.collection, newBase.trim())])); })}>اقترح العنوان</button>
                <button className="btn ghost" disabled={running} onClick={() => run(async () => { await ui.sendTransaction(tx([applyBaseUriMsg(st.collection)])); })}>طبّق بعد المهلة</button>
              </div>
            </div>
            <button className="btn ghost" disabled={running} onClick={() => run(async () => { await ui.sendTransaction(tx([sweepMsg(st.minter)])); })}>سحب بقايا الغاز من البائع</button>
          </div>
          {!savedSecret && <div className="note">الصق سرّ الكشف الذي نسخته (يُقبل على سطرين):<textarea className="mono" rows={2} value={pasted} onChange={(e) => setPasted(e.target.value)} style={{ width: "100%" }} /></div>}
          {!secretLocal && <p className="muted bad">سرّ الكشف غير موجود في هذا المتصفح. إن لم تكشف بنفسك، يكشف أي شخص بعد 3 أيام من الموعد بالطريقة العامة.</p>}
        </div>
      )}
    </>
  );
}

