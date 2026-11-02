"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./parts";

const mono = { font: "13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace", direction: "ltr" as const, textAlign: "left" as const };

export default function GraphicalDesktop({ model, ar }: { model: string; ar: boolean }) {
  const [status, setStatus] = useState<any>(null);
  const [frame, setFrame] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("https://example.com");
  const [typed, setTyped] = useState("");
  const frameBusy = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);

  const call = useCallback(async (args: Record<string, unknown>) => {
    const result = await api<any>("desktop", { model, args });
    setStatus(result);
    if (typeof result?.screenshot_b64 === "string") setFrame("data:image/jpeg;base64," + result.screenshot_b64);
    if (result?.ok === false) setError(String(result.error || "Desktop request failed"));
    else setError("");
    return result;
  }, [model]);

  useEffect(() => {
    setFrame("");
    setError("");
    setStatus(null);
    void call({ action: "status" }).catch((e: any) => setError(String(e?.message || e)));
  }, [call]);

  useEffect(() => {
    const phase = String(status?.phase || "");
    if (!["installing", "starting", "running"].includes(phase)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible" && !frameBusy.current) {
        frameBusy.current = true;
        try {
          const action = phase === "running" ? "frame" : "status";
          const result = await api<any>("desktop", { model, args: { action } });
          if (!stopped) {
            setStatus(result);
            if (typeof result?.screenshot_b64 === "string") setFrame("data:image/jpeg;base64," + result.screenshot_b64);
            if (result?.ok === false) setError(String(result.error || "Desktop request failed"));
            else if (result?.error) setError(String(result.error));
            else setError("");
          }
        } catch (e: any) {
          if (!stopped) setError(String(e?.message || e));
        } finally {
          frameBusy.current = false;
        }
      }
      if (!stopped) timer = setTimeout(tick, phase === "running" ? 2200 : 1800);
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [status?.phase, model]);

  const perform = async (args: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await call(args); }
    catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const running = status?.phase === "running";
  const preparing = status?.phase === "installing" || status?.phase === "starting";
  const available = typeof status?.available_mb === "number" ? status.available_mb + " MB" : (ar ? "غير معروف" : "unknown");
  const launch = (app: "browser" | "terminal" | "files") => {
    void perform({ action: "launch", app, ...(app === "browser" ? { url: address } : {}) });
  };
  const clickScreen = (event: React.MouseEvent<HTMLImageElement>, button: "left" | "right" = "left") => {
    const image = imageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const rect = image.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * image.naturalWidth);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * image.naturalHeight);
    void perform({ action: "click", x, y, button });
  };
  const sendText = async () => {
    const value = typed;
    if (!value.trim()) return;
    setTyped("");
    await perform({ action: "type", text: value });
  };

  return (
    <div className="n-card" style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        {!running ? (
          <button type="button" className="n-btn" disabled={busy || preparing || status?.phase === "busy"} onClick={() => void perform({ action: "start" })}>
            {busy || preparing ? (ar ? "جارٍ التجهيز…" : "Preparing…") : (ar ? "تشغيل سطح المكتب" : "Start desktop")}
          </button>
        ) : (
          <button type="button" className="n-btn n-ghost" disabled={busy} onClick={() => void perform({ action: "stop" })}>
            {ar ? "إيقاف سطح المكتب" : "Stop desktop"}
          </button>
        )}
        <button type="button" className="n-btn n-ghost" disabled={!running || busy} onClick={() => launch("browser")}>{ar ? "المتصفح" : "Browser"}</button>
        <button type="button" className="n-btn n-ghost" disabled={!running || busy} onClick={() => launch("terminal")}>{ar ? "طرفية" : "Terminal"}</button>
        <button type="button" className="n-btn n-ghost" disabled={!running || busy} onClick={() => launch("files")}>{ar ? "الملفات" : "Files"}</button>
        <span className="n-meta" style={{ marginInlineStart: "auto" }}>
          {running ? (ar ? "متصل" : "Connected") : preparing ? (ar ? "يثبّت مكوّنات سطح المكتب" : "Installing desktop components") : status?.phase === "busy" ? (ar ? "الاستوديو مشغول بمستخدم آخر" : "Studio is busy") : (ar ? "متوقف" : "Stopped")}
        </span>
      </div>
      <div className="n-meta" style={{ marginBottom: 8 }}>
        {ar
          ? "ذاكرة الاستوديو المتاحة: " + available + ". يتطلب البدء 3072 MB على الأقل. تُحدّث الصورة كل نحو ثانيتين؛ هذا ليس بثاً فورياً بسرعة 60 إطاراً."
          : "Studio memory available: " + available + ". Start requires at least 3072 MB. The screen refreshes about every two seconds; this is not 60-fps streaming."}
        {status?.packages?.ready === false ? (ar ? " ستُثبّت مكونات X11 عند التشغيل الأول." : " X11 components will be installed on first start.") : null}
      </div>
      {error ? <div className="n-note" role="alert" style={{ marginBottom: 8 }}>{error}</div> : null}
      {frame && running ? (
        <img
          ref={imageRef}
          src={frame}
          alt={ar ? "شاشة سطح مكتب Linux" : "Linux desktop screen"}
          onClick={(event) => clickScreen(event)}
          onContextMenu={(event) => { event.preventDefault(); clickScreen(event, "right"); }}
          onWheel={(event) => {
            event.preventDefault();
            void perform({ action: "scroll", direction: event.deltaY < 0 ? "up" : "down", amount: Math.max(1, Math.min(8, Math.ceil(Math.abs(event.deltaY) / 100))) });
          }}
          style={{ display: "block", width: "100%", maxHeight: "68vh", objectFit: "contain", background: "#111827", border: "1px solid #8885", borderRadius: 8, cursor: "crosshair", touchAction: "pan-y" }}
        />
      ) : (
        <div style={{ minHeight: 220, display: "grid", placeItems: "center", border: "1px dashed #8887", borderRadius: 8, textAlign: "center", padding: 20 }}>
          <div className="n-meta">
            {preparing
              ? (ar ? "يتم تجهيز خادم الشاشة ومدير النوافذ والطرفية. ستظهر الشاشة عند اكتمال التشغيل." : "Preparing the display server, window manager and terminal. The screen appears when startup completes.")
              : (ar ? "هذا سطح مكتب Linux رسومي مستقل داخل استوديو النموذج المختار. شغّله لعرض الشاشة والتحكم بها." : "This is a graphical Linux desktop inside the selected model's own Studio. Start it to view and control the screen.")}
          </div>
        </div>
      )}
      {running ? (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <input value={address} dir="ltr" onChange={(event) => setAddress(event.target.value)} placeholder="https://example.com" style={{ ...mono, minWidth: 140, flex: 1, border: "1px solid #8884", borderRadius: 8, padding: 8 }} />
          <button type="button" className="n-btn n-ghost" disabled={busy} onClick={() => launch("browser")}>{ar ? "فتح العنوان" : "Open URL"}</button>
        </div>
      ) : null}
      {running ? (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input
            value={typed}
            dir="auto"
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void sendText(); } }}
            placeholder={ar ? "اكتب إلى النافذة المحددة ثم اضغط إرسال…" : "Type into the focused desktop window…"}
            style={{ flex: 1, minWidth: 0, border: "1px solid #8884", borderRadius: 8, padding: 8 }}
          />
          <button type="button" className="n-btn" disabled={busy || !typed.trim()} onClick={() => void sendText()}>{ar ? "إرسال" : "Send"}</button>
          <button type="button" className="n-btn n-ghost" disabled={busy} onClick={() => void perform({ action: "key", key: "Return" })}>↵</button>
          <button type="button" className="n-btn n-ghost" disabled={busy} onClick={() => void perform({ action: "key", key: "alt+Tab" })}>Alt+Tab</button>
        </div>
      ) : null}
    </div>
  );
}
