import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { coderChatKey, resolveConnections, tierFor, type Db } from "@/lib/coderAuth";
import { GITHUB_TOOLS, CONNECTOR_TOOLS, githubClient, guardCall, runTool } from "@/lib/coderAgent";
import { connectedIds, connectorById, isReadOnlyCall, siteBase } from "@/lib/coderConnectors";
import type { CoderToolCall } from "@/lib/openCoderStudio";

type TicketBody = { chatId: number; model: string; connectors: string[]; exp: number; nonce: string };
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
    if (!Number.isFinite(parsed.exp) || parsed.exp < Date.now() || parsed.exp > Date.now() + 5 * 60_000) return null;
    if (typeof parsed.nonce !== "string" || parsed.nonce.length < 12) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Describe only services this owner has actually connected. Credentials remain in the app server. */
export async function createDonorToolBridge(chatId: number, model: string, db: Db) {
  if (tierFor(chatId) !== "owner") throw new Error("Candidate models are owner-only.");
  if (!isCandidate(model)) throw new Error("Unknown candidate model route.");
  const [connections, linked] = await Promise.all([resolveConnections(chatId, db), connectedIds(chatId, db)]);
  const available = [...new Set([...(connections.github?.token ? ["github"] : []), ...linked.filter((id) => !id.startsWith("mcp:"))])];
  // Candidate sessions share connected accounts, but expose strictly read-only GitHub capabilities.
  // Write actions remain unavailable until a first-class confirmation flow exists in the shared terminal.
  const READ_ONLY_GITHUB_TOOLS = new Set([
    "github_whoami", "github_list_repos", "github_repo_info", "github_repo_scan",
    "github_repo_audit", "github_read_files", "github_read_file", "github_list_files",
    "github_search_code", "github_search_repos", "github_list_branches",
    "github_list_prs", "github_list_issues", "github_ci_status", "github_ci_logs",
    "github_pr_info", "github_commits", "github_compare",
  ]);
  const rawTools = [
    ...(connections.github?.token ? GITHUB_TOOLS.filter((tool) => READ_ONLY_GITHUB_TOOLS.has(tool.function.name)) : []),
    ...(available.some((id) => id !== "github") ? CONNECTOR_TOOLS.filter((tool) => tool.function.name === "connector_api") : []),
  ];
  // Keep schemas small enough for the 2K-context Qwen test profile; argument schemas remain the real server contracts.
  const tools = rawTools.map((tool) => ({
    type: "function" as const,
    function: {
      ...tool.function,
      description: String(tool.function.description || "").slice(0, 220),
    },
  }));
  const url = siteBase().replace(/\/$/, "") + "/api/coder/app/donor-tools";
  // A Studio with no linked services can still chat and use its public read-only tools.
  // Authenticated app connectors require the same encryption/signing key used by the connector store.
  if (!signingKey()) {
    if (available.length) throw new Error("CODER_TOKEN_KEY is required to expose connected services to this candidate.");
    return { url: "", ticket: "", model, connectors: [], tools: [] };
  }
  const ticket = issueTicket({
    chatId,
    model,
    connectors: available,
    exp: Date.now() + 6 * 60_000,
    nonce: randomBytes(12).toString("hex"),
  });
  return { url, ticket, model, connectors: available, tools };
}

/** Execute one model-selected tool in the shared connector/terminal layer, scoped to the selected candidate. */
export async function executeDonorTool(input: {
  ticket: string;
  model: string;
  name: string;
  arguments: Record<string, unknown>;
}, db: Db, fetchImpl: typeof fetch = globalThis.fetch): Promise<{ ok: boolean; result: string; approval_required?: boolean }> {
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
  const READ_ONLY_GITHUB_TOOLS = new Set([
    "github_whoami", "github_list_repos", "github_repo_info", "github_repo_scan",
    "github_repo_audit", "github_read_files", "github_read_file", "github_list_files",
    "github_search_code", "github_search_repos", "github_list_branches",
    "github_list_prs", "github_list_issues", "github_ci_status", "github_ci_logs",
    "github_pr_info", "github_commits", "github_compare",
  ]);
  const allowedSchemas = [
    ...(gh ? GITHUB_TOOLS.filter((tool) => READ_ONLY_GITHUB_TOOLS.has(tool.function.name)) : []),
    ...(allowed.some((id) => id !== "github") ? CONNECTOR_TOOLS.filter((tool) => tool.function.name === "connector_api") : []),
  ];
  if (!allowedSchemas.some((tool) => tool.function.name === input.name)) {
    return { ok: false, result: "DENIED: this tool is not enabled for the services connected to the current account." };
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

  const guard = await guardCall(call, gh, "owner");
  if (guard.confirm) {
    return { ok: false, approval_required: true, result: "APPROVAL_REQUIRED: " + guard.reason + ". No change was made." };
  }
  const ctx = {
    gh,
    addNote: (_text: string) => undefined,
    fetchImpl,
    runId: "candidate-" + input.model + "-" + ticket.chatId + "-" + ticket.nonce,
    chatKey: coderChatKey(ticket.chatId),
    githubToken: connections.github?.token || null,
    userId: ticket.chatId,
    db,
    tier: "owner" as const,
  };
  const result = await runTool(call, ctx);
  return { ok: !/^error:|^DENIED:|^APPROVAL_REQUIRED:/i.test(result), result };
}
