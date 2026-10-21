"use client";
// The coder Mini App's bridge to Telegram, on the official tma.js SDK (@tma.js/sdk-react, the SDK the Telegram-Mini-Apps/nextjs-template
// uses) instead of the raw telegram-web-app.js global. Everything here is safe to call outside Telegram (it simply does nothing).
import {
  addToHomeScreen, backButton, biometry, checkHomeScreenStatus, closingBehavior, hapticFeedback, init, initData, invoice, isTMA,
  mainButton, miniApp, openLink as tmaOpenLink, openTelegramLink, retrieveLaunchParams, retrieveRawInitData, swipeBehavior, themeParams, viewport,
} from "@tma.js/sdk-react";

let started = false;
let raw = "";
export type Launch = { platform: string; startParam: string; languageCode: string; firstName: string; inTelegram: boolean };
let launch: Launch = { platform: "unknown", startParam: "", languageCode: "", firstName: "", inTelegram: false };

const tryDo = <T,>(f: () => T): T | undefined => {
  try {
    return f();
  } catch {
    return undefined;
  }
};
const avail = (fn: any) => Boolean(tryDo(() => fn?.isAvailable?.()));

/** Mounts the SDK once: theme + viewport CSS variables (incl. safe areas), back button, swipe / closing behaviour, full screen. */
export async function startTma(): Promise<Launch> {
  if (started) return launch;
  started = true;
  const inTelegram = Boolean(tryDo(() => isTMA()));
  if (!inTelegram) return launch;
  tryDo(() => init());
  raw = tryDo(() => retrieveRawInitData()) || "";
  const lp: any = tryDo(() => retrieveLaunchParams()) || {};
  const user = tryDo(() => (initData.restore(), initData.user())) as any;
  launch = {
    platform: String(lp.tgWebAppPlatform || "unknown"),
    startParam: String(lp.tgWebAppStartParam || ""),
    languageCode: String(user?.language_code || user?.languageCode || ""),
    firstName: String(user?.first_name || user?.firstName || ""),
    inTelegram,
  };
  tryDo(() => backButton.mount());
  // theme params FIRST (as in the official tma.js template): miniApp's colours and isDark() derive from them, and without this mount
  // bindCssVars() fails, so the app stayed light with fallback colours inside a dark Telegram
  tryDo(() => themeParams.mount());
  tryDo(() => miniApp.mount());
  tryDo(() => themeParams.bindCssVars());
  tryDo(() => miniApp.bindCssVars());
  tpLaunch = (lp.tgWebAppThemeParams || {}) as Record<string, string>;
  tryDo(() => swipeBehavior.mount());
  if (avail(swipeBehavior.disableVertical)) tryDo(() => swipeBehavior.disableVertical());   // scrolling lists never closes the app
  tryDo(() => closingBehavior.mount());
  await tryDo(() => viewport.mount())?.catch?.(() => null);
  tryDo(() => viewport.bindCssVars());                    // --tg-viewport-height, --tg-viewport-safe-area-inset-*, --tg-viewport-content-safe-area-inset-*
  tryDo(() => viewport.expand());
  // full screen on phones (Telegram 8.0+); desktop keeps the normal window
  if ((launch.platform === "ios" || launch.platform === "android") && avail(viewport.requestFullscreen)) await tryDo(() => viewport.requestFullscreen())?.catch?.(() => null);
  tryDo(() => miniApp.ready());
  return launch;
}

export const rawInitData = () => raw || tryDo(() => retrieveRawInitData()) || "";
export const getLaunch = () => launch;
let tpLaunch: Record<string, string> = {};
const darkHex = (hex?: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128;
};
/** Telegram's own theme decides dark/light: theme params (live), then the mini app, then the launch theme, then the legacy global. */
export const isDark = (): boolean => {
  const tp = tryDo(() => (themeParams.isMounted() ? themeParams.isDark() : undefined));
  if (typeof tp === "boolean") return tp;
  const ma = tryDo(() => (miniApp.isMounted() ? miniApp.isDark() : undefined));
  if (ma === true) return true;
  const lp = darkHex(tpLaunch.bg_color || tpLaunch.bgColor || tpLaunch.secondary_bg_color || tpLaunch.secondaryBgColor);
  if (typeof lp === "boolean") return lp;
  const g = tryDo(() => (window as any).Telegram?.WebApp?.colorScheme);
  return g === "dark" || Boolean(ma);
};
export const isApple = () => launch.platform === "ios" || launch.platform === "macos";
export const isAndroid = () => launch.platform === "android" || launch.platform === "android_x";

export function haptic(k: "light" | "medium" | "success" | "warning" | "error" | "select"): void {
  if (k === "select") {
    if (avail(hapticFeedback.selectionChanged)) tryDo(() => hapticFeedback.selectionChanged());
  } else if (k === "success" || k === "warning" || k === "error") {
    if (avail(hapticFeedback.notificationOccurred)) tryDo(() => hapticFeedback.notificationOccurred(k));
  } else if (avail(hapticFeedback.impactOccurred)) tryDo(() => hapticFeedback.impactOccurred(k));
}

