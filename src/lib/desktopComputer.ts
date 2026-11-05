// The owner's isolated graphical Linux desktop on the shared 16 GB computer hub.
// A verified user+model session owns its own display, home directory and UID;
// only bounded input actions and JPEG frames cross the authenticated Gradio API.
import { browserStudioFor, studioCall, studioStream } from "@/lib/browserComputer";

export type DesktopArgs = {
  action?: string;
  app?: "browser" | "terminal" | "files" | "writer" | "calc" | "impress" | "draw" | "inkscape" | "gimp" | "audacity";
  url?: string;
  path?: string;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  button?: "left" | "middle" | "right";
  text?: string;
  key?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
};

const ACTIONS = new Set([
  "status", "apps", "start", "frame", "stop", "launch", "open_file",
  "click", "dblclick", "move", "mousedown", "mouseup", "drag",
  "clipboard_set", "clipboard_get", "pointer", "type", "key", "scroll",
]);

export function cleanDesktopArgs(input: DesktopArgs): Record<string, unknown> | null {
  const action = String(input.action || "").toLowerCase();
  if (!ACTIONS.has(action)) return null;
  const out: Record<string, unknown> = { action };
  if (action === "launch") {
    const app = String(input.app || "");
    if (!["browser", "terminal", "files", "writer", "calc", "impress", "draw", "inkscape", "gimp", "audacity"].includes(app)) return null;
    out.app = app;
    if (input.url !== undefined) out.url = String(input.url).trim().slice(0, 2000);
  }
  if (action === "open_file") {
    if (!input.path) return null;
    out.path = String(input.path).slice(0, 500);
  }
  if (["click", "move", "dblclick", "mousedown", "mouseup", "drag"].includes(action)) {
    if (!Number.isFinite(Number(input.x)) || !Number.isFinite(Number(input.y))) return null;
    out.x = Math.max(0, Math.min(1599, Math.trunc(Number(input.x))));
    out.y = Math.max(0, Math.min(999, Math.trunc(Number(input.y))));
    if (action === "drag") {
      if (!Number.isFinite(Number(input.x2)) || !Number.isFinite(Number(input.y2))) return null;
      out.x2 = Math.max(0, Math.min(1599, Math.trunc(Number(input.x2))));
      out.y2 = Math.max(0, Math.min(999, Math.trunc(Number(input.y2))));
    }
    if (["click", "mousedown", "mouseup"].includes(action)) {
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
    out.amount = Math.max(1, Math.min(8, Math.trunc(Number(input.amount) || 3)));
    if (input.x !== undefined && input.y !== undefined && Number.isFinite(Number(input.x)) && Number.isFinite(Number(input.y))) {
      out.x = Math.max(0, Math.min(1599, Math.trunc(Number(input.x))));
      out.y = Math.max(0, Math.min(999, Math.trunc(Number(input.y))));
    }
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
  const base = browserStudioFor(modelId);
  if (!base) throw new Error("the dedicated computer hub is unavailable for this model");
  if (!session || session.length > 240) throw new Error("invalid desktop session");
  const duration = Number.isFinite(Number(seconds)) ? Math.max(1, Math.min(25, Number(seconds))) : 20;
  return studioStream(base, "live", {
    session,
    seconds: duration,
    interval: 0.5,
    quality: 50,
    scale: 0.75,
  }, fetchImpl, (duration + 15) * 1000);
}

export async function desktopDo(
  modelId: string | undefined,
  session: string,
  args: DesktopArgs,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Record<string, any>> {
  const base = browserStudioFor(modelId);
  if (!base) return { ok: false, error: "the dedicated computer hub is unavailable for this model" };
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
