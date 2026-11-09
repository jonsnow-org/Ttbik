"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./parts";
import { rawInitData } from "../_tma/sdk";
import { desktopPoint, screenSizeOf } from "@/lib/desktopCoordinates";
import { desktopStreamMode, type DesktopStreamMode } from "@/lib/desktopStream";

const mono = { font: "13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace", direction: "ltr" as const, textAlign: "left" as const };

// The page draws only the screen. The apps are a real taskbar INSIDE the Linux desktop (tint2 on the hub), so tapping them is
// tapping the screen; nothing here sits beside it (owner's order 2026-11-09).
export default function GraphicalDesktop({ model, ar }: { model: string; ar: boolean }) {
  const [status, setStatus] = useState<any>(null);
  const [frame, setFrame] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const frameBusy = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameBox = useRef<HTMLDivElement>(null);
  // when the last tap landed: the browser fires a synthetic click right after touchstart, and without this the desktop
  // would receive two clicks per tap (a double-click opens folders and selects text on a real desktop).
  const touchAt = useRef(0);
  // when a live-stream event last arrived: keeps the "live" wording across the 20 s stream's reconnect
  const lastStreamAt = useRef(0);
  // The picture may be smaller than the real screen (the live stream asks for scale 0.75), so a click must be mapped
  // with the screen size the Studio reports, never with the <img> natural size, or the far edge of the desktop is unreachable.
  const screenRef = useRef<{ w: number; h: number } | null>(null);
  const running = status?.phase === "running";
  const preparing = status?.phase === "installing" || status?.phase === "starting";
  const available = typeof status?.available_mb === "number" ? status.available_mb + " MB" : (ar ? "غير معروف" : "unknown");
  // The live stream reconnects every ~20 s; a plain `streaming` flag made this line blink. The mode keeps it steady.
  // It is computed in an effect (a ref and the clock are read there, not during render).
  const [mode, setMode] = useState<DesktopStreamMode>("stopped");
  useEffect(() => {
    const refresh = () => setMode(desktopStreamMode({ running: Boolean(running), streaming, lastStreamAt: lastStreamAt.current, now: Date.now() }));
    refresh();
    if (!running) return;
    const timer = setInterval(refresh, 1_000);
    return () => clearInterval(timer);
  }, [running, streaming]);

  // The desktop is created in the shape of the page's own screen area (a phone is tall), so the picture fills it
  // instead of leaving a black band below a short landscape screen.
  const desktopSize = () => {
    const width = 640;       // phone-sized: the picture is shown at about half size, so the hub draws everything bigger and a fingertip can hit it
    const frameWidth = frameBox.current?.getBoundingClientRect().width || 340;
    const room = Math.max(420, (typeof window !== "undefined" ? window.innerHeight : 800) - 230);
    return { width, height: Math.max(700, Math.min(1200, Math.round((width * room) / frameWidth))) };
  };

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

  // Opening the computer starts its desktop by itself (once per model): the owner used to see an empty box until he found
  // the "Start" button, which looked like a dead picture. A failed start is not retried in a loop.
  const autoStarted = useRef("");
  useEffect(() => {
    let cancelled = false;
    setFrame("");
    setError("");
    setStatus(null);
    void (async () => {
      try {
        const first = await call({ action: "status" });
        const roomy = typeof first?.available_mb !== "number" || first.available_mb >= 3072;
        if (!cancelled && first?.ok !== false && first?.phase === "stopped" && roomy && autoStarted.current !== model) {
          autoStarted.current = model;
          await call({ action: "start", ...desktopSize() });
        }
      } catch (e: any) { if (!cancelled) setError(String(e?.message || e)); }
    })();
    return () => { cancelled = true; };
  }, [call, model]);

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
          lastStreamAt.current = Date.now();
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
            lastStreamAt.current = Date.now();
            const size = screenSizeOf(event);
            if (size) screenRef.current = size;
            if (typeof event.screenshot_b64 === "string" && event.screenshot_b64) setFrame("data:image/jpeg;base64," + event.screenshot_b64);
            if (event.phase) setStatus((prior: any) => ({ ...(prior || {}), phase: event.phase }));
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

  // Typing straight into the screen: the keyboard button focuses a hidden field (so the phone's keyboard opens), and what is typed there goes to the
  // desktop window under the pointer, in order. This is how a login form on a page the model opened can be filled in by hand.
  const kbRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const queue = useRef<Array<{ type?: string; key?: string; act?: Record<string, unknown> }>>([]);
  const draining = useRef(false);
  const drain = async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (queue.current.length) {
        const next = queue.current.shift()!;
        await call(next.act ? next.act : next.key ? { action: "key", key: next.key } : { action: "type", text: next.type });
      }
    } catch (e: any) { setError(String(e?.message || e)); queue.current = []; }
    finally { draining.current = false; }
  };
  const enqueue = (item: { type?: string; key?: string; act?: Record<string, unknown> }) => {
    const last = queue.current[queue.current.length - 1];
    if (item.type && last?.type !== undefined && (last.type + item.type).length <= 400) last.type += item.type;
    else queue.current.push(item);
    void drain();
  };
  const keyName = (event: React.KeyboardEvent): string | null => {
    const names: Record<string, string> = { " ": "space", "Enter": "Return", "Escape": "Escape", "Backspace": "BackSpace", "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right", "Delete": "Delete", "Tab": "Tab" };
    const key = names[event.key] || event.key;
    const modifiers = [event.ctrlKey ? "ctrl" : "", event.altKey ? "alt" : "", event.shiftKey ? "shift" : ""].filter(Boolean);
    const mapped = [...modifiers, key].join("+");
    return /^[A-Za-z0-9_+ -]{1,40}$/.test(mapped) ? mapped.replace(/ /g, "") : null;
  };
  const screenKey = (event: React.KeyboardEvent) => {
    const mapped = keyName(event);
    if (mapped) { event.preventDefault(); enqueue({ key: mapped }); }
  };
  const [kbOn, setKbOn] = useState(false);
  const toggleKeyboard = () => { try { if (kbOn) kbRef.current?.blur(); else kbRef.current?.focus({ preventScroll: true }); setKbOn(!kbOn); } catch { /* no keyboard field yet */ } };
  const takeTyped = () => {
    const el = kbRef.current;
    if (!el || !el.value) return;
    const text = el.value;
    el.value = "";
    enqueue({ type: text });
  };

  // A tap (touch) or a click (mouse) on the picture is a real click on the desktop at the mapped point. Input is queued in order, never dropped.
  const tapAt = (clientX: number, clientY: number, button: "left" | "right" = "left") => {
    const image = imageRef.current;
    if (!image) return;
    const rect = image.getBoundingClientRect();     // includes the pinch-zoom transform, so the mapping stays exact when zoomed
    const point = desktopPoint(rect, { clientX, clientY }, { width: image.naturalWidth, height: image.naturalHeight }, screenRef.current);
    if (!point) return;
    enqueue({ act: { action: "click", x: point.x, y: point.y, button } });
  };
  const tapRef = useRef(tapAt);
  tapRef.current = tapAt;
  const clickScreen = (event: React.MouseEvent<HTMLImageElement>, button: "left" | "right" = "left") => {
    // a touch ends with a synthetic click: the touch handler already sent it
    if (Date.now() - touchAt.current < 700) return;
    tapAt(event.clientX, event.clientY, button);
  };
  const scrollRef = useRef((_dir: "up" | "down", _amount: number) => {});
  scrollRef.current = (dir, amount) => enqueue({ act: { action: "scroll", direction: dir, amount } });

  // Pinch with two fingers zooms and pans the screen (the desktop itself is not touched); a tap clicks; a one-finger drag scrolls
  // (or pans when zoomed). The phone's keyboard opens only from the keyboard button, never from a plain tap.
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  useEffect(() => {
    const el = frameBox.current;
    if (!el || !running) return;
    let mode: "none" | "tap" | "pinch" = "none";
    let start = { x: 0, y: 0, t: 0, vx: 0, vy: 0 };
    let moved = false;
    let pinch = { d: 1, cx: 0, cy: 0, s: 1, x: 0, y: 0 };
    const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const apply = (next: { s: number; x: number; y: number }) => {
      const r = el.getBoundingClientRect();
      const s = Math.max(1, Math.min(4, next.s));
      const x = Math.max(r.width * (1 - s), Math.min(0, next.x));
      const y = Math.max(r.height * (1 - s), Math.min(0, next.y));
      viewRef.current = { s, x, y };
      setView({ s, x, y });
    };
    const onButton = (e: TouchEvent) => Boolean((e.target as HTMLElement)?.closest?.("[data-kb]"));
    const onStart = (e: TouchEvent) => {
      if (onButton(e)) return;
      if (e.touches.length === 2) {
        mode = "pinch";
        const r = el.getBoundingClientRect();
        const [a, b] = [e.touches[0], e.touches[1]];
        pinch = { d: dist(a, b) || 1, cx: (a.clientX + b.clientX) / 2 - r.left, cy: (a.clientY + b.clientY) / 2 - r.top, ...viewRef.current };
        e.preventDefault();
      } else if (e.touches.length === 1 && mode !== "pinch") {
        mode = "tap";
        moved = false;
        start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), vx: viewRef.current.x, vy: viewRef.current.y };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (onButton(e)) return;
      if (mode === "pinch" && e.touches.length === 2) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const [a, b] = [e.touches[0], e.touches[1]];
        const s = pinch.s * (dist(a, b) / pinch.d);
        const cx = (a.clientX + b.clientX) / 2 - r.left;
        const cy = (a.clientY + b.clientY) / 2 - r.top;
        const px = (pinch.cx - pinch.x) / pinch.s;
        const py = (pinch.cy - pinch.y) / pinch.s;
        apply({ s, x: cx - px * Math.max(1, Math.min(4, s)), y: cy - py * Math.max(1, Math.min(4, s)) });
      } else if (mode === "tap" && e.touches.length === 1) {
        const dx = e.touches[0].clientX - start.x;
        const dy = e.touches[0].clientY - start.y;
        if (Math.hypot(dx, dy) > 12) moved = true;
        if (moved && viewRef.current.s > 1) { e.preventDefault(); apply({ s: viewRef.current.s, x: start.vx + dx, y: start.vy + dy }); }
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (onButton(e)) return;
      if (mode === "tap" && e.touches.length === 0) {
        const touch = e.changedTouches[0];
        if (!moved && Date.now() - start.t < 700) {
          e.preventDefault();
          touchAt.current = Date.now();
          tapRef.current(start.x, start.y);
        } else if (moved && viewRef.current.s === 1 && touch) {
          const dy = touch.clientY - start.y;
          if (Math.abs(dy) > 24) { touchAt.current = Date.now(); scrollRef.current(dy < 0 ? "down" : "up", Math.max(1, Math.min(8, Math.ceil(Math.abs(dy) / 70)))); }
        }
      }
      if (e.touches.length === 0) mode = "none";
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [running]);
  // The model's own activity, BELOW the screen (owner's order: nothing is drawn over the screen): one readable line per
  // event, newest last, with the redundant raw fields the activity feed carries dropped.

  return (
    <div className="n-card" style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        {!running ? (
          <button type="button" className="n-btn" disabled={busy || preparing || status?.phase === "busy"} onClick={() => void perform({ action: "start", ...desktopSize() })}>
            {busy || preparing ? (ar ? "جارٍ التجهيز…" : "Preparing…") : (ar ? "تشغيل سطح المكتب" : "Start desktop")}
          </button>
        ) : (
          <button type="button" className="n-btn n-ghost" disabled={busy} onClick={() => void perform({ action: "stop" })}>
            {ar ? "إيقاف سطح المكتب" : "Stop desktop"}
          </button>
        )}
        <span className="n-meta" style={{ marginInlineStart: "auto" }}>
          {running ? (ar ? "متصل" : "Connected") : preparing ? (ar ? "يثبّت مكوّنات سطح المكتب" : "Installing desktop components") : status?.phase === "busy" ? (ar ? "الاستوديو مشغول بمستخدم آخر" : "Studio is busy") : (ar ? "متوقف" : "Stopped")}
        </span>
      </div>
      <div className="n-meta" style={{ marginBottom: 8 }}>
        {ar
          ? "الذاكرة المتاحة في الحاسوب المركزي: " + available + ". يتطلب البدء 3072 MB على الأقل. "
          : "Computer hub memory available: " + available + ". Start requires at least 3072 MB. "}
        {running ? (mode === "live" || mode === "reconnecting" ? (ar ? "بث حي للشاشة والأنشطة." : "Live screen and activity stream.") : (ar ? "وضع اللقطات الاحتياطي." : "Fallback screenshot mode.")) : null}
        {status?.packages?.ready === false ? (ar ? " ستُثبّت مكونات X11 عند التشغيل الأول." : " X11 components will be installed on first start.") : null}
      </div>
      {error ? <div className="n-note" role="alert" style={{ marginBottom: 8 }}>{error}</div> : null}
      <div ref={frameBox} style={{ position: "relative", width: "100%", ...(frame && running && screenSizeOf(status) ? { aspectRatio: `${screenSizeOf(status)!.w} / ${screenSizeOf(status)!.h}` } : { minHeight: 320 }), background: "#0b1220", border: "1px solid #8885", borderRadius: 10, overflow: "hidden", touchAction: "none" }}>
      {frame && running ? (
        <div style={{ position: "absolute", inset: 0, transformOrigin: "0 0", transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
        <img
          ref={imageRef}
          src={frame}
          alt={ar ? "شاشة سطح مكتب Linux" : "Linux desktop screen"}
          onClick={(event) => clickScreen(event)}
          onContextMenu={(event) => { event.preventDefault(); clickScreen(event, "right"); }}
          onWheel={(event) => scrollRef.current(event.deltaY < 0 ? "up" : "down", Math.max(1, Math.min(8, Math.ceil(Math.abs(event.deltaY) / 100))))}
          tabIndex={0}
          onKeyDown={(event) => screenKey(event)}
          style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%", objectFit: "fill", background: "#111827", cursor: "crosshair", touchAction: "none" }}
        />
        </div>
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
          <button
            type="button"
            data-kb="1"
            aria-label={ar ? "لوحة المفاتيح" : "Keyboard"}
            onClick={toggleKeyboard}
            style={{ position: "absolute", right: 10, bottom: "6%", width: 44, height: 44, borderRadius: 22, border: "1px solid #5eead4", background: kbOn ? "#0d9488" : "#111827cc", color: "#fff", fontSize: 20, lineHeight: "40px", zIndex: 3 }}
          >⌨</button>
        ) : null}
        {running ? (
          <input
            ref={kbRef}
            aria-label={ar ? "لوحة المفاتيح للشاشة" : "Screen keyboard"}
            autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
            onInput={() => { if (!composing.current) takeTyped(); }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; takeTyped(); }}
            onBlur={() => setKbOn(false)}
            onKeyDown={(event) => { if (event.key.length > 1 || event.ctrlKey || event.altKey) screenKey(event); }}
            style={{ position: "absolute", left: 0, bottom: 0, width: 1, height: 1, opacity: 0, border: 0, padding: 0, pointerEvents: "none" }}
          />
        ) : null}
      </div>
    </div>
  );
}
