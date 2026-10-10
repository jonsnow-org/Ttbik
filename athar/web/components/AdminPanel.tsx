"use client";
import { Address } from "@ton/core";
import { TonConnectButton, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToastHost, useToast } from "@/components/ui";
import { applyBaseUriMsg, proposeBaseUriMsg, repriceMsg, setItemFeesMsg, setKindFeesMsg, setCapMsg, classAuctionMsg, chunk, launchSteps, pauseMsg, sweepMsg } from "@/lib/launch";
import { SEASON_1 } from "@/lib/seasons";
import { KINDS, CLASS_KINDS, DIRECT_KINDS, idOf } from "@/lib/kinds";
import { compressPhoto, fillSquare } from "@/lib/photo";
import { waxPhoto } from "@/lib/wax";
import { ymd } from "@/lib/dates";
import { SITE_URL } from "@/lib/config";

import { adminMintMsg, ADMIN_MINT_VALUE, tx } from "@/lib/tx";
import { planBatches } from "@/lib/bulk";

type St = { siteUrl: string; envAdmin: string; collection: string; minter: string; collectionActive: boolean; minterActive: boolean; balance: number | null; payout?: string | null; minted?: number; status?: number; soldCount?: number; priceNormal?: number; priceGold?: number; capLegendary?: number; poolSize?: number; poolLoaded?: number; ticketsSold?: number; revealed?: boolean; revealAt?: number; commitSet?: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A photo for an owner mint or an auction: choose the file, and when it is not square slide the frame to pick which part of it fills the circle
 *  (the same control the buyers have). The finished picture (waxed to the kind's metal) goes to onImage; null when there is none. */
function AdminPhoto({ kind, resetKey, disabled, onImage }: { kind: number; resetKey: string | number; disabled?: boolean; onImage: (img: string | null) => void | Promise<void> }) {
  const [raw, setRaw] = useState<{ uri: string; w: number; h: number } | null>(null);
  const [pos, setPos] = useState(0.32);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wax = kind === 1 ? "silver" : kind === 2 || kind === 7 ? "gold" : null;   // the photo's treatment follows the kind
  const make = useCallback(async (r: { uri: string; w: number; h: number }, at: number) => {
    setBusy(true); setErr("");
    try {
      const f = await fillSquare(r.uri, r.w > r.h ? at : 0.5, r.w > r.h ? 0.5 : at);
      const img = f ? (wax ? await waxPhoto(f.uri, wax) : f.uri) : null;
      if (!img) { setErr("تعذّر تجهيز الصورة"); await onImage(null); return; }
      await onImage(img);
    } catch { setErr("تعذّر تجهيز الصورة"); } finally { setBusy(false); }
  }, [wax, onImage]);
  useEffect(() => { if (raw) void make(raw, pos); /* kind or date changed: the picture is made again for it */ }, [kind, resetKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setErr("");
    try {
      const c = await compressPhoto(f);
      if (!c) { setErr("تعذّر تجهيز الصورة"); return; }
      const r = { uri: c.uri, w: c.w, h: c.h };
      setRaw(r); setPos(0.32); setBusy(false); await make(r, 0.32);
    } catch { setErr("تعذّر تجهيز الصورة"); } finally { setBusy(false); }
  }
  const move = (v: number) => {       // the window follows the slider (re-made a moment after the finger stops)
    setPos(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (raw) void make(raw, v); }, 250);
  };
  return (
    <div className="gap">
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={(e) => void pick(e.target.files?.[0])} title="صورة اختيارية" />
      {raw && raw.w !== raw.h && (
        <label className="muted">حرّك الإطار لتختار ما يظهر
          <input type="range" min={0} max={100} value={Math.round(pos * 100)} onChange={(e) => move(Number(e.target.value) / 100)} style={{ width: "100%" }} />
        </label>
      )}
      {busy && <div className="muted">…</div>}
      {err && <div className="bad">{err}</div>}
    </div>
  );
}

export default function AdminPanel() {
  const address = useTonAddress();
  const [ui] = useTonConnectUI();
  const toast = useToast();
  useEffect(() => { document.body.dataset.admin = "1"; return () => { delete document.body.dataset.admin; }; }, []);
  const [st, setSt] = useState<St | null>(null);
  const [oldMinter, setOldMinter] = useState("EQAE52zCPwprWBpNuKXgzjRIB6MyO86df3N1NdWgCQGIESZ5");   // the seller of the first (test) deployment, kept only to be switched off
  const [payout, setPayout] = useState(() => { try { return localStorage.getItem("athar_payout") || ""; } catch { return ""; } });   // survives a reload or a reconnect
  useEffect(() => { try { localStorage.setItem("athar_payout", payout); } catch { /* private mode */ } }, [payout]);
  type Ov = { deployed?: boolean; minted?: number; byKind?: number[]; holders?: number; top?: { owner: string; tokens: number }[]; revenue?: number; salesToday?: number; recent?: { at: number; ton: number }[]; revenueNote?: string; payout?: string; mine?: number[] };
  const [ov, setOv] = useState<Ov | null>(null);
  const [startAt, setStartAt] = useState(() => { const d = new Date(Date.now() + 20 * 60000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const [maxMsgs, setMaxMsgs] = useState(4);
  const maxMsgsPicked = useRef(false);   // once the owner picks a number, the wallet's own value no longer overrides it
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
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
  // the free Toncenter key (write-only: the panel only learns where it comes from and its last four characters)
  const [tk, setTk] = useState<{ source: string; hint: string } | null>(null), [tkIn, setTkIn] = useState(""), [tkBusy, setTkBusy] = useState(false);
  const loadTk = useCallback(async () => { const r = await fetch("/api/admin/settings", { headers: adm(), cache: "no-store" }); if (r.ok) setTk(await r.json()); }, []);
  useEffect(() => { loadTk(); }, [loadTk]);
  async function tkAct(clear = false) {
    setTkBusy(true);
    try {
      const r = await fetch("/api/admin/settings", { method: "POST", headers: adm(), body: JSON.stringify(clear ? { clear: true } : { key: tkIn }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error === "key refused by Toncenter" ? "رفضت Toncenter هذا المفتاح، تأكد من نسخه كاملاً" : "المفتاح غير صالح"); return; }
      setTk(j); setTkIn(""); toast(clear ? "أُزيل المفتاح" : "حُفظ المفتاح وبدأ العمل");
    } finally { setTkBusy(false); }
  }
  // special (gold) dates: the admin picks the picture, it gets the waxed-gold treatment, is shown for approval, stored for good,
  // and only then is the long auction started with that picture attached
  const [newBase, setNewBase] = useState("");
  const [feeE, setFeeE] = useState("0.1"), [feeM, setFeeM] = useState("0.1"), [feeC, setFeeC] = useState("0.5");
  const [feeSeen, setFeeSeen] = useState<{ itemFees?: { engrave: number; media: number; change: number }; kinds?: { kind: number; price: number | null; cap: number; issued: number; photoFee: number; specialFee: number; walletMax: number }[]; ticketPrice?: number } | null>(null);
  // per direct kind: the photo fee and the special-date fee; the price band; the supply cap (lowered only)
  const [kfKind, setKfKind] = useState(0), [kfPhoto, setKfPhoto] = useState("0.15"), [kfSpecial, setKfSpecial] = useState("1");
  const [bandKind, setBandKind] = useState(0), [bandFloor, setBandFloor] = useState("0.25"), [bandCap, setBandCap] = useState("8");
  const [capKind, setCapKind] = useState(2), [capVal, setCapVal] = useState("300");
  useEffect(() => { fetch("/api/season", { cache: "no-store" }).then((r) => r.json()).then((j) => { setFeeSeen(j); if (j?.itemFees) { setFeeE(String(j.itemFees.engrave)); setFeeM(String(j.itemFees.media)); setFeeC(String(j.itemFees.change)); } }).catch(() => undefined); }, []);
  const kindRow = (k: number) => feeSeen?.kinds?.find((x) => x.kind === k);
  useEffect(() => { const r = feeSeen?.kinds?.find((x) => x.kind === kfKind); if (r) { setKfPhoto(String(r.photoFee)); setKfSpecial(String(r.specialFee)); } }, [kfKind, feeSeen]);
  useEffect(() => { const d = bandKind <= 2 ? SEASON_1.kinds[bandKind] : null; if (d) { setBandFloor(d.floor); setBandCap(d.cap); } }, [bandKind]);

  // ---- the owner's own mint: any kind of any date straight to a wallet (his stock for a market, or a gift), no sale price, optionally with a picture ----
  const [omKind, setOmKind] = useState(2);
  const [omY, setOmY] = useState(2003), [omM, setOmM] = useState(3), [omD, setOmD] = useState(14), [omTo, setOmTo] = useState("");
  const [omPhoto, setOmPhoto] = useState<string | null>(null), [omSvg, setOmSvg] = useState(""), [omBusy, setOmBusy] = useState(false);
  const dateIdx = (y: number, m: number, d: number) => Date.UTC(y, m - 1, Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate())) / 86400000 - Date.UTC(1950, 0, 1) / 86400000;
  const omDate = () => dateIdx(omY, omM, omD);
  const waxOf = (kind: number): "silver" | "gold" | null => (kind === 1 ? "silver" : kind === 2 || kind === 7 ? "gold" : null);   // the photo's treatment follows the kind
  const omPreview = async (photo: string) => {
    const r = await fetch("/api/admin/goldmint", { method: "POST", headers: adm(), body: JSON.stringify({ id: idOf(omKind, omDate()), photo, preview: true }) });
    const j = await r.json(); if (!r.ok) { toast(j.error || "فشلت المعاينة"); return false; }
    setOmSvg(j.svg); return true;
  };
  const omImage = useCallback(async (img: string | null) => {
    if (!img) { setOmPhoto(null); setOmSvg(""); return; }
    setOmBusy(true);
    try { if (await omPreview(img)) setOmPhoto(img); } finally { setOmBusy(false); }
  }, [omKind, omY, omM, omD]);   // eslint-disable-line react-hooks/exhaustive-deps
  const omMint = () => run(async () => {
    const date = omDate(), id = idOf(omKind, date);
    const info = await (await fetch(`/api/date/${date}`, { cache: "no-store" })).json();
    if (info.taken?.[omKind]) { toast("هذا النوع من هذا التاريخ مصكوك فعلاً"); throw new Error("taken"); }
    if (info.auction?.[omKind] || info.reserved?.[omKind]) { toast("هذا الرمز في مزاد أو صندوق غموض"); throw new Error("busy"); }
    let to: string | undefined; const t = omTo.trim();
    if (t) { try { Address.parse(t); to = t; } catch { toast("عنوان المستلم غير صالح"); throw new Error("bad address"); } }
    let ref = 0n;
    if (omPhoto) {
      const r = await fetch("/api/admin/goldmint", { method: "POST", headers: adm(), body: JSON.stringify({ id, photo: omPhoto }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "store failed");
      ref = BigInt(j.ref);
    }
    await ui.sendTransaction(tx([adminMintMsg(st!.minter, id, to, 0, ref)]));
    setOmPhoto(null); setOmSvg("");
  });

  // ---- an auction of one of the owner's classes (bronze ... legendary): optionally with a picture (ours for a special date, or his own), stored first ----
  const [acKind, setAcKind] = useState(7);
  const [acY, setAcY] = useState(2003), [acM, setAcM] = useState(3), [acD, setAcD] = useState(14);
  const [acPhoto, setAcPhoto] = useState<string | null>(null), [acSvg, setAcSvg] = useState(""), [acBusy, setAcBusy] = useState(false);
  const [acReserve, setAcReserve] = useState(SEASON_1.classAuction.reserve[4]), [acHours, setAcHours] = useState(String(SEASON_1.classAuction.hours));
  const acId = () => idOf(acKind, dateIdx(acY, acM, acD));
  useEffect(() => { setAcReserve(SEASON_1.classAuction.reserve[acKind - 3]); }, [acKind]);
  const acImage = useCallback(async (img: string | null) => {
    if (!img) { setAcPhoto(null); setAcSvg(""); return; }
    setAcBusy(true);
    try {
      const pr = await fetch("/api/admin/special", { method: "POST", headers: adm(), body: JSON.stringify({ id: acId(), photo: img, preview: true }) });
      const pj = await pr.json(); if (!pr.ok) { toast(pj.error || "فشلت المعاينة"); return; }
      setAcPhoto(img); setAcSvg(pj.svg);
    } catch { toast("تعذّر تجهيز الصورة"); } finally { setAcBusy(false); }
  }, [acKind, acY, acM, acD]);   // eslint-disable-line react-hooks/exhaustive-deps
  const acAuto = async () => {
    setAcBusy(true); setAcSvg("");
    try {
      const pr = await fetch("/api/admin/special", { method: "POST", headers: adm(), body: JSON.stringify({ id: acId(), auto: true, preview: true }) });
      const pj = await pr.json(); if (!pr.ok) { toast(pj.error || "هذا التاريخ ليس له رسم جاهز عندنا (التواريخ الخاصة فقط)"); return; }
      setAcPhoto("auto"); setAcSvg(pj.svg);
    } catch { toast("تعذّر رسم الصورة"); } finally { setAcBusy(false); }
  };
  const acStart = () => run(async () => {
    const id = acId();
    let ref = 0n;
    if (acPhoto) {
      const r = await fetch("/api/admin/special", { method: "POST", headers: adm(), body: JSON.stringify(acPhoto === "auto" ? { id, auto: true } : { id, photo: acPhoto }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "store failed");
      ref = BigInt(j.ref);
    }
    await ui.sendTransaction(tx([classAuctionMsg(st!.minter, id, ref, acReserve, Number(acHours))]));
    setAcPhoto(null); setAcSvg("");
  });

  // ---- the owner's stock: many dates of one direct kind minted to his wallet in a few confirmations, to be put on sale on a market (no sale price is paid; only fees) ----
  const [bkCount, setBkCount] = useState(10), [bkKind, setBkKind] = useState(0), [bkMode, setBkMode] = useState<"spread" | "start">("spread");
  const [bkPlan, setBkPlan] = useState<{ kind: number; dates: number[]; available: number; perToken: number; total: number; stays: number; net: number } | null>(null), [bkBusy, setBkBusy] = useState(false);
  async function bkPropose() {
    setBkBusy(true); setBkPlan(null);
    try {
      const r = await fetch(`/api/admin/bulk?count=${bkCount}&kind=${bkKind}&mode=${bkMode}`, { headers: adm(), cache: "no-store" });
      if (!r.ok) { toast("تعذّر اقتراح التواريخ"); return; }
      setBkPlan(await r.json());
    } finally { setBkBusy(false); }
  }
  const bkMint = () => run(async () => {
    if (!bkPlan || !st?.minter) throw new Error("no plan");
    const batches = planBatches(bkPlan.dates, maxMsgs, BigInt(Math.floor(((st.balance ?? 0) - 0.5) * 1e9)), ADMIN_MINT_VALUE);
    if (batches.length === 0) { toast("رصيد المحفظة لا يكفي لدفعة واحدة"); throw new Error("balance"); }
    for (let i = 0; i < batches.length; i++) {
      toast(`الدفعة ${i + 1} من ${batches.length}`);
      await ui.sendTransaction(tx(batches[i].map((d) => adminMintMsg(st.minter, idOf(bkPlan.kind, d)))));
      if (i < batches.length - 1) await sleep(25000);        // let the unused part of the fees come back before the next confirmation
    }
    setBkPlan(null);
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
      const startTs = Math.floor(new Date(startAt).getTime() / 1000);
      const { steps } = await launchSteps(Address.parse(address), Address.parse(payout.trim()), SEASON_1, { startAt: startTs });
      let cur = (await refresh()) as St;
      const done = [
        (s: St) => s.collectionActive && s.minterActive,
        (s: St) => (s.priceGold ?? 0) > 0 && (s.capLegendary ?? 0) > 0,
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
        <div className="kv"><span>التواريخ المتاحة</span><span>كل التقويم (1950–2049)</span></div>
        {DIRECT_KINDS.map((k) => { const d = SEASON_1.kinds[k]; return <div className="kv" key={k}><span>{KINDS[k].ar}</span><span>يبدأ {d.start} · أدنى {d.floor} · أعلى {d.cap} Gram · سقف العدد {d.maxSupply.toLocaleString("ar")} · صورة +{d.photoFee} · تاريخ خاص +{d.specialFee}</span></div>; })}
        {CLASS_KINDS.map((k) => <div className="kv" key={k}><span>{KINDS[k].ar} (مزاد)</span><span>سقف العدد {SEASON_1.classCaps[k - 3].toLocaleString("ar")}</span></div>)}
        <div className="kv"><span>تواريخ تاريخية خاصة (رسم خاص)</span><span>{SEASON_1.specials.length}</span></div>
        <div className="kv"><span>سقف الشراء اليومي للمحفظة</span><span>{SEASON_1.walletDailyCap}</span></div>
        <p className="muted">سقوف الأعداد تُكتب في العقد عند الإطلاق ولا يمكن رفعها بعد ذلك (خفضها فقط).</p>
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
          <div className="kv"><span>المُصكوك</span><span>{ov.minted}</span></div>
          <div className="kv"><span>حسب النوع</span><span>{KINDS.map((k) => `${k.ar} ${ov.byKind?.[k.id] ?? 0}`).join(" · ")}</span></div>
          <div className="kv"><span>عدد الحاملين</span><span>{ov.holders}</span></div>
          <div className="kv"><span>وصل إلى محفظة الأرباح</span><span>{ov.revenue != null ? `${ov.revenue.toFixed(2)} Gram` : "..."}</span></div>
          <div className="kv"><span>عمليات اليوم</span><span>{ov.salesToday ?? "..."}</span></div>
          {ov.revenueNote && <p className="muted">{ov.revenueNote}</p>}
          {!!ov.recent?.length && <><b>آخر العمليات</b>{ov.recent.map((x, i) => <div className="kv" key={i}><span>{new Date(x.at * 1000).toLocaleString("ar")}</span><span>{x.ton.toFixed(2)} Gram</span></div>)}</>}
          {!!ov.top?.length && <><b>أكبر الحاملين</b>{ov.top.map((x) => <div className="kv" key={x.owner}><span className="mono">{x.owner.slice(0, 6)}…{x.owner.slice(-4)}</span><span>{x.tokens}</span></div>)}</>}
          {!!ov.mine?.length && <><b>رموزك أنت</b><div className="row" style={{ flexWrap: "wrap", gap: 8 }}>{ov.mine.map((i) => <a key={i} className="btn sm ghost" href={`/token/${i}`}>{i}</a>)}</div></>}
        </div>
      )}
      {st && (
        <div className="card">
          <h3>الصك والمزادات والإعدادات</h3>
          {!launched && <p className="muted">أزرار الصك والمزادات تعمل بعد الإطلاق وبدء البيع. يمكنك الاطلاع على الخيارات من الآن.</p>}
          <div className="gap">
            <div className="card" style={{ margin: 0 }}>
              <h4>صكّ رمز لمحفظة (أي نوع، أي تاريخ)</h4>
              <div className="muted" style={{ fontSize: 12 }}>تصكّ أي نوع (عادي، فضي، ذهبي، أو إحدى الفئات النادرة) على أي تاريخ شاغر في ذلك النوع، لمحفظتك أو لمحفظة تحددها، دون دفع سعر البيع (رسوم الشبكة فقط). تُحسب على سقف عدد ذلك النوع. يمكنك إضافة صورة: الفضي بمعالجة فضية والذهبي والأسطوري بمعالجة ذهبية، وتبقى كل مؤثرات الرمز حية فوقها.</div>
              <div className="gap">
                <select value={omKind} onChange={(e) => { setOmKind(Number(e.target.value)); setOmPhoto(null); setOmSvg(""); }}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.ar}</option>)}</select>
                <div className="row" style={{ gap: 8 }}>
                  <input type="number" min={1} max={31} value={omD} onChange={(e) => { setOmD(Number(e.target.value)); setOmPhoto(null); setOmSvg(""); }} title="اليوم" />
                  <input type="number" min={1} max={12} value={omM} onChange={(e) => { setOmM(Number(e.target.value)); setOmPhoto(null); setOmSvg(""); }} title="الشهر" />
                  <input type="number" min={1950} max={2049} value={omY} onChange={(e) => { setOmY(Number(e.target.value)); setOmPhoto(null); setOmSvg(""); }} title="السنة" />
                </div>
                <input type="text" dir="ltr" placeholder="عنوان المستلم (اختياري، وإلا لمحفظتك)" value={omTo} onChange={(e) => setOmTo(e.target.value)} />
                <AdminPhoto kind={omKind} resetKey={`${omKind}-${omDate()}`} disabled={omBusy} onImage={omImage} />
                {omSvg && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(omSvg)}`} alt="" style={{ width: "100%", maxWidth: 300, margin: "0 auto", display: "block" }} />}
                <button className="btn gold" disabled={!launched || running || omBusy} onClick={omMint}>{omPhoto ? "خزّن الصورة واصكّ الرمز" : "اصكّ الرمز"}</button>
              </div>
            </div>

            <div className="card" style={{ margin: 0 }}>
              <h4>مزاد لفئة نادرة (برونزي، نادر، أرجواني، ألماسي، أسطوري)</h4>
              <div className="muted" style={{ fontSize: 12 }}>تحدد الفئة والتاريخ (أي تاريخ، حتى لو صُكّ بنوع آخر) وسعر البداية والمدة. الصورة اختيارية: ارسم تلقائياً (للتواريخ الخاصة فقط) أو اختر صورة بنفسك، وتُخزَّن للأبد قبل بدء المزاد فيراها المزايدون. يُحسب الرمز على سقف الفئة عند بدء المزاد.</div>
              <div className="gap">
                <select value={acKind} onChange={(e) => { setAcKind(Number(e.target.value)); setAcPhoto(null); setAcSvg(""); }}>{CLASS_KINDS.map((k) => <option key={k} value={k}>{KINDS[k].ar}</option>)}</select>
                <div className="row" style={{ gap: 8 }}>
                  <input type="number" min={1} max={31} value={acD} onChange={(e) => { setAcD(Number(e.target.value)); setAcPhoto(null); setAcSvg(""); }} title="اليوم" />
                  <input type="number" min={1} max={12} value={acM} onChange={(e) => { setAcM(Number(e.target.value)); setAcPhoto(null); setAcSvg(""); }} title="الشهر" />
                  <input type="number" min={1950} max={2049} value={acY} onChange={(e) => { setAcY(Number(e.target.value)); setAcPhoto(null); setAcSvg(""); }} title="السنة" />
                </div>
                <button className="btn ghost" disabled={acBusy} onClick={acAuto}>ارسم الصورة تلقائياً (تاريخ خاص)</button>
                <AdminPhoto kind={acKind} resetKey={`${acKind}-${acId()}`} disabled={acBusy} onImage={acImage} />
                {acSvg && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(acSvg)}`} alt="" style={{ width: "100%", maxWidth: 300, margin: "0 auto", display: "block" }} />}
                <div className="row" style={{ gap: 8 }}>
                  <input type="number" step="1" min="1" value={acReserve} onChange={(e) => setAcReserve(e.target.value)} title="سعر البداية Gram" />
                  <input type="number" step="1" min="1" max="8760" value={acHours} onChange={(e) => setAcHours(e.target.value)} title="المدة بالساعات" />
                </div>
                <button className="btn gold" disabled={!launched || running || acBusy} onClick={acStart}>{acPhoto ? "خزّن الصورة وابدأ المزاد" : "ابدأ المزاد"}</button>
              </div>
            </div>

            <div className="card" style={{ margin: 0 }}>
              <h4>مخزوني: صكّ دفعة رموز من نوع واحد لمحفظتي لعرضها للبيع</h4>
              <div className="muted" style={{ fontSize: 12 }}>تصكّ التواريخ لمحفظتك دون دفع سعر البيع. تدفع مقدماً نحو 0.08 Gram للرمز، يعود منها نحو 0.04 إلى محفظتك لاحقاً (من «سحب بقايا الغاز»)، وتبقى نحو 0.03 داخل الرمز نفسه للأبد، ونحو 0.008 رسوم شبكة. أنصح بالبدء بنحو 10 رموز. تُحسب على سقف النوع.</div>
              <div className="gap">
                <div className="row" style={{ gap: 8 }}>
                  <input type="number" min={1} max={1000} value={bkCount} onChange={(e) => { setBkCount(Number(e.target.value)); setBkPlan(null); }} title="العدد" />
                  <select value={bkKind} onChange={(e) => { setBkKind(Number(e.target.value)); setBkPlan(null); }}>{DIRECT_KINDS.map((k) => <option key={k} value={k}>{KINDS[k].ar}</option>)}</select>
                  <select value={bkMode} onChange={(e) => { setBkMode(e.target.value as "spread" | "start"); setBkPlan(null); }}><option value="spread">موزّعة على كل المدى</option><option value="start">من أول التقويم</option></select>
                </div>
                <button className="btn ghost" disabled={running || bkBusy} onClick={bkPropose}>اقترح التواريخ وأظهر التكلفة</button>
                {bkPlan && <div className="muted" style={{ fontSize: 13 }}>{bkPlan.dates.length} رمز (المتاح {bkPlan.available}). تدفع مقدماً ≈ {bkPlan.total} Gram، والتكلفة الفعلية بعد استرجاع البقايا ≈ {bkPlan.net} Gram (منها ≈ {bkPlan.stays} تبقى داخل الرموز).</div>}
                <button className="btn gold" disabled={!launched || running || bkBusy || !bkPlan || bkPlan.dates.length === 0} onClick={bkMint}>صكّ الآن</button>
              </div>
            </div>

            <div className="card" style={{ margin: 0 }}>
              <b>أسعار الأصناف ورسومها وسقوف أعدادها</b>
              <p className="muted">الحالي: {DIRECT_KINDS.map((k) => { const r = kindRow(k); return `${KINDS[k].ar} ${r?.price ?? "…"} (${r ? `${r.issued}/${r.cap}` : "…"})`; }).join(" · ")} Gram. الفئات: {CLASS_KINDS.map((k) => { const r = kindRow(k); return `${KINDS[k].ar} ${r ? `${r.issued}/${r.cap}` : "…"}`; }).join(" · ")}.</p>
              <div className="muted" style={{ fontSize: 12 }}>رسم الصورة الشخصية ورسم التاريخ الخاص لكل صنف (حتى 2 و100 Gram):</div>
              <select value={kfKind} onChange={(e) => setKfKind(Number(e.target.value))}>{DIRECT_KINDS.map((k) => <option key={k} value={k}>{KINDS[k].ar}</option>)}</select>
              <div className="row" style={{ gap: 8 }}>
                <input type="number" step="0.01" min="0" max="2" value={kfPhoto} onChange={(e) => setKfPhoto(e.target.value)} title="صورة شخصية" />
                <input type="number" step="0.5" min="0" max="100" value={kfSpecial} onChange={(e) => setKfSpecial(e.target.value)} title="تاريخ خاص" />
              </div>
              <button className="btn ghost" disabled={running || Number(kfPhoto) > 2 || Number(kfSpecial) > 100} onClick={() => run(async () => { await ui.sendTransaction(tx([setKindFeesMsg(st.minter, kfKind, kfPhoto, kfSpecial)])); })}>حدّث رسوم هذا الصنف</button>
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>نطاق السعر (الأرضية والسقف، من 0.05 إلى 2000 Gram؛ السعر الحالي يُسحب إلى داخله):</div>
              <select value={bandKind} onChange={(e) => setBandKind(Number(e.target.value))}>{DIRECT_KINDS.map((k) => <option key={k} value={k}>{KINDS[k].ar}</option>)}<option value={15}>تذاكر الغموض</option></select>
              <div className="row" style={{ gap: 8 }}>
                <input type="number" step="0.05" min="0.05" value={bandFloor} onChange={(e) => setBandFloor(e.target.value)} title="الأرضية" />
                <input type="number" step="0.05" min="0.05" value={bandCap} onChange={(e) => setBandCap(e.target.value)} title="السقف" />
              </div>
              <button className="btn ghost" disabled={running || Number(bandFloor) < 0.05 || Number(bandFloor) > Number(bandCap)} onClick={() => run(async () => { await ui.sendTransaction(tx([repriceMsg(st.minter, bandKind, bandFloor, bandCap)])); })}>طبّق النطاق</button>
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>سقف عدد نوع (يمكن خفضه فقط، ولا يُرفع أبداً، ولا ينزل عمّا صُكّ):</div>
              <select value={capKind} onChange={(e) => setCapKind(Number(e.target.value))}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.ar}</option>)}</select>
              <input type="number" step="1" min="1" value={capVal} onChange={(e) => setCapVal(e.target.value)} title="السقف الجديد" />
              <button className="btn ghost" disabled={running || !(Number(capVal) >= 1)} onClick={() => run(async () => { await ui.sendTransaction(tx([setCapMsg(st.minter, capKind, Math.floor(Number(capVal)))])); })}>اخفض السقف</button>
            </div>

            <div className="card" style={{ margin: 0 }}>
              <h4>مفتاح Toncenter (يسرّع قراءة الشبكة)</h4>
              <div className="muted" style={{ fontSize: 12 }}>{tk?.source === "none" || !tk ? "لا يوجد مفتاح: القراءة بطيئة (طلب في الثانية). الصق المفتاح المجاني من بوت Toncenter هنا." : `المفتاح يعمل (ينتهي بـ ${tk.hint}) ${tk.source === "server" ? "· مضبوط في الخادم" : "· محفوظ من اللوحة"}`}</div>
              <div className="gap">
                <input type="password" dir="ltr" autoComplete="off" placeholder="الصق مفتاح Toncenter" value={tkIn} onChange={(e) => setTkIn(e.target.value)} />
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn gold" disabled={tkBusy || tkIn.trim().length < 16} onClick={() => tkAct(false)}>احفظ المفتاح</button>
                  {tk?.source === "panel" && <button className="btn ghost" disabled={tkBusy} onClick={() => tkAct(true)}>أزل المفتاح</button>}
                </div>
              </div>
            </div>

            <div className="card" style={{ margin: "10px 0" }}>
              <h4 style={{ margin: "0 0 6px" }}>إيقاف البائع القديم</h4>
              <p className="muted" style={{ margin: "0 0 8px" }}>يوقف البيع في بائع النشر التجريبي الأول فقط (لا علاقة له بالبائع الحالي). يُرسَل من حساب الإدارة نفسه.</p>
              <input type="text" dir="ltr" value={oldMinter} onChange={(e) => setOldMinter(e.target.value.trim())} style={{ width: "100%", marginBottom: 8 }} />
              <button className="btn ghost" disabled={running || !oldMinter || oldMinter === st.minter} onClick={() => run(async () => { await ui.sendTransaction(tx([pauseMsg(oldMinter, true)])); })}>أوقف البائع القديم</button>
            </div>
            <button className="btn ghost" disabled={!launched || running} onClick={() => run(async () => { await ui.sendTransaction(tx([pauseMsg(st.minter, st.status === 1)])); })}>{st.status === 1 ? "أوقف البيع مؤقتاً" : "استأنف البيع"}</button>

            <div className="card" style={{ margin: 0 }}>
              <b>رسوم النقش وتغيير الصورة</b>
              <p className="muted">الحالي: نقش {feeSeen?.itemFees?.engrave ?? "…"} · أول صورة {feeSeen?.itemFees?.media ?? "…"} · تغيير الصورة {feeSeen?.itemFees?.change ?? "…"} Gram. عدّلها عندما يتغيّر سعر Gram أو التضخم. الحد الأعلى 5 Gram لكل رسم، وتغيير الصورة لا يقل عن أول صورة.</p>
              <div className="row" style={{ gap: 8 }}>
                <input type="number" step="0.01" min="0.02" value={feeE} onChange={(e) => setFeeE(e.target.value)} title="نقش" />
                <input type="number" step="0.01" min="0.02" value={feeM} onChange={(e) => setFeeM(e.target.value)} title="أول صورة" />
                <input type="number" step="0.01" min="0.02" value={feeC} onChange={(e) => setFeeC(e.target.value)} title="تغيير الصورة" />
              </div>
              <button className="btn ghost" disabled={running || Number(feeC) < Number(feeM)} onClick={() => run(async () => { await ui.sendTransaction(tx([setItemFeesMsg(st.collection, feeE, feeM, feeC)])); })}>حدّث رسوم النقش والصورة</button>
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
            <button className="btn ghost" disabled={!launched || running} onClick={() => run(async () => { await ui.sendTransaction(tx([sweepMsg(st.minter)])); })}>سحب بقايا الغاز من البائع</button>
          </div>
        </div>
      )}
    </>
  );
}

