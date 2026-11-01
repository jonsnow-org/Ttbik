// The model's free persistent Linux computer (ai-system/modelscope-media/computer_box.py): a shell, files that stay, and background jobs. It is what Daytona's paid sandbox gave,
// built on the model's OWN Studio (root, 2 vCPU / 8 GB, a persistent /mnt/workspace). Nothing is shared between models: Nova uses Nova's media Studio, each candidate its own.
// A session is one user of one model (`session` is derived by the caller from the verified account and the model); the Studio gives it a private unprivileged Unix user and home folder.
import { browserStudioFor, studioCall } from "@/lib/browserComputer";

export type BoxArgs = {
  action?: string; command?: string; cwd?: string; timeout?: number; path?: string; content?: string; id?: string; name?: string; tail?: number;
};

const ACTIONS = new Set(["run", "write", "read", "job_start", "job_log", "job_stop", "job_list", "status"]);

/** The tool names a model sees → what the Studio understands. */
export function boxActionFor(tool: string, a: Record<string, unknown>): BoxArgs | null {
  if (tool === "computer_run") return { action: "run", command: a.command as string, cwd: a.cwd as string, timeout: a.timeout as number };
  if (tool === "computer_write") return { action: "write", path: a.path as string, content: a.content as string };
  if (tool === "computer_read") return { action: "read", path: (a.path as string) || "." };
  if (tool === "computer_job") {
    const sub = String(a.action || "").toLowerCase();
    if (!["start", "log", "stop", "list"].includes(sub)) return null;
    return { action: "job_" + sub, command: a.command as string, name: a.name as string, id: a.id as string, tail: a.tail as number };
  }
  return null;
}

/** Exactly the fields the Studio understands, bounded; anything else is dropped. */
export function cleanBoxArgs(a: BoxArgs): Record<string, unknown> | null {
  const action = String(a.action || "").toLowerCase();
  if (!ACTIONS.has(action)) return null;
  const out: Record<string, unknown> = { action };
  if (a.command !== undefined) out.command = String(a.command).slice(0, 8000);
  if (a.cwd !== undefined) out.cwd = String(a.cwd).slice(0, 300);
  if (a.timeout !== undefined && Number.isFinite(Number(a.timeout))) out.timeout = Math.max(1, Math.min(90, Math.trunc(Number(a.timeout))));
  if (a.path !== undefined) out.path = String(a.path).slice(0, 500);
  if (a.content !== undefined) out.content = String(a.content).slice(0, 1_000_000);
  if (a.id !== undefined) out.id = String(a.id).slice(0, 20);
  if (a.name !== undefined) out.name = String(a.name).slice(0, 60);
  if (a.tail !== undefined && Number.isFinite(Number(a.tail))) out.tail = Math.max(1, Math.min(400, Math.trunc(Number(a.tail))));
  return out;
}

/** What the model reads back. */
export function renderBoxReply(action: string, r: Record<string, any>): string {
  if (!r || r.ok === false) return "error: " + String(r?.error || "the computer did not answer").slice(0, 400);
  switch (action) {
    case "run":
      return [`exit ${r.exit_code}${r.timed_out ? " (stopped: too long)" : ""} · ${r.seconds}s · in ${r.cwd}`, String(r.output || "(no output)"), r.hint ? `\n${r.hint}` : ""].join("\n").trim();
    case "write":
      return `wrote ${r.path} (${r.bytes} bytes)`;
    case "read":
      if (r.kind === "folder") return `folder ${r.path}:\n` + ((r.entries as string[]) || []).join("\n") || "(empty)";
      return String(r.text ?? "") + (r.cut ? "\n…(file continues; read part of it with `sed -n 'A,Bp'` through computer_run)" : "");
    case "job_start":
      return `job ${r.id} started. Read it with computer_job action=log id=${r.id}.`;
    case "job_log":
      return `job ${r.id} ${r.running ? "running" : "finished with exit " + r.exit_code} · ${r.seconds}s\n${r.output || "(no output yet)"}`;
    case "job_stop":
      return `job ${r.id} ${r.running ? "still running" : "stopped"}`;
    case "job_list":
      return ((r.jobs as any[]) || []).map((j) => `${j.id} ${j.running ? "running" : "exit " + j.exit_code} ${j.name ? j.name + " · " : ""}${j.command}`).join("\n") || "(no jobs)";
    default:
      return JSON.stringify(r).slice(0, 1500);
  }
}

export async function boxDo(modelId: string | undefined, session: string, args: BoxArgs, fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  const base = browserStudioFor(modelId);                 // the same per-model media Studio hosts the browser and the computer
  if (!base) return "error: this model has no computer Studio";
  const clean = cleanBoxArgs(args);
  if (!clean) return "error: unknown computer action";
  try {
    // a command may take up to 90 s inside the Studio; the read window is a little longer
    const reply = await studioCall(base, "box_do", { ...clean, session }, fetchImpl, 110_000);
    return renderBoxReply(String(clean.action), reply);
  } catch (error) {
    return "error: " + String((error as Error)?.message || error).slice(0, 240);
  }
}
