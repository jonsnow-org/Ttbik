import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cloudDesktopEnabled } from "@/lib/cloudDesktopPolicy";
import { coderChatKey, resolveConnections, tierFor, type Db } from "@/lib/coderAuth";
import { GITHUB_TOOLS, CONNECTOR_TOOLS, githubClient, guardCall, runTool, toolGroups } from "@/lib/coderAgent";
import { connectedIds, connectorById, isReadOnlyCall, siteBase } from "@/lib/coderConnectors";
import type { CoderToolCall } from "@/lib/openCoderStudio";

type TicketBody = { chatId: number; model: string; connectors: string[]; runId?: string; botId?: string; exp: number; nonce: string };
const CANDIDATES = new Set(["qwen35-9b", "gemma4-e4b", "minicpmo45"]);
const isCandidate = (id: string) => CANDIDATES.has(id);
const signingKey = () => (process.env.CODER_TOKEN_KEY || "").trim();

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function signature(value: string): string {
  const key = signingKey();
  if (!key) throw new Error("CODER_TOKEN_KEY is required for the candidate connector bridge.");
  return createHmac("sha256", key).update(value).digest("hex");
}
function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}


// ------------------------------------------------------------------ tool groups for the candidate models
// Every candidate gets the standard assistant tool set (GitHub, a private computer, the web, linked services) through the SAME shared executor Nova's loop
// uses (the terminal / connectors layer is common platform), but loads it in groups so a 2K-4K window is not spent on schemas it does not need:
// the model sees `load_tools` first and asks for a group. What a candidate must NOT get from here, because it would reach into another model:
//   make_media (each candidate makes media only through its OWN generate_* tool in its OWN Studio), delegate (sub-agents of Nova's engine),
//   schedule_* (a scheduled run is executed by Nova's loop), memory_* / recall / plan (Nova's long-term memory), send_file / ask_user / view_* (need Nova's chat loop).
export const CANDIDATE_GROUPS = ["github", "computer", "web", "connectors"] as const;
export type CandidateGroup = (typeof CANDIDATE_GROUPS)[number];
const BLOCKED_FOR_CANDIDATES = new Set([
  "make_media", "delegate", "schedule_create", "schedule_list", "schedule_delete",
  "memory_note", "memory_save", "memory_search", "memory_forget", "recall", "plan",
  "send_file", "ask_user", "view_image", "view_video",
  "computer_publish",                       // candidates keep read-only GitHub: nothing they do commits to a repository
]);
const LOAD_TOOLS_DEF = {
  type: "function" as const,
  function: {
    name: "load_tools",
    description: "Adds tool groups to this conversation: github (repositories: files, branches, commits, pull requests, issues, CI), computer (your own private Linux computer for the task: shell, files, git, tests, search), web (search, read pages, deep research, HTTP APIs), connectors (services the user linked). Loaded tools are ready from your next step.",
    parameters: {
      type: "object",
      properties: { groups: { type: "array", items: { type: "string", enum: [...CANDIDATE_GROUPS] }, minItems: 1, maxItems: 4 } },
      required: ["groups"],
      additionalProperties: false,
    },
  },
};

/** The tools of the requested groups that exist for this account right now (github needs a linked token, connectors need a linked service), schemas kept short. */
export function candidateToolsFor(groups: readonly string[], hasGithub: boolean, hasConnectors: boolean): Array<{ type: "function"; function: { name: string; description: string; parameters: unknown } }> {
  const all = toolGroups(hasGithub, hasConnectors);
  const out = new Map<string, { type: "function"; function: { name: string; description: string; parameters: unknown } }>();
  for (const g of groups) {
    if (!(CANDIDATE_GROUPS as readonly string[]).includes(g)) continue;
    for (const t of all[g] || []) {
      if (BLOCKED_FOR_CANDIDATES.has(t.function.name)) continue;
      // With the persistent desktop on (tests only) a candidate has ONE computer, so the per-task sandbox is hidden; in production the desktop is off
      // (zero-cost policy) and the task-scoped sandbox IS the candidate's computer.
      if (g === "computer" && cloudDesktopEnabled() && t.function.name.startsWith("sandbox_")) continue;
      out.set(t.function.name, { type: "function", function: { ...t.function, description: String(t.function.description || "").slice(0, 170) } });
    }
  }
  return [...out.values()];
}

