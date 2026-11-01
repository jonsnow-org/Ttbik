// The owner's isolated graphical Linux desktop. The display runs in the selected
// model's own ModelScope media Studio; only bounded input actions and JPEG
// frames cross the existing authenticated Gradio endpoint.
import { browserStudioFor, studioCall } from "@/lib/browserComputer";

export type DesktopArgs = {
  action?: string;
  app?: "browser" | "terminal" | "files";
  url?: string;
  x?: number;
  y?: number;
  button?: "left" | "middle" | "right";
  text?: string;
  key?: string;
  direction?: "up" | "down";
  amount?: number;
};

const ACTIONS = new Set([
  "status", "start", "frame", "stop", "launch",
  "click", "move", "type", "key", "scroll",
]);

export function cleanDesktopArgs(input: DesktopArgs): Record<string, unknown> | null {
  const action = String(input.action || "").toLowerCase();
  if (!ACTIONS.has(action)) return null;
  const out: Record<string, unknown> = { action };
  if (action === "launch") {
    const app = String(input.app || "");
    if (!["browser", "terminal", "files"].includes(app)) return null;
    out.app = app;
    if (input.url !== undefined) out.url = String(input.url).trim().slice(0, 2000);
  }
  if (action === "click" || action === "move") {
    if (!Number.isFinite(Number(input.x)) || !Number.isFinite(Number(input.y))) return null;
    out.x = Math.max(0, Math.min(1599, Math.trunc(Number(input.x))));
    out.y = Math.max(0, Math.min(999, Math.trunc(Number(input.y))));
    if (action === "click") {
      const button = String(input.button || "left");
      if (!["left", "middle", "right"].includes(button)) return null;
      out.button = button;
    }
  }
  if (action === "type") {
    if (input.text === undefined) return null;
    out.text = String(input.text).slice(0, 1200);
  }
  if (action === "key") {
    const key = String(input.key || "");
    if (!/^[A-Za-z0-9_+-]{1,40}$/.test(key)) return null;
    out.key = key;
  }
  if (action === "scroll") {
    const direction = String(input.direction || "down");
    if (!["up", "down"].includes(direction)) return null;
    out.direction = direction;
    out.amount = Math.max(1, Math.min(8, Math.trunc(Number(input.amount) || 3)));
  }
  return out;
}

export async function desktopDo(
  modelId: string | undefined,
  session: string,
  args: DesktopArgs,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Record<string, any>> {
  const base = browserStudioFor(modelId);
  if (!base) return { ok: false, error: "this model has no dedicated computer Studio" };
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
