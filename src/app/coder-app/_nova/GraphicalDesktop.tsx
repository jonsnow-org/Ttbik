"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./parts";
import { rawInitData } from "../_tma/sdk";
import { desktopPoint, screenSizeOf } from "@/lib/desktopCoordinates";

const mono = { font: "13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace", direction: "ltr" as const, textAlign: "left" as const };

export default function GraphicalDesktop({ model, ar }: { model: string; ar: boolean }) {
  const [status, setStatus] = useState<any>(null);
  const [frame, setFrame] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("https://example.com");
  const [typed, setTyped] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<any[]>([]);
  const [runningJobs, setRunningJobs] = useState<any[]>([]);
  const [zoom, setZoom] = useState(1);
  const frameBusy = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);
  // The picture may be smaller than the real screen (the live stream asks for scale 0.75), so a click must be mapped
  // with the screen size the Studio reports, never with the <img> natural size, or the far edge of the desktop is unreachable.
  const screenRef = useRef<{ w: number; h: number } | null>(null);
  const running = status?.phase === "running";
  const preparing = status?.phase === "installing" || status?.phase === "starting";
  const available = typeof status?.available_mb === "number" ? status.available_mb + " MB" : (ar ? "غير معروف" : "unknown");

  const call = useCallback(async (args: Record<string, unknown>) => {
    const result = await api<any>("desktop", { model, args });
    setStatus(result);
    const size = screenSizeOf(result);
    if (size) screenRef.current = size;
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
    if (phase === "running" && streaming) return;
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
            const size = screenSizeOf(result);
            if (size) screenRef.current = size;
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
  }, [status?.phase, model, streaming]);

  // Keep screenshot polling active whenever the live stream is connecting or recovering.
  // A transient 502 must not stop reconnect attempts or restart the desktop session.
  useEffect(() => {
    if (!running) { setStreaming(false); return; }
    let stopped = false;
    let controller: AbortController | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    const pause = (ms: number) => new Promise<void>((resolve) => { reconnect = setTimeout(resolve, ms); });
    const connect = async () => {
      setStreaming(false);
      while (!stopped) {
        controller = new AbortController();
        try {
          const response = await fetch("/api/coder/app", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-telegram-init-data": rawInitData() },
            body: JSON.stringify({ op: "desktop_live", model, seconds: 20 }),
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(String(body?.error || ("Live desktop HTTP " + response.status)));
          }
          if (!response.body) throw new Error("Live desktop stream is empty");
          setStreaming(true);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const consume = (block: string) => {
            if (!block.trim()) return;
            if (/^event:\s*error/m.test(block)) throw new Error("Computer Studio ended the live stream with an error");
            const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
            if (!data || data === "[DONE]") return;
            let parsed: any;
            try { parsed = JSON.parse(data); } catch { return; }
            const value = Array.isArray(parsed) ? parsed[0] : parsed;
            let event: any = value;
            if (typeof value === "string") { try { event = JSON.parse(value); } catch { return; } }
            if (!event || typeof event !== "object") return;
            retryAttempt = 0;
            const size = screenSizeOf(event);
            if (size) screenRef.current = size;
            if (typeof event.screenshot_b64 === "string" && event.screenshot_b64) setFrame("data:image/jpeg;base64," + event.screenshot_b64);
            if (event.phase) setStatus((prior: any) => ({ ...(prior || {}), phase: event.phase }));
            if (Array.isArray(event.activity)) setActivity(event.activity);
            if (Array.isArray(event.running_jobs)) setRunningJobs(event.running_jobs);
            if (event.frame_error) setError(String(event.frame_error));
            else if (event.ok !== false) setError("");
          };
          while (!stopped) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() || "";
            for (const block of blocks) consume(block);
          }
          if (buffer) consume(buffer);
          if (!stopped) setStreaming(false);
        } catch (e: any) {
          if (!stopped && e?.name !== "AbortError") {
            setStreaming(false);
            const message = String(e?.message || e);
            setError(message);
            const transient = /\b(?:408|425|429|500|502|503|504)\b|fetch failed|network|timed out|timeout|ECONNRESET|connection reset/i.test(message);
            if (!transient) break;
            const delay = Math.min(8000, 1000 * (2 ** Math.min(retryAttempt, 3)));
            retryAttempt = Math.min(retryAttempt + 1, 4);
            await pause(delay);
            continue;
          }
        }
        if (!stopped) await pause(250);
      }
    };
    void connect();
    return () => {
      stopped = true;
      controller?.abort();
      if (reconnect) clearTimeout(reconnect);
    };
  }, [model, running]);

  const perform = async (args: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await call(args); }
    catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const launch = (app: "browser" | "terminal" | "files") => {
    void perform({ action: "launch", app, ...(app === "browser" ? { url: address } : {}) });
  };
  const clickScreen = (event: React.MouseEvent<HTMLImageElement>, button: "left" | "right" = "left") => {
    const image = imageRef.current;
    if (!image) return;
    const rect = image.getBoundingClientRect();
    const point = desktopPoint(rect, event, { width: image.naturalWidth, height: image.naturalHeight }, screenRef.current);
    if (!point) return;
    void perform({ action: "click", x: point.x, y: point.y, button });
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
          ? "الذاكرة المتاحة في الحاسوب المركزي: " + available + ". يتطلب البدء 3072 MB على الأقل. "
          : "Computer hub memory available: " + available + ". Start requires at least 3072 MB. "}
        {running ? (streaming ? (ar ? "بث حي للشاشة والأنشطة." : "Live screen and activity stream.") : (ar ? "وضع اللقطات الاحتياطي." : "Fallback screenshot mode.")) : null}
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
          tabIndex={0}
          onKeyDown={(event) => {
            if (["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName || "")) return;
            const names: Record<string, string> = { " ": "space", "Enter": "Return", "Escape": "Escape", "Backspace": "BackSpace", "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right", "Delete": "Delete", "Tab": "Tab" };
            const key = names[event.key] || event.key;
            const modifiers = [event.ctrlKey ? "ctrl" : "", event.altKey ? "alt" : "", event.shiftKey ? "shift" : ""].filter(Boolean);
            const mapped = [...modifiers, key].join("+");
            if (/^[A-Za-z0-9_+ -]{1,40}$/.test(mapped)) {
              event.preventDefault();
              void perform({ action: "key", key: mapped.replace(/ /g, "") });
            }
          }}
          style={{ display: "block", width: "100%", maxHeight: "82vh", height: "auto", objectFit: "contain", transform: `scale(${zoom})`, transformOrigin: "top center", background: "#111827", border: "1px solid #8885", borderRadius: 8, cursor: "crosshair", touchAction: "pan-y" }}
        />
      ) : (
        <div style={{ minHeight: 220, display: "grid", placeItems: "center", border: "1px dashed #8887", borderRadius: 8, textAlign: "center", padding: 20 }}>
          <div className="n-meta">
            {preparing
              ? (ar ? "يتم تجهيز خادم الشاشة ومدير النوافذ والطرفية. ستظهر الشاشة عند اكتمال التشغيل." : "Preparing the display server, window manager and terminal. The screen appears when startup completes.")
              : (ar ? "هذا سطح مكتب Linux رسومي على الحاسوب المركزي؛ لكل مستخدم ونموذج جلسة وملفات منفصلة. شغّله لعرض الشاشة والتحكم بها." : "This is a graphical Linux session on the shared computer hub, isolated by user and selected model. Start it to view and control the screen.")}
          </div>
        </div>
      )}
      {running ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <span className="n-meta">{ar ? "تكبير الشاشة" : "Screen zoom"}</span>
          <button type="button" className="n-btn n-ghost" disabled={zoom <= 0.7} onClick={() => setZoom((v) => Math.max(0.7, Math.round((v - 0.1) * 10) / 10))}>−</button>
          <span className="n-meta">{Math.round(zoom * 100)}%</span>
          <button type="button" className="n-btn n-ghost" disabled={zoom >= 1.5} onClick={() => setZoom((v) => Math.min(1.5, Math.round((v + 0.1) * 10) / 10))}>＋</button>
        </div>
      ) : null}
      {running && (activity.length > 0 || runningJobs.length > 0) ? (
        <div className="n-note" style={{ marginTop: 8, maxHeight: 150, overflow: "auto" }}>
          <strong>{ar ? "نشاط الحاسوب" : "Computer activity"}</strong>
          {activity.slice(-6).map((item, index) => <div key={item?.id || item?.seq || index} style={mono}>{String(item?.text || item?.message || item).slice(0, 220)}</div>)}
          {runningJobs.map((job, index) => <div key={job?.id || index} style={mono}>{String(job?.name || job?.command || "Background job")}: {ar ? "يعمل" : "running"}</div>)}
        </div>
      ) : null}
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