/** Short-lived, owner/model-scoped permission ticket. It contains no provider token. */
function issueTicket(body: TicketBody): string {
  const encoded = encode(body);
  return encoded + "." + signature(encoded);
}

export function verifyDonorToolTicket(ticket: string): TicketBody | null {
  const [encoded, supplied, extra] = String(ticket || "").split(".");
  if (!encoded || !supplied || extra) return null;
  try {
    if (!safeEqual(signature(encoded), supplied)) return null;
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TicketBody;
    if (!Number.isSafeInteger(parsed.chatId) || !isCandidate(parsed.model) || !Array.isArray(parsed.connectors)) return null;
    if (parsed.runId !== undefined && (typeof parsed.runId !== "string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(parsed.runId))) return null;
    if (parsed.runId !== undefined && (typeof parsed.botId !== "string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(parsed.botId))) return null;
    if (!Number.isFinite(parsed.exp) || parsed.exp < Date.now() || parsed.exp > Date.now() + 47 * 60_000) return null;
    if (typeof parsed.nonce !== "string" || parsed.nonce.length < 12) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Describe only services this owner has actually connected. Credentials remain in the app server. */
export async function createDonorToolBridge(chatId: number, model: string, db: Db, runId?: string, botId?: string) {
  if (tierFor(chatId) !== "owner") throw new Error("Candidate models are owner-only.");
  if (!isCandidate(model)) throw new Error("Unknown candidate model route.");
  if (runId && !botId) throw new Error("The originating bot ID is required for signed candidate media delivery.");
  const [connections, linked] = await Promise.all([resolveConnections(chatId, db), connectedIds(chatId, db)]);
  const available = [...new Set([...(connections.github?.token ? ["github"] : []), ...linked.filter((id) => !id.startsWith("mcp:"))])];
  // Candidate sessions share connected accounts, but expose strictly read-only GitHub capabilities.
  // Write actions remain unavailable until a first-class confirmation flow exists in the shared terminal.
  // The model starts with one short schema (load_tools); the groups it asks for are fetched from this bridge (name "__schemas__").
  const tools = [LOAD_TOOLS_DEF];
  const url = siteBase().replace(/\/$/, "") + "/api/coder/app/donor-tools";
  // A Studio with no linked services can still chat and use its public read-only tools.
  // Authenticated app connectors require the same encryption/signing key used by the connector store.
  if (!signingKey()) {
    if (runId) throw new Error("CODER_TOKEN_KEY is required for signed, asynchronous candidate media delivery.");
    if (available.length) throw new Error("CODER_TOKEN_KEY is required to expose connected services to this candidate.");
    return { url: "", ticket: "", model, run_id: "", bot_id: "", connectors: [], tools: [] };
  }
  const ticket = issueTicket({
    chatId,
    model,
    connectors: available,
    ...(runId ? { runId, botId } : {}),
    exp: Date.now() + 45 * 60_000,
    nonce: randomBytes(12).toString("hex"),
  });
  return { url, ticket, model, run_id: runId || "", bot_id: botId || "", connectors: available, tools };
}

/** Execute one model-selected tool in the shared connector/terminal layer, scoped to the selected candidate. */
export async function executeDonorTool(input: {
  ticket: string;
  model: string;
  name: string;
  arguments: Record<string, unknown>;
  mediaCapabilities?: { vision?: boolean; audio?: boolean; video?: boolean };
}, db: Db, fetchImpl: typeof fetch = globalThis.fetch): Promise<{ ok: boolean; result: string; approval_required?: boolean; vision?: { mimeType: string; b64: string; width?: number | null; height?: number | null } }> {
  const ticket = verifyDonorToolTicket(input.ticket);
  if (!ticket || ticket.model !== input.model || !isCandidate(input.model)) {
    return { ok: false, result: "DENIED: invalid, expired, or cross-model tool ticket." };
  }
  if (tierFor(ticket.chatId) !== "owner") {
    return { ok: false, result: "DENIED: candidate connector access is owner-only." };
  }
  const [connections, linked] = await Promise.all([resolveConnections(ticket.chatId, db), connectedIds(ticket.chatId, db)]);
  const nowConnected = [...new Set([...(connections.github?.token ? ["github"] : []), ...linked.filter((id) => !id.startsWith("mcp:"))])];
  const allowed = ticket.connectors.filter((id) => nowConnected.includes(id));
  const gh = connections.github?.token ? githubClient(connections.github.token, fetchImpl) : null;
  const call: CoderToolCall = {
    id: "candidate_" + randomBytes(8).toString("hex"),
    type: "function",
    function: { name: input.name, arguments: JSON.stringify(input.arguments || {}) },
  };
  const hasGithub = Boolean(gh);
  const hasConnectors = allowed.some((id) => id !== "github");
  if (input.name === "__schemas__") {
    const asked = Array.isArray(input.arguments?.groups) ? (input.arguments.groups as unknown[]).map(String) : [];
    return { ok: true, result: JSON.stringify(candidateToolsFor(asked, hasGithub, hasConnectors)) };
  }
  const allowedSchemas = candidateToolsFor(CANDIDATE_GROUPS, hasGithub, hasConnectors);
  if (!allowedSchemas.some((tool) => tool.function.name === input.name)) {
    return { ok: false, result: "DENIED: this tool is not enabled for this model or for the services connected to the current account." };
  }

  // Connector API calls are read-only in the candidate test path. Writes need the standard approval UI,
  // which is intentionally not bypassed by the ModelScope runner.
  if (input.name === "connector_api") {
    const service = String(input.arguments?.service || "");
    const method = String(input.arguments?.method || "GET").toUpperCase();
    const path = String(input.arguments?.path || "");
    const def = connectorById(service);
    if (!allowed.includes(service) || !def) return { ok: false, result: "DENIED: " + service + " is not connected for this owner." };
    const connectorUrl = path.startsWith("https://")
      ? path
      : def.apiBases[0].replace(/\/$/, "") + "/" + path.replace(/^\//, "");
    let target: URL | null = null;
    try { target = new URL(connectorUrl); } catch { target = null; }
    const trustedBase = target && def.apiBases.some((base) => {
      try {
        const origin = new URL(base);
        return target!.origin === origin.origin && target!.pathname.startsWith(origin.pathname);
      } catch { return false; }
    });
    if (!trustedBase) return { ok: false, result: "DENIED: connector URL is outside the connected service API." };
    if (!isReadOnlyCall(method, connectorUrl)) {
      return { ok: false, approval_required: true, result: "APPROVAL_REQUIRED: write operation blocked in this candidate bridge; no change was made." };
    }
  }

  if (input.name === "cloud_computer_screenshot") {
    const computer = await import("@/lib/cloudComputer");
    const computerCtx = { chatId: ticket.chatId, modelId: input.model, tier: "owner" as const, db, fetchImpl };
    const shotArgs = input.arguments || {};
    const region = shotArgs.region && typeof shotArgs.region === "object"
      ? {
          x: Math.max(0, Math.floor(Number((shotArgs.region as Record<string, unknown>).x) || 0)),
          y: Math.max(0, Math.floor(Number((shotArgs.region as Record<string, unknown>).y) || 0)),
          width: Math.max(1, Math.min(4096, Math.floor(Number((shotArgs.region as Record<string, unknown>).width) || 1))),
          height: Math.max(1, Math.min(4096, Math.floor(Number((shotArgs.region as Record<string, unknown>).height) || 1))),
        }
      : undefined;
    const [file, windowsResult, treeResult] = await Promise.all([
      computer.cloudComputerScreenshot(computerCtx, {
        ...(region ? { region } : {}),
        compressed: true,
        format: "jpeg",
        quality: Math.max(45, Math.min(90, Number(shotArgs.quality) || 78)),
        scale: Math.max(0.35, Math.min(1, Number(shotArgs.scale) || 0.82)),
      }),
      computer.cloudComputerAction(computerCtx, "windows").catch((error) => ({ error: String((error as Error)?.message || error).slice(0, 180) })),
      computer.cloudComputerAction(computerCtx, "accessibility_tree", { scope: "all", max_depth: 8 }).catch((error) => ({ error: String((error as Error)?.message || error).slice(0, 180) })),
    ]);
    if (!file?.bytes?.length) return { ok: false, result: "The selected model's own computer returned an empty screenshot." };
    const windows = JSON.stringify(windowsResult).slice(0, 4500);
    const accessibility = JSON.stringify(treeResult).slice(0, 9000);
    const visionReady = input.mediaCapabilities?.vision === true;
    const baseDescription =
      "Computer screen captured from this model's own persistent VM. Active windows: " + windows +
      "\nAccessibility tree (UI elements, roles, labels and state): " + accessibility;
    if (visionReady) {
      return {
        ok: true,
        result: baseDescription + "\nThe screenshot image is attached directly to the next inference turn of this same model, using its own loaded multimodal projector. Inspect the visual layout and correlate it with the accessibility tree.",
        vision: {
          mimeType: "image/jpeg",
          b64: file.bytes.toString("base64"),
        },
      };
    }
    const [ocr, visual] = await Promise.all([
      computer.cloudComputerOcrScreenshot(computerCtx, file.bytes, "image/jpeg").catch((error) =>
        "OCR fallback had a problem in this model's own computer: " + String((error as Error)?.message || error).slice(0, 300)
      ),
      computer.cloudComputerVisionDescribeScreenshot(
        computerCtx,
        file.bytes,
        "image/jpeg",
        "Describe this live computer screen. Identify visible apps, layout, UI elements and controls with approximate normalized coordinates. Return structured JSON. Use Arabic if the user is speaking Arabic; never guess unreadable content.",
      ).catch((error): Record<string, any> => ({ ok: false, state: "error", detail: String((error as Error)?.message || error).slice(0, 300) })),
    ]);
    const visualText = visual.ok && visual.description
      ? "\nLocal visual-perception sidecar (private to this candidate's VM):\n" + String(visual.description).slice(0, 10000)
      : "\nPrivate visual-perception sidecar is " + String(visual.state || "starting") + (visual.detail ? ": " + String(visual.detail).slice(0, 220) : "") + ". Use OCR and accessibility metadata and do not infer unseen details.";
    return {
      ok: true,
      result: baseDescription + "\nVisible screen text (Arabic + English OCR in this same isolated computer):\n" + ocr + visualText +
        "\nUse visual coordinates together with the accessibility tree; verify actions with a fresh screenshot.",
    };
  }

  const guard = await guardCall(call, gh, "owner");
  if (guard.confirm) {
    return { ok: false, approval_required: true, result: "APPROVAL_REQUIRED: " + guard.reason + ". No change was made." };
  }
  const ctx = {
    gh,
    addNote: (_text: string) => undefined,
    fetchImpl,
    runId: "candidate-" + input.model + "-" + ticket.chatId + "-" + ticket.nonce,
    chatKey: coderChatKey(ticket.chatId + ":" + input.model),   // candidate-private computer scope
    modelId: input.model,
    githubToken: connections.github?.token || null,
    userId: ticket.chatId,
    db,
    tier: "owner" as const,
  };
  const result = await runTool(call, ctx);
  return { ok: !/^error:|^DENIED:|^APPROVAL_REQUIRED:/i.test(result), result };
}
