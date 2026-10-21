"use client";
// Nova AI Mini App palettes, all on Fadaa's slate/teal scale (src/components/fadaa/fadaa.css, read-only: Fadaa itself is not touched).
// "black" is exactly Fadaa's dark identity palette (the owner calls it "the black"); "oled" is a deeper true-black variant on the same
// scale; "light" is built on the same scale with Fadaa's teal accent. "auto" follows Telegram: dark → black, light → light.
// The choice is kept on this device (localStorage "nova_theme"), so it applies at once without a server round trip.
import { miniApp, viewport } from "@tma.js/sdk-react";

export type ThemeMode = "auto" | "light" | "black" | "oled";
export type Resolved = Exclude<ThemeMode, "auto">;
export const THEME_MODES: ThemeMode[] = ["auto", "light", "black", "oled"];

type Pal = {
  bg: string; surface: string; surface2: string; ink: string; inkMuted: string; inkSoft: string; border: string; borderStrong: string;
  primary: string; primaryHover: string; primarySoft: string; primaryInk: string; onPrimary: string; accent: string; warn: string;
  danger: string; success: string; shadowNav: string; shadowLg: string; hero: string; heroTop: string; tgHeader: string; tgBg: string; tgBottom: string;
};
export const PALETTES: Record<Resolved, Pal> = {
  black: {
    bg: "#0f172a", surface: "#1e293b", surface2: "#334155", ink: "#f1f5f9", inkMuted: "#cbd5e1", inkSoft: "#94a3b8", border: "#334155", borderStrong: "#475569",
    primary: "#2dd4bf", primaryHover: "#5eead4", primarySoft: "#134e4a", primaryInk: "#99f6e4", onPrimary: "#042f2e", accent: "#60a5fa", warn: "#fbbf24",
    danger: "#f87171", success: "#4ade80", shadowNav: "0 8px 28px rgba(0,0,0,.45)", shadowLg: "0 16px 40px rgba(0,0,0,.5)",
    hero: "linear-gradient(180deg,#0f766e 0%,#0d9488 26%,rgba(45,212,191,.55) 52%,#0f172a 100%)", heroTop: "#0f766e",
    tgHeader: "#1e293b", tgBg: "#0f172a", tgBottom: "#1e293b",
  },
  oled: {
    bg: "#000000", surface: "#0f172a", surface2: "#1e293b", ink: "#f1f5f9", inkMuted: "#cbd5e1", inkSoft: "#94a3b8", border: "#1e293b", borderStrong: "#334155",
    primary: "#2dd4bf", primaryHover: "#5eead4", primarySoft: "#0b2e2b", primaryInk: "#99f6e4", onPrimary: "#042f2e", accent: "#60a5fa", warn: "#fbbf24",
    danger: "#f87171", success: "#4ade80", shadowNav: "0 0 0 1px #1e293b, 0 8px 28px rgba(0,0,0,.6)", shadowLg: "0 16px 40px rgba(0,0,0,.5)",
    hero: "linear-gradient(180deg,#0f766e 0%,#0d9488 26%,rgba(45,212,191,.45) 52%,#000000 100%)", heroTop: "#0f766e",
    tgHeader: "#000000", tgBg: "#000000", tgBottom: "#000000",
  },
  light: {
    bg: "#f1f5f9", surface: "#ffffff", surface2: "#e2e8f0", ink: "#0f172a", inkMuted: "#334155", inkSoft: "#64748b", border: "#e2e8f0", borderStrong: "#cbd5e1",
    primary: "#0d9488", primaryHover: "#0f766e", primarySoft: "#ccfbf1", primaryInk: "#115e59", onPrimary: "#ffffff", accent: "#2563eb", warn: "#d97706",
    danger: "#dc2626", success: "#16a34a", shadowNav: "0 8px 24px rgba(15,23,42,.10)", shadowLg: "0 16px 40px rgba(15,23,42,.16)",
    hero: "linear-gradient(180deg,#0d9488 0%,#2dd4bf 40%,rgba(153,246,228,.6) 68%,#f1f5f9 100%)", heroTop: "#0d9488",
    tgHeader: "#ffffff", tgBg: "#f1f5f9", tgBottom: "#ffffff",
  },
};

