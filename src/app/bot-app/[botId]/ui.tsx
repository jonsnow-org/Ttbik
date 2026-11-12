"use client";
// Shared pieces of the ads & earn bot's Mini App: the Telegram WebApp bridge, the API call, the screen stack, and small UI parts
// painted with Telegram's own theme colours (CSS variables set by telegram-web-app.js, with light fallbacks).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Tg = any;
export function getTg(): Tg | null {
  if (typeof window === "undefined") return null;
  return (window as any).Telegram?.WebApp || null;
}

export type Lang = "ar" | "en";
export type Screen = { name: string; params?: Record<string, any> };

type Ctx = {
  botId: string;
  tg: Tg | null;
  lang: Lang;
  setLang: (l: Lang) => void;
  api: <T = any>(action: string, body?: Record<string, unknown>) => Promise<T & { ok: boolean; error?: string; code?: string }>;
  push: (s: Screen) => void;
  replace: (s: Screen) => void;
  back: () => void;
  reset: (s?: Screen) => void;
  stack: Screen[];
  toast: (text: string, kind?: "ok" | "err") => void;
  setDirty: (on: boolean) => void;
  haptic: (kind?: "light" | "success" | "error") => void;
  open: (url: string) => void;
  copy: (text: string) => void;
  confirm: (text: string) => Promise<boolean>;
  native: boolean;
  /** A section with its own sub-screens takes over the Back button while one is open (null to release). */
  interceptBack: (fn: (() => void) | null) => void;
};
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export function AppProvider({ botId, initial, lang, setLang, children }: { botId: string; initial: Screen; lang: Lang; setLang: (l: Lang) => void; children: React.ReactNode }) {
  const tg = getTg();
  const [stack, setStack] = useState<Screen[]>(initial.name === "home" ? [initial] : [{ name: "home" }, initial]);
  const [toastMsg, setToast] = useState<{ id: number; text: string; kind: "ok" | "err" } | null>(null);
  const toastSequence = useRef(0);
  const dirty = useRef(false);
  const intercept = useRef<(() => void) | null>(null);
  const interceptBack = useCallback((fn: (() => void) | null) => { intercept.current = fn; }, []);
  const native = !!(tg && tg.platform && tg.platform !== "unknown" && tg.MainButton);

  const haptic = useCallback((kind: "light" | "success" | "error" = "light") => {
    const h = tg?.HapticFeedback;
    if (!h) return;
    try { if (kind === "light") h.impactOccurred("light"); else h.notificationOccurred(kind); } catch { /* old clients */ }
  }, [tg]);
  const toast = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = ++toastSequence.current;
    setToast({ id, text, kind });
    haptic(kind === "ok" ? "success" : "error");
    window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), 3200);
  }, [haptic]);
  const confirm = useCallback((text: string) => new Promise<boolean>((resolve) => {
    if (tg?.showConfirm && tg.platform !== "unknown") { try { tg.showConfirm(text, (ok: boolean) => resolve(!!ok)); return; } catch { /* fall through */ } }
    resolve(window.confirm(text));
  }), [tg]);
  const api = useCallback(async (action: string, body: Record<string, unknown> = {}) => {
    try {
      const res = await fetch(`/api/bot-app/${encodeURIComponent(botId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, action, initData: tg?.initData || "" }) });
      const data = await res.json().catch(() => ({ ok: false, error: "تعذّر الاتصال" }));
      return data;
    } catch {
      return { ok: false, error: lang === "en" ? "Connection problem, try again." : "تعذّر الاتصال، حاول مرة أخرى." };
    }
  }, [botId, tg, lang]);
  const setDirty = useCallback((on: boolean) => {
    dirty.current = on;
    try { if (on) tg?.enableClosingConfirmation?.(); else tg?.disableClosingConfirmation?.(); } catch { /* old clients */ }
  }, [tg]);
  const push = useCallback((s: Screen) => { haptic(); setDirty(false); intercept.current = null; setStack((st) => [...st, s]); window.scrollTo(0, 0); }, [haptic, setDirty]);
  const replace = useCallback((s: Screen) => { setDirty(false); setStack((st) => [...st.slice(0, -1), s]); window.scrollTo(0, 0); }, [setDirty]);
  const reset = useCallback((s?: Screen) => { setDirty(false); intercept.current = null; setStack(s && s.name !== "home" ? [{ name: "home" }, s] : [{ name: "home" }]); window.scrollTo(0, 0); }, [setDirty]);
  const back = useCallback(async () => {
    // Standing order: the Back button asks before throwing away what the user typed.
    if (dirty.current && !(await confirm(lang === "en" ? "Discard what you entered?" : "تجاهل ما أدخلته والرجوع؟"))) return;
    setDirty(false);
    if (intercept.current) { const fn = intercept.current; intercept.current = null; fn(); window.scrollTo(0, 0); return; }
    setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));
    window.scrollTo(0, 0);
  }, [confirm, lang, setDirty]);
  const open = useCallback((url: string) => {
    if (/^https:\/\/t\.me\//i.test(url) && tg?.openTelegramLink) { try { tg.openTelegramLink(url); return; } catch { /* fall through */ } }
    if (tg?.openLink) { try { tg.openLink(url); return; } catch { /* fall through */ } }
    window.open(url, "_blank", "noopener");
  }, [tg]);
  const copy = useCallback(async (text: string) => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch { /* fall back for Telegram webviews and non-secure contexts */ }
    if (!copied) {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      field.style.pointerEvents = "none";
      document.body.appendChild(field);
      field.select();
      try { copied = document.execCommand("copy"); } catch { copied = false; }
      field.remove();
    }
    toast(copied ? (lang === "en" ? "Copied" : "تم النسخ ✓") : (lang === "en" ? "Copy failed. Select and copy manually." : "تعذّر النسخ؛ حدّد النص وانسخه يدوياً."), copied ? "ok" : "err");
  }, [toast, lang]);

  // Telegram's BackButton: visible on every screen but the home screen.
  const backRef = useRef(back);
  useEffect(() => { backRef.current = back; });
  useEffect(() => {
    const bb = tg?.BackButton;
    if (!bb) return;
    const h = () => backRef.current();
    bb.onClick(h);
    return () => { try { bb.offClick(h); } catch { /* ignore */ } };
  }, [tg]);
  useEffect(() => {
    const bb = tg?.BackButton;
    if (!bb) return;
    if (stack.length > 1) bb.show(); else bb.hide();
  }, [tg, stack.length]);

  const value = useMemo<Ctx>(() => ({ botId, tg, lang, setLang, api, push, replace, back, reset, stack, toast, setDirty, haptic, open, copy, confirm, native, interceptBack }), [botId, tg, lang, setLang, api, push, replace, back, reset, stack, toast, setDirty, haptic, open, copy, confirm, native, interceptBack]);
  return (
    <AppCtx.Provider value={value}>
      {children}
      {toastMsg && (
        <div role="status" aria-live="polite" aria-atomic="true" className="fixed inset-x-3 z-50 mx-auto max-w-md rounded-2xl px-4 py-3 text-center text-sm font-bold shadow-lg"
          style={{ background: toastMsg.kind === "ok" ? "#0f766e" : "#b91c1c", color: "#fff", bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}>{toastMsg.text}</div>
      )}
    </AppCtx.Provider>
  );
}

/** The screen's main action: Telegram's MainButton inside Telegram, an in-page button elsewhere (and in tests). */
export function MainAction({ text, onClick, disabled, busy, color }: { text: string; onClick: () => void; disabled?: boolean; busy?: boolean; color?: string }) {
  const { tg, native } = useApp();
  const ref = useRef(onClick);
  useEffect(() => { ref.current = onClick; });
  useEffect(() => {
    if (!native) return;
    const mb = tg.MainButton;
    const h = () => { if (!disabled && !busy) ref.current(); };
    mb.setParams({ text, is_visible: true, is_active: !disabled && !busy, ...(color ? { color } : {}) });
    if (busy) mb.showProgress?.(false); else mb.hideProgress?.();
    mb.onClick(h);
    return () => { try { mb.offClick(h); mb.hideProgress?.(); mb.hide(); } catch { /* ignore */ } };
  }, [native, tg, text, disabled, busy, color]);
  if (native) return null;
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 px-4 pt-2" style={{ background: "linear-gradient(to top, var(--app-bg) 70%, transparent)", paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}>
      <button type="button" onClick={onClick} disabled={disabled || busy}
        className="w-full rounded-xl py-3.5 text-base font-extrabold shadow-sm transition active:scale-[0.99] disabled:opacity-50"
        style={{ background: color || "var(--app-btn)", color: "var(--app-btn-text)" }}>{busy ? "…" : text}</button>
    </div>
  );
}

export function Section({ title, children, hint, right }: { title?: string; children: React.ReactNode; hint?: string; right?: React.ReactNode }) {
  return (
    <section className="mb-4">
      {(title || right) && (
        <div className="mb-1.5 flex items-center justify-between px-1">
          {title && <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--app-section-header)" }}>{title}</h2>}
          {right}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl" style={{ background: "var(--app-card)" }}>{children}</div>
      {hint && <p className="mt-1.5 px-1 text-xs leading-5" style={{ color: "var(--app-hint)" }}>{hint}</p>}
    </section>
  );
}

export function Row({ icon, title, sub, onClick, right, danger }: { icon?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; right?: React.ReactNode; danger?: boolean }) {
  const C: any = onClick ? "button" : "div";
  return (
    <C type={onClick ? "button" : undefined} onClick={onClick} className="flex w-full items-center gap-3 border-b px-4 py-3 text-start last:border-b-0 active:opacity-70" style={{ borderColor: "var(--app-sep)" }}>
      {icon !== undefined && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg" style={{ background: "var(--app-chip)" }}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold" style={{ color: danger ? "var(--app-danger)" : "var(--app-text)" }}>{title}</span>
        {sub && <span className="mt-0.5 block text-xs leading-5" style={{ color: "var(--app-hint)" }}>{sub}</span>}
      </span>
      {right ?? (onClick ? <span style={{ color: "var(--app-hint)" }}>‹</span> : null)}
    </C>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block border-b px-4 py-3 last:border-b-0" style={{ borderColor: "var(--app-sep)" }}>
      <span className="mb-1 block text-xs font-bold" style={{ color: "var(--app-hint)" }}>{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs leading-5" style={{ color: "var(--app-hint)" }}>{hint}</span>}
      {error && <span className="mt-1 block text-xs font-bold leading-5" style={{ color: "var(--app-danger)" }}>{error}</span>}
    </label>
  );
}

export const inputCls = "w-full bg-transparent text-[16px] outline-none placeholder:opacity-50";
export const inputStyle: React.CSSProperties = { color: "var(--app-text)" };

export function Chips<T extends string>({ items, value, onChange, wrap = true }: { items: { id: T; label: React.ReactNode }[]; value: T | null | undefined; onChange: (v: T) => void; wrap?: boolean }) {
  return (
    <div className={`flex gap-2 ${wrap ? "flex-wrap" : "no-scrollbar overflow-x-auto pb-1"}`}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button key={it.id} type="button" onClick={() => onChange(it.id)}
            className="shrink-0 rounded-full px-3.5 py-2 text-sm font-bold transition active:scale-95"
            style={on ? { background: "var(--app-btn)", color: "var(--app-btn-text)" } : { background: "var(--app-chip)", color: "var(--app-text)" }}>{it.label}</button>
        );
      })}
    </div>
  );
}

export function Btn({ children, onClick, kind = "primary", disabled, small, className = "" }: { children: React.ReactNode; onClick?: () => void; kind?: "primary" | "soft" | "danger" | "ghost"; disabled?: boolean; small?: boolean; className?: string }) {
  const style: React.CSSProperties = kind === "primary" ? { background: "var(--app-btn)", color: "var(--app-btn-text)" }
    : kind === "danger" ? { background: "color-mix(in srgb, var(--app-danger) 12%, transparent)", color: "var(--app-danger)" }
    : kind === "ghost" ? { background: "transparent", color: "var(--app-link)" }
    : { background: "var(--app-chip)", color: "var(--app-link)" };
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={style}
      className={`rounded-xl font-bold transition active:scale-[0.98] disabled:opacity-50 ${small ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm"} ${className}`}>{children}</button>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "ok" | "warn" | "bad" | "info" }) {
  const map = { neutral: ["var(--app-chip)", "var(--app-hint)"], ok: ["#dcfce7", "#166534"], warn: ["#fef3c7", "#92400e"], bad: ["#fee2e2", "#991b1b"], info: ["#e0f2fe", "#075985"] } as const;
  const [bg, fg] = map[tone];
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: bg, color: fg }}>{children}</span>;
}

export function Empty({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="mt-2 text-[15px] font-bold" style={{ color: "var(--app-text)" }}>{title}</div>
      {sub && <p className="mx-auto mt-1 max-w-xs text-xs leading-5" style={{ color: "var(--app-hint)" }}>{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: lines }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl" style={{ background: "var(--app-card)" }} />)}
    </div>
  );
}

export function Copyable({ value, label, mono = true }: { value: string; label?: string; mono?: boolean }) {
  const { copy, lang } = useApp();
  return (
    <div className="flex items-center gap-2 border-b px-4 py-3 last:border-b-0" style={{ borderColor: "var(--app-sep)" }}>
      <div className="min-w-0 flex-1">
        {label && <div className="text-xs font-bold" style={{ color: "var(--app-hint)" }}>{label}</div>}
        <div className={`break-all text-[15px] font-bold ${mono ? "font-mono" : ""}`} style={{ color: "var(--app-text)" }} dir="ltr">{value}</div>
      </div>
      <Btn small kind="soft" onClick={() => copy(value)}>{lang === "en" ? "Copy" : "نسخ"}</Btn>
    </div>
  );
}

export function ScreenTitle({ title, sub, icon }: { title: string; sub?: string; icon?: string }) {
  return (
    <div className="mb-4 px-1 pt-1">
      <h1 className="text-[22px] font-extrabold leading-tight" style={{ color: "var(--app-text)" }}>{icon ? `${icon} ` : ""}{title}</h1>
      {sub && <p className="mt-1 text-[13px] leading-6" style={{ color: "var(--app-hint)" }}>{sub}</p>}
    </div>
  );
}

export const money = (n: number, d = 2) => `$${(Number(n) || 0).toFixed(d)}`;
export const moneyCpc = (n: number) => `$${(Number(n) || 0).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;

/** Per-user storage scoped to this bot: Telegram CloudStorage when available, localStorage otherwise. */
export function useStore() {
  const { tg, botId } = useApp();
  const get = useCallback((key: string) => new Promise<string | null>((resolve) => {
    const k = `${key}`;
    const cs = tg?.CloudStorage;
    if (cs && tg.isVersionAtLeast?.("6.9")) { try { cs.getItem(k, (e: unknown, v: string) => resolve(e ? null : v || null)); return; } catch { /* fall through */ } }
    try { resolve(window.localStorage.getItem(`bot-app:${botId}:${k}`)); } catch { resolve(null); }
  }), [tg, botId]);
  const set = useCallback((key: string, value: string) => new Promise<void>((resolve) => {
    const cs = tg?.CloudStorage;
    try { window.localStorage.setItem(`bot-app:${botId}:${key}`, value); } catch { /* private mode */ }
    if (cs && tg.isVersionAtLeast?.("6.9")) { try { cs.setItem(key, value, () => resolve()); return; } catch { /* fall through */ } }
    resolve();
  }), [tg, botId]);
  return { get, set };
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => { if (ms == null) return; const i = window.setInterval(() => ref.current(), ms); return () => window.clearInterval(i); }, [ms]);
}

/** Inner sub-screen of a section: while `active`, Telegram's Back button (and the stack's back) runs `onBack` instead. */
export function useInnerBack(active: boolean, onBack: () => void) {
  const { interceptBack } = useApp();
  const ref = useRef(onBack);
  useEffect(() => { ref.current = onBack; });
  useEffect(() => {
    if (!active) { interceptBack(null); return; }
    interceptBack(() => ref.current());
    return () => interceptBack(null);
  }, [active, interceptBack]);
}

/** Telegram theme colours (set by telegram-web-app.js as --tg-theme-*) mapped to the app's own variables, with light fallbacks. */
export const THEME: React.CSSProperties = {
  ["--app-bg" as any]: "var(--tg-theme-secondary-bg-color, #f1f2f6)",
  ["--app-card" as any]: "var(--tg-theme-section-bg-color, var(--tg-theme-bg-color, #ffffff))",
  ["--app-text" as any]: "var(--tg-theme-text-color, #0f172a)",
  ["--app-hint" as any]: "var(--tg-theme-hint-color, #6b7280)",
  ["--app-link" as any]: "var(--tg-theme-link-color, #2481cc)",
  ["--app-btn" as any]: "var(--tg-theme-button-color, #2481cc)",
  ["--app-btn-text" as any]: "var(--tg-theme-button-text-color, #ffffff)",
  ["--app-danger" as any]: "var(--tg-theme-destructive-text-color, #e53935)",
  ["--app-section-header" as any]: "var(--tg-theme-section-header-text-color, var(--tg-theme-hint-color, #6b7280))",
  ["--app-sep" as any]: "color-mix(in srgb, var(--tg-theme-hint-color, #6b7280) 18%, transparent)",
  ["--app-chip" as any]: "color-mix(in srgb, var(--tg-theme-button-color, #2481cc) 11%, var(--tg-theme-section-bg-color, var(--tg-theme-bg-color, #ffffff)))",
};

export function AppFrame({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return (
    <div dir={lang === "en" ? "ltr" : "rtl"} lang={lang} style={{ ...THEME, background: "var(--app-bg)", color: "var(--app-text)", minHeight: "100dvh", paddingBottom: "env(safe-area-inset-bottom, 0px)", fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Noto Sans Arabic\", Tahoma, Arial, sans-serif", WebkitTapHighlightColor: "transparent" }}>
      {children}
    </div>
  );
}