export function openExternal(url: string): void {
  if (avail(tmaOpenLink)) tryDo(() => tmaOpenLink(url, { tryInstantView: false }));
  else window.open(url, "_blank", "noopener");
}
/** Back to the chat with the bot (closes the Mini App). */
export function closeApp(): void {
  tryDo(() => miniApp.close());
}
export function openTg(url: string): void {
  if (avail(openTelegramLink)) tryDo(() => openTelegramLink(url));
  else window.open(url, "_blank", "noopener");
}

/** Telegram Stars invoice (createInvoiceLink URL) → "paid" | "cancelled" | "failed" | "pending" | "unsupported". */
export async function payInvoice(url: string): Promise<string> {
  if (!avail(invoice.openUrl)) {
    openTg(url);
    return "unsupported";
  }
  try {
    return String(await invoice.openUrl(url));
  } catch {
    return "failed";
  }
}

/** The Telegram back button while a sheet / sub-page is open. Returns a cleanup. */
export function useBack(on: boolean, cb: () => void): () => void {
  if (!on) {
    tryDo(() => backButton.hide());
    return () => undefined;
  }
  tryDo(() => backButton.show());
  const off = tryDo(() => backButton.onClick(cb));
  return () => {
    tryDo(() => off?.());
    tryDo(() => backButton.hide());
  };
}

/** Ask before closing while a long form is being edited. */
export const confirmClose = (on: boolean) => tryDo(() => (on ? closingBehavior.enableConfirmation() : closingBehavior.disableConfirmation()));

// ---------------------------------------------------------------- home screen shortcut
export const canAddToHome = () => avail(addToHomeScreen);
export async function homeStatus(): Promise<string> {
  if (!avail(checkHomeScreenStatus)) return "unsupported";
  try {
    const r: any = await (checkHomeScreenStatus as any)();
    return typeof r === "string" ? r : String(r?.right ?? r ?? "unknown");
  } catch {
    return "unknown";
  }
}
export const addToHome = () => tryDo(() => addToHomeScreen());

// ---------------------------------------------------------------- biometric unlock (optional, per device)
const BIO_KEY = "coder.bio";
export const bioWanted = () => tryDo(() => localStorage.getItem(BIO_KEY) === "1") || false;
export async function bioSupported(): Promise<boolean> {
  if (!launch.inTelegram) return false;
  if (!tryDo(() => biometry.isMounted())) await tryDo(() => biometry.mount())?.catch?.(() => null);
  return Boolean(tryDo(() => biometry.isAvailable()));
}
export async function setBio(on: boolean): Promise<boolean> {
  if (!on) {
    tryDo(() => localStorage.removeItem(BIO_KEY));
    return true;
  }
  if (!(await bioSupported())) return false;
  const granted = await Promise.resolve(tryDo(() => biometry.requestAccess({ reason: "لتأكيد الإجراءات الحساسة في Nova AI" }))).catch(() => false);
  if (!granted) return false;
  tryDo(() => localStorage.setItem(BIO_KEY, "1"));
  return true;
}
/** Before a sensitive action (disconnect, delete, payment): Face ID / fingerprint if the user turned it on. */
export async function guard(reason: string): Promise<boolean> {
  if (!bioWanted()) return true;
  if (!(await bioSupported())) return true;
  try {
    const r: any = await biometry.authenticate({ reason });
    return Boolean(r?.status === "authorized" || r === true);
  } catch {
    return false;
  }
}

/** Same as useBack, under a name that does not look like a React hook (it is called inside effects). */
export const bindBack = (on: boolean, cb: () => void): (() => void) => useBack(on, cb);

// ---------------------------------------------------------------- Telegram's own bottom button (MainButton) for the primary action of a form
let mainMounted = false;
/** Shows Telegram's MainButton with `text` while a form is open; returns a cleanup that hides it again. Does nothing outside Telegram. */
export function bindMain(text: string, cb: () => void, opts: { enabled?: boolean; loading?: boolean } = {}): () => void {
  if (!launch.inTelegram) return () => undefined;
  if (!mainMounted) {
    tryDo(() => mainButton.mount());
    mainMounted = true;
  }
  tryDo(() => mainButton.setParams({ text, isVisible: true, isEnabled: opts.enabled !== false, isLoaderVisible: Boolean(opts.loading) }));
  const off = tryDo(() => mainButton.onClick(cb));
  return () => {
    tryDo(() => off?.());
    tryDo(() => mainButton.setParams({ isVisible: false, isLoaderVisible: false }));
  };
}
/** True when Telegram draws the MainButton (the in-page save button can then stay as a quiet fallback). */
export const hasMain = () => launch.inTelegram && Boolean(tryDo(() => mainButton.isMounted()));