const KEY = "nova_theme";
export function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY) as ThemeMode | null;
    return v && THEME_MODES.includes(v) ? v : "auto";
  } catch {
    return "auto";
  }
}
export function saveMode(m: ThemeMode): void {
  try { localStorage.setItem(KEY, m); } catch { /* private mode */ }
}
export const resolveMode = (m: ThemeMode, tgDark: boolean): Resolved => (m === "auto" ? (tgDark ? "black" : "light") : m);

/** --n-* for Nova's own pieces and --tgui--* so telegram-ui's components (forms, sheets, switches) use the same palette. */
export function themeVars(r: Resolved): Record<string, string> {
  const p = PALETTES[r];
  return {
    "--n-bg": p.bg, "--n-surface": p.surface, "--n-surface-2": p.surface2, "--n-ink": p.ink, "--n-ink-muted": p.inkMuted, "--n-ink-soft": p.inkSoft,
    "--n-border": p.border, "--n-border-strong": p.borderStrong, "--n-primary": p.primary, "--n-primary-hover": p.primaryHover,
    "--n-primary-soft": p.primarySoft, "--n-primary-ink": p.primaryInk, "--n-on-primary": p.onPrimary, "--n-accent": p.accent, "--n-warn": p.warn,
    "--n-danger": p.danger, "--n-success": p.success, "--n-shadow-nav": p.shadowNav, "--n-shadow-lg": p.shadowLg, "--n-hero": p.hero,
    "--tgui--bg_color": p.surface, "--tgui--section_bg_color": p.surface, "--tgui--card_bg_color": p.surface,
    "--tgui--secondary_bg_color": p.bg, "--tgui--header_bg_color": p.bg,
    "--tgui--tertiary_bg_color": p.surface2, "--tgui--quartenary_bg_color": p.surface2, "--tgui--segmented_control_active_bg": p.surface2,
    "--tgui--text_color": p.ink, "--tgui--hint_color": p.inkSoft, "--tgui--subtitle_text_color": p.inkSoft, "--tgui--secondary_hint_color": p.inkSoft,
    "--tgui--link_color": p.primary, "--tgui--accent_text_color": p.primary, "--tgui--button_color": p.primary, "--tgui--section_header_text_color": p.primary,
    "--tgui--button_text_color": p.onPrimary, "--tgui--destructive_text_color": p.danger, "--tgui--divider": p.border, "--tgui--outline": p.border,
    "--tgui--skeleton": p.surface2,
  };
}

const tryDo = (f: () => unknown) => { try { f(); } catch { /* not in Telegram / not supported on this client */ } };
const can = (fn: any) => { try { return Boolean(fn?.isAvailable?.()); } catch { return false; } };
/** Telegram's own header / background / bottom bar in Nova's colours (the header matches the Home gradient on Home). */
export function paintTelegram(r: Resolved, onHero: boolean): void {
  const p = PALETTES[r];
  const header = onHero ? p.heroTop : p.bg;
  if (can(miniApp.setHeaderColor)) tryDo(() => miniApp.setHeaderColor(header));
  if (can(miniApp.setBgColor)) tryDo(() => miniApp.setBgColor(p.bg));
  if (can(miniApp.setBottomBarColor)) tryDo(() => miniApp.setBottomBarColor(p.tgBottom));
  try { document.documentElement.style.background = p.bg; } catch { /* SSR */ }
}
/** Like Mira: Telegram's own header bar (✕, title, ⋮) stays visible, so no full screen. */
export function leaveFullscreen(): void {
  try {
    if (viewport.isMounted() && viewport.isFullscreen() && can(viewport.exitFullscreen)) void Promise.resolve(viewport.exitFullscreen()).catch(() => null);
  } catch { /* older clients */ }
}
