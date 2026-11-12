// The owner's isolated graphical Linux desktop on the shared 16 GB computer hub.
// A verified user+model session owns its own display, home directory and UID;
// only bounded input actions and JPEG frames cross the authenticated Gradio API.
import { browserStudioFor, studioCall, studioStream } from "@/lib/browserComputer";

export type DesktopArgs = {
  action?: string;
  app?: "browser" | "terminal" | "files";
  url?: string;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  button?: "left" | "middle" | "right";
  text?: string;
  key?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  width?: number;
  height?: number;
};

/** The graphical desktop still lives on the shared computer hub, which is Nova's only (owner's order 2026-11-08): Sham and Sham v2 have their terminal and browser embedded
 *  in their own Studios, and until a desktop is embedded there too they get no desktop rather than a silent borrow of Nova's hub. */
export const HUB_DESKTOP_REFUSED = "error: this model's graphical desktop is not embedded in its own Studio yet; the shared computer hub is Nova's only. Use the terminal and the browser, which run inside the model.";
export function hubDesktopFor(modelId: string | undefined): string | null {
  if (modelId === "sham" || modelId === "sham_v2") return null;
  return browserStudioFor(modelId);
}

const ACTIONS = new Set([
  "status", "start", "frame", "stop", "launch",
  "click", "move", "type", "key", "scroll",
  "dblclick", "drag", "mousedown", "mouseup", "clipboard_set", "clipboard_get",
]);

export function cleanDesktopArgs(input: DesktopArgs): Record<string, unknown> | null {
  const action = String(input.action || "").toLowerCase();
  if (!ACTIONS.has(action)) return null;
  const out: Record<string, unknown> = { action };
  if (action === "start") {
    // the page asks for a desktop shaped like its own screen area (a phone is tall), so the picture fills it
    if (Number.isFinite(Number(input.width)) && Number.isFinite(Number(input.height))) {
      out.width = Math.max(640, Math.min(1600, Math.trunc(Number(input.width))));
      out.height = Math.max(600, Math.min(1500, Math.trunc(Number(input.height))));
    }
  }
  if (action === "launch") {
    const app = String(input.app || "");
    if (!["browser", "terminal", "files"].includes(app)) return null;
    out.app = app;
    if (input.url !== undefined) out.url = String(input.url).trim().slice(0, 2000);
  }
  if (["click", "move", "dblclick", "drag", "mousedown", "mouseup"].includes(action)) {
    if (!Number.isFinite(Number(input.x)) || !Number.isFinite(Number(input.y))) return null;
    out.x = Math.max(0, Math.min(1599, Math.trunc(Number(input.x))));
    out.y = Math.max(0, Math.min(999, Math.trunc(Number(input.y))));
    if (action === "drag") {
      if (!Number.isFinite(Number(input.x2)) || !Number.isFinite(Number(input.y2))) return null;
      out.x2 = Math.max(0, Math.min(1599, Math.trunc(Number(input.x2))));
      out.y2 = Math.max(0, Math.min(999, Math.trunc(Number(input.y2))));
    }
    if (action === "click" || action === "mousedown" || action === "mouseup") {
      const button = String(input.button || "left");
      if (!["left", "middle", "right"].includes(button)) return null;
      out.button = button;
    }
  }
  if (action === "type" || action === "clipboard_set") {
    if (input.text === undefined) return null;
    out.text = String(input.text).slice(0, action === "type" ? 1200 : 20000);
  }
  if (action === "key") {
    const key = String(input.key || "");
    if (!/^[A-Za-z0-9_+-]{1,40}$/.test(key)) return null;
    out.key = key;
  }
  if (action === "scroll") {
    const direction = String(input.direction || "down");
    if (!["up", "down", "left", "right"].includes(direction)) return null;
    out.direction = direction;
    if (Number.isFinite(Number(input.x)) && Number.isFinite(Number(input.y))) {
      out.x = Math.max(0, Math.min(1599, Math.trunc(Number(input.x))));
      out.y = Math.max(0, Math.min(999, Math.trunc(Number(input.y))));
    }
    out.amount = Math.max(1, Math.min(8, Math.trunc(Number(input.amount) || 3)));
  }
  return out;
}

/** Stream screen frames and activity for one verified user:model session. */
export async function desktopLive(
  modelId: string | undefined,
  session: string,
  seconds = 20,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const base = hubDesktopFor(modelId);
  if (!base) throw new Error(HUB_DESKTOP_REFUSED.replace(/^error: /, ""));
  if (!session || session.length > 240) throw new Error("invalid desktop session");
  const duration = Number.isFinite(Number(seconds)) ? Math.max(1, Math.min(25, Number(seconds))) : 20;
  return studioStream(base, "live", {
    session,
    seconds: duration,
    interval: 0.5,
    quality: 55,
    scale: 1,
  }, fetchImpl, (duration + 15) * 1000);
}

export async function desktopDo(
  modelId: string | undefined,
  session: string,
  args: DesktopArgs,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Record<string, any>> {
  const base = hubDesktopFor(modelId);
  if (!base) return { ok: false, error: HUB_DESKTOP_REFUSED.replace(/^error: /, "") };
  const clean = cleanDesktopArgs(args);
  if (!clean) return { ok: false, error: "invalid graphical desktop action or arguments" };
  try {
    return await studioCall(
      base,
      "desktop_do",
      { ...clean, session },
      fetchImpl,
      45000,
    );
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error).slice(0, 240) };
  }
}
