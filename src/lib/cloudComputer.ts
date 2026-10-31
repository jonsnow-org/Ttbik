import { createHash } from "crypto";
import { coderChatKey, prismaDb, tierFor, type Db } from "@/lib/coderAuth";
import { addUsage, checkLimit, getSubscription, listPlans, terminalAllowed } from "@/lib/coderPlans";

export type CloudComputerContext = {
  chatId: number | string;
  modelId: string;
  tier?: "owner" | "user";
  db?: Db;
  fetchImpl?: typeof fetch;
};

type SandboxInfo = {
  id: string;
  name?: string;
  state?: string;
  snapshot?: string;
  toolboxProxyUrl?: string;
  errorReason?: string;
};

type ComputerRow = {
  chat_key: string;
  chat_id: number;
  model_id: string;
  sandbox_id: string;
  sandbox_name: string;
  snapshot: string;
  state: string;
  last_billed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type Json = Record<string, any>;

const API_DEFAULT = "https://app.daytona.io/api";
const TOOLBOX_DEFAULT = "https://proxy.app.daytona.io/toolbox";
const VNC_PORT = 6080;
const PREVIEW_TTL_SECONDS = 900;
const MAX_COMMAND_CHARS = 24000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120000;
const MODEL_ID = /^[a-z0-9_-]{1,40}$/i;

let tableReady: Promise<void> | null = null;

function dbOf(ctx: CloudComputerContext): Db {
  return ctx.db || prismaDb;
}

function fetchOf(ctx: CloudComputerContext): typeof fetch {
  return ctx.fetchImpl || globalThis.fetch;
}

function apiBase(): string {
  return (process.env.DAYTONA_API_URL || API_DEFAULT).trim().replace(/\/+$/, "");
}

function toolboxBase(): string {
  return (process.env.DAYTONA_TOOLBOX_URL || TOOLBOX_DEFAULT).trim().replace(/\/+$/, "");
}

function token(): string {
  const value = (process.env.DAYTONA_API_KEY || "").trim();
  if (!value) throw new Error("Cloud computer provider is not configured (DAYTONA_API_KEY).");
  return value;
}

function normalizedModelId(modelId: string): string {
  const value = String(modelId || "").trim().toLowerCase();
  if (!MODEL_ID.test(value)) throw new Error("Invalid model workspace.");
  return value;
}

export function cloudComputerIdentity(chatId: number | string, modelId: string): { chatKey: string; sandboxName: string; modelId: string } {
  const model = normalizedModelId(modelId);
  const chatKey = coderChatKey(`${String(chatId)}:${model}`);
  const digest = createHash("sha256").update(`ttbik-cloud-computer-v1|${chatKey}|${model}`).digest("hex").slice(0, 28);
  return { chatKey, sandboxName: `ttbik-pc-${digest}`, modelId: model };
}

async function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return;
  if (db === prismaDb && tableReady) return tableReady;
  const run = (async () => {
    await db.exec("CREATE TABLE IF NOT EXISTS cloud_computers (" +
      "chat_key TEXT PRIMARY KEY, chat_id BIGINT NOT NULL, model_id TEXT NOT NULL, " +
      "sandbox_id TEXT NOT NULL UNIQUE, sandbox_name TEXT NOT NULL UNIQUE, snapshot TEXT NOT NULL, " +
      "state TEXT NOT NULL DEFAULT 'created', last_billed_at TIMESTAMPTZ, " +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    await db.exec("ALTER TABLE cloud_computers ADD COLUMN IF NOT EXISTS chat_id BIGINT");
    await db.exec("ALTER TABLE cloud_computers ADD COLUMN IF NOT EXISTS last_billed_at TIMESTAMPTZ");
    await db.exec("CREATE INDEX IF NOT EXISTS cloud_computers_runtime_idx ON cloud_computers (state, last_billed_at)");
  })();
  if (db === prismaDb) {
    tableReady = run.catch((error) => { tableReady = null; throw error; });
    return tableReady;
  }
  return run;
}
async function assertIdentity(ctx: CloudComputerContext): Promise<void> {
  if (!Number.isFinite(Number(ctx.chatId)) || !String(ctx.chatId).trim()) throw new Error("A verified account is required.");
  token();
}

async function assertEntitlement(ctx: CloudComputerContext): Promise<void> {
  await assertIdentity(ctx);
  if (ctx.tier !== "owner" && !(await terminalAllowed(ctx.chatId, dbOf(ctx)))) {
    throw new Error("الحاسوب السحابي متاح في الخطط المدفوعة فقط. يمكنك الترقية من قسم الاشتراك.");
  }
}

export async function cloudComputerSnapshot(ctx: CloudComputerContext): Promise<string> {
  await assertEntitlement(ctx);
  if (ctx.tier === "owner") return (process.env.CLOUD_COMPUTER_OWNER_SNAPSHOT || "daytona-vm-large").trim();
  const sub = await getSubscription(ctx.chatId, dbOf(ctx));
  const plan = (await listPlans(dbOf(ctx))).find((p) => p.id === sub.plan_id);
  const isPro = Number(plan?.sort || 0) >= 2;
  return (isPro
    ? process.env.CLOUD_COMPUTER_PRO_SNAPSHOT || "daytona-vm-large"
    : process.env.CLOUD_COMPUTER_PLUS_SNAPSHOT || "daytona-vm-medium").trim();
}

async function providerRequest<T = any>(
  ctx: CloudComputerContext,
  url: string,
  init: RequestInit = {},
  notFoundIsNull = false,
): Promise<T | null> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token()}`);
  if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetchOf(ctx)(url, { ...init, headers, cache: "no-store", signal: init.signal || AbortSignal.timeout(30000) });
  if (notFoundIsNull && response.status === 404) return null;
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`Cloud computer provider returned HTTP ${response.status}: ${text.slice(0, 220)}`);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Cloud computer provider returned an unreadable response.");
  }
}

async function getSandbox(ctx: CloudComputerContext, id: string): Promise<SandboxInfo | null> {
  return providerRequest<SandboxInfo>(ctx, `${apiBase()}/sandbox/${encodeURIComponent(id)}`, {}, true);
}

async function getSandboxByName(ctx: CloudComputerContext, name: string): Promise<SandboxInfo | null> {
  return providerRequest<SandboxInfo>(ctx, `${apiBase()}/sandbox/${encodeURIComponent(name)}`, {}, true);
}

async function readRow(ctx: CloudComputerContext, chatKey: string): Promise<ComputerRow | null> {
  const db = dbOf(ctx);
  await ensureTable(db);
  const rows = await db.query<ComputerRow>(
    "SELECT chat_key, chat_id, model_id, sandbox_id, sandbox_name, snapshot, state, last_billed_at, created_at, updated_at FROM cloud_computers WHERE chat_key = $1 LIMIT 1",
    chatKey,
  );
  return rows[0] || null;
}

async function saveRow(ctx: CloudComputerContext, row: Omit<ComputerRow, "created_at" | "updated_at" | "last_billed_at"> & { chat_id?: number }): Promise<void> {
  const db = dbOf(ctx);
  await ensureTable(db);
  await db.exec(
    "INSERT INTO cloud_computers (chat_key, chat_id, model_id, sandbox_id, sandbox_name, snapshot, state, last_billed_at, updated_at) " +
    "VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'started' THEN now() ELSE NULL END, now()) " +
    "ON CONFLICT (chat_key) DO UPDATE SET chat_id = EXCLUDED.chat_id, model_id = EXCLUDED.model_id, " +
    "sandbox_id = EXCLUDED.sandbox_id, sandbox_name = EXCLUDED.sandbox_name, snapshot = EXCLUDED.snapshot, " +
    "last_billed_at = CASE WHEN EXCLUDED.state <> 'started' THEN NULL " +
    "WHEN cloud_computers.state = 'stopped' OR cloud_computers.last_billed_at IS NULL THEN now() " +
    "ELSE cloud_computers.last_billed_at END, state = EXCLUDED.state, updated_at = now()",
    row.chat_key, Number(ctx.chatId), row.model_id, row.sandbox_id, row.sandbox_name, row.snapshot, row.state,
  );
}
async function waitUntilStarted(ctx: CloudComputerContext, id: string): Promise<SandboxInfo> {
  let latest: SandboxInfo | null = null;
  for (let i = 0; i < 40; i++) {
    latest = await getSandbox(ctx, id);
    const state = String(latest?.state || "").toLowerCase();
    if (state === "started" || state === "running") return latest!;
    if (/error|failed|deleted|archived/.test(state)) {
      throw new Error(`Cloud computer failed to start (${state}): ${String(latest?.errorReason || "").slice(0, 160)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Cloud computer did not reach the running state in time (last state: ${latest?.state || "unknown"}).`);
}

async function waitUntilStopped(ctx: CloudComputerContext, id: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const current = await getSandbox(ctx, id);
    const state = String(current?.state || "").toLowerCase();
    if (state === "stopped") return;
    if (/error|failed|deleted|archived/.test(state)) throw new Error(`Cloud computer stop failed (${state}).`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Cloud computer did not reach the stopped state in time.");
}

async function startSandbox(ctx: CloudComputerContext, sandbox: SandboxInfo): Promise<SandboxInfo> {
  const state = String(sandbox.state || "").toLowerCase();
  if (state === "started" || state === "running") return sandbox;
  await providerRequest(ctx, `${apiBase()}/sandbox/${encodeURIComponent(sandbox.id)}/start`, { method: "POST", body: "{}" });
  return waitUntilStarted(ctx, sandbox.id);
}

async function createSandbox(ctx: CloudComputerContext, name: string, snapshot: string): Promise<SandboxInfo> {
  // VM snapshots provide a dedicated guest kernel; auto-stop, auto-pause and auto-delete are disabled.
  // The user can explicitly stop the computer and resume it later without losing its persistent filesystem.
  const payload = {
    name,
    snapshot,
    autoStopInterval: 0,
    autoPauseInterval: 0,
    autoDeleteInterval: -1,
    ephemeral: false,
    labels: {
      application: "ttbik",
      feature: "cloud-computer",
      workspace: cloudComputerIdentity(ctx.chatId, ctx.modelId).chatKey.slice(-12),
      model: normalizedModelId(ctx.modelId),
    },
  };
  const created = await providerRequest<SandboxInfo>(ctx, `${apiBase()}/sandbox`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!created?.id) {
    // Deterministic provider names make a concurrent create safe: the winning request owns the VM.
    const existing = await getSandboxByName(ctx, name);
    if (!existing?.id) throw new Error("Cloud computer creation returned no sandbox identifier.");
    return existing;
  }
  return created;
}

async function openSandbox(ctx: CloudComputerContext): Promise<{ identity: ReturnType<typeof cloudComputerIdentity>; sandbox: SandboxInfo; snapshot: string }> {
  await assertEntitlement(ctx);
  const identity = cloudComputerIdentity(ctx.chatId, ctx.modelId);
  const snapshot = await cloudComputerSnapshot(ctx);
  let row = await readRow(ctx, identity.chatKey);
  let sandbox: SandboxInfo | null = row ? await getSandbox(ctx, row.sandbox_id) : null;
  if (!sandbox) sandbox = await getSandboxByName(ctx, identity.sandboxName);
  if (!sandbox) sandbox = await createSandbox(ctx, identity.sandboxName, snapshot);
  if (!sandbox.id) throw new Error("Cloud computer provider returned an invalid sandbox.");
  sandbox = await startSandbox(ctx, sandbox);
  await saveRow(ctx, {
    chat_key: identity.chatKey,
    chat_id: Number(ctx.chatId),
    model_id: identity.modelId,
    sandbox_id: sandbox.id,
    sandbox_name: identity.sandboxName,
    snapshot: String(sandbox.snapshot || snapshot),
    state: "started",
  });
  return { identity, sandbox, snapshot };
}

async function toolboxRequest<T = any>(
  ctx: CloudComputerContext,
  sandbox: SandboxInfo,
  path: string,
  init: RequestInit = {},
  notFoundIsNull = false,
): Promise<T | null> {
  const proxy = (sandbox.toolboxProxyUrl || toolboxBase()).replace(/\/+$/, "");
  return providerRequest<T>(ctx, `${proxy}/${encodeURIComponent(sandbox.id)}${path}`, init, notFoundIsNull);
}

async function startDesktop(ctx: CloudComputerContext, sandbox: SandboxInfo): Promise<Json> {
  const status = await toolboxRequest<Json>(ctx, sandbox, "/computeruse/status", {}, true);
  const current = String(status?.status || "").toLowerCase();
  if (["ready", "running", "started"].includes(current)) return status || { status: "ready" };
  const started = await toolboxRequest<Json>(ctx, sandbox, "/computeruse/start", { method: "POST", body: "{}" });
  return started || { status: "started" };
}

async function readSignedPreview(ctx: CloudComputerContext, sandbox: SandboxInfo, port = VNC_PORT): Promise<string> {
  const safePort = Math.max(1, Math.min(65535, Math.floor(Number(port) || VNC_PORT)));
  const response = await providerRequest<Json>(
    ctx,
    `${apiBase()}/sandbox/${encodeURIComponent(sandbox.id)}/ports/${safePort}/signed-preview-url?expiresInSeconds=${PREVIEW_TTL_SECONDS}`,
  );
  const url = String(response?.url || response?.signedUrl || response?.signedPreviewUrl || "").trim();
  if (!/^https:\/\//i.test(url)) throw new Error("Daytona did not return a valid signed preview link.");
  return url;
}

async function chargeCompute(_ctx: CloudComputerContext, _elapsedMs: number): Promise<void> {
  // Persistent VM wall time is metered by cloudComputerRuntimeTick (one-minute Oracle heartbeat).
  // Per-request HTTP latency is not separately billed, avoiding double counting.
}

async function requireComputeAllowance(ctx: CloudComputerContext): Promise<void> {
  if (ctx.tier === "owner") return;
  const result = await checkLimit(ctx.chatId, "sandbox_minutes", 0, dbOf(ctx));
  if (!result.ok) throw new Error("انتهى رصيد وقت الحاسوب في خطتك الحالية. أوقف الحاسوب لحفظ ملفاته أو رقِّ خطتك.");
}

/** Bill actual VM uptime from the one-minute Oracle sweeper, not just API request latency. */
export async function cloudComputerRuntimeTick(db: Db = prismaDb, now = new Date(), batchSize = 20): Promise<{ billedSeconds: number; stopped: number; errors: string[] }> {
  await ensureTable(db);
  const sql = "WITH due AS (" +
    " SELECT chat_key, chat_id, model_id, sandbox_id, sandbox_name, snapshot," +
    " GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (date_trunc('minute', $1::timestamptz) - last_billed_at)))::int) AS elapsed_seconds" +
    " FROM cloud_computers WHERE state = 'started' AND last_billed_at IS NOT NULL" +
    " AND last_billed_at < date_trunc('minute', $1::timestamptz) - interval '1 minute'" +
    " ORDER BY last_billed_at FOR UPDATE SKIP LOCKED LIMIT $2" +
    "), updated AS (" +
    " UPDATE cloud_computers AS current SET last_billed_at = date_trunc('minute', $1::timestamptz), updated_at = now()" +
    " FROM due WHERE current.chat_key = due.chat_key" +
    " RETURNING due.chat_key, due.chat_id, due.model_id, due.sandbox_id, due.sandbox_name, due.snapshot, due.elapsed_seconds" +
    ") SELECT * FROM updated";
  const rows = await db.query<{ chat_key: string; chat_id: number | string; model_id: string; sandbox_id: string; sandbox_name: string; snapshot: string; elapsed_seconds: number }>(
    sql, now.toISOString(), Math.max(1, Math.min(100, batchSize)),
  );
  let billedSeconds = 0;
  let stopped = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const chatId = Number(row.chat_id);
    const ctx: CloudComputerContext = { chatId, modelId: row.model_id, tier: tierFor(chatId), db };
    const seconds = Math.max(1, Number(row.elapsed_seconds) || 60);
    if (ctx.tier !== "owner") {
      const paid = await terminalAllowed(chatId, db);
      const allowance = paid ? await checkLimit(chatId, "sandbox_minutes", Math.ceil(seconds / 60), db) : { ok: false as const };
      if (!allowance.ok) {
        try {
          const sandbox = await getSandbox(ctx, row.sandbox_id);
          if (sandbox && !["stopped", "deleted", "archived"].includes(String(sandbox.state || "").toLowerCase())) {
            await providerRequest(ctx, apiBase() + "/sandbox/" + encodeURIComponent(row.sandbox_id) + "/stop", { method: "POST", body: "{}" });
            await waitUntilStopped(ctx, row.sandbox_id);
          }
          await saveRow(ctx, {
            chat_key: row.chat_key, chat_id: chatId, model_id: row.model_id, sandbox_id: row.sandbox_id,
            sandbox_name: row.sandbox_name, snapshot: row.snapshot, state: "stopped",
          });
          stopped++;
        } catch (error) {
          errors.push(row.model_id + ": " + String((error as Error)?.message || error).slice(0, 160));
        }
        continue;
      }
      await addUsage(chatId, "sandbox_minutes", seconds, db);
    }
    billedSeconds += seconds;
  }
  return { billedSeconds, stopped, errors };
}

export async function cloudComputerStatus(ctx: CloudComputerContext): Promise<Json> {
  await assertIdentity(ctx);
  const identity = cloudComputerIdentity(ctx.chatId, ctx.modelId);
  const row = await readRow(ctx, identity.chatKey);
  if (!row) return { exists: false, state: "not_created", modelId: identity.modelId };
  const sandbox = await getSandbox(ctx, row.sandbox_id);
  if (!sandbox) return { exists: false, state: "not_found", modelId: identity.modelId };
  let desktop: Json | null = null;
  if (String(sandbox.state).toLowerCase() === "started") {
    desktop = await toolboxRequest<Json>(ctx, sandbox, "/computeruse/status", {}, true).catch(() => null);
  }
  return {
    exists: true,
    state: String(sandbox.state || row.state),
    desktopState: desktop?.status || "unknown",
    snapshot: row.snapshot,
    modelId: identity.modelId,
    resources: row.snapshot.includes("large") ? { vcpu: 4, memoryGiB: 8, diskGiB: 10 } : { vcpu: 2, memoryGiB: 4, diskGiB: 8 },
    persistent: true,
  };
}

export async function cloudComputerOpen(ctx: CloudComputerContext): Promise<Json> {
  await requireComputeAllowance(ctx);
  const { sandbox, identity, snapshot } = await openSandbox(ctx);
  const desktop = await startDesktop(ctx, sandbox);
  const previewUrl = await readSignedPreview(ctx, sandbox);
  await saveRow(ctx, {
    chat_key: identity.chatKey,
    chat_id: Number(ctx.chatId),
    model_id: identity.modelId,
    sandbox_id: sandbox.id,
    sandbox_name: identity.sandboxName,
    snapshot: String(sandbox.snapshot || snapshot),
    state: "started",
  });
  return {
    ok: true,
    state: "started",
    modelId: identity.modelId,
    snapshot: String(sandbox.snapshot || snapshot),
    desktopState: desktop.status || "started",
    previewUrl,
    previewExpiresInSeconds: PREVIEW_TTL_SECONDS,
  };
}

export async function cloudComputerStop(ctx: CloudComputerContext): Promise<Json> {
  // Stopping remains available after a subscription expires so the owner can safely release compute.
  await assertIdentity(ctx);
  const identity = cloudComputerIdentity(ctx.chatId, ctx.modelId);
  const row = await readRow(ctx, identity.chatKey);
  if (!row) return { ok: true, state: "not_created" };
  const sandbox = await getSandbox(ctx, row.sandbox_id);
  if (!sandbox) return { ok: true, state: "not_found" };
  await providerRequest(ctx, `${apiBase()}/sandbox/${encodeURIComponent(sandbox.id)}/stop`, { method: "POST", body: "{}" });
  await waitUntilStopped(ctx, sandbox.id);
  await saveRow(ctx, { ...row, chat_id: Number(ctx.chatId), state: "stopped" });
  return { ok: true, state: "stopped", persistent: true };
}

export async function cloudComputerRefreshPreview(ctx: CloudComputerContext): Promise<Json> {
  await requireComputeAllowance(ctx);
  const { sandbox, identity, snapshot } = await openSandbox(ctx);
  const desktop = await startDesktop(ctx, sandbox);
  const previewUrl = await readSignedPreview(ctx, sandbox);
  await saveRow(ctx, {
    chat_key: identity.chatKey,
    model_id: identity.modelId,
    sandbox_id: sandbox.id,
    sandbox_name: identity.sandboxName,
    snapshot: String(sandbox.snapshot || snapshot),
    state: "started",
  });
  return { previewUrl, previewExpiresInSeconds: PREVIEW_TTL_SECONDS, desktopState: desktop.status || "started" };
}

function terminalSessionId(chatKey: string): string {
  return "ttbik-shell-" + createHash("sha256").update("ttbik-cloud-shell-v2|" + chatKey).digest("hex").slice(0, 20);
}

function terminalToolboxBase(): string {
  return (process.env.DAYTONA_TOOLBOX_V2_URL || "https://toolbox.daytona.com/toolbox").trim().replace(/\/+$/, "");
}

async function terminalRequest<T = any>(
  ctx: CloudComputerContext,
  sandbox: SandboxInfo,
  path: string,
  init: RequestInit = {},
  notFoundIsNull = false,
): Promise<T | null> {
  const base = terminalToolboxBase();
  return providerRequest<T>(ctx, `${base}/${encodeURIComponent(sandbox.id)}${path}`, init, notFoundIsNull);
}

async function ensureTerminalPty(ctx: CloudComputerContext, sandbox: SandboxInfo): Promise<string> {
  const identity = cloudComputerIdentity(ctx.chatId, ctx.modelId);
  const id = terminalSessionId(identity.chatKey);
  const existing = await terminalRequest<Json>(ctx, sandbox, "/processes/" + encodeURIComponent(id), {}, true);
  const state = String(existing?.state || "").toLowerCase();
  if (existing && ["running", "queued", "starting"].includes(state)) return id;
  if (existing) {
    await terminalRequest(ctx, sandbox, "/processes/" + encodeURIComponent(id), { method: "DELETE" }, true);
  }
  try {
    await terminalRequest(ctx, sandbox, "/processes", {
      method: "POST",
      body: JSON.stringify({
        kind: "pty",
        name: id,
        shellCommand: "/bin/bash -l",
        cwd: "/home/daytona",
        stdin: "open",
        keepLogs: "until_cleanup",
        terminal: { cols: 120, rows: 32 },
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    // Two tabs may reconnect at the same time. Reuse the PTY created by the winning request.
    const raced = await terminalRequest<Json>(ctx, sandbox, "/processes/" + encodeURIComponent(id), {}, true).catch(() => null);
    if (raced && ["running", "queued", "starting"].includes(String(raced.state || "").toLowerCase())) return id;
    throw error;
  }
  const created = await terminalRequest<Json>(ctx, sandbox, "/processes/" + encodeURIComponent(id), {}, true);
  const createdState = String(created?.state || "").toLowerCase();
  if (!created || !["running", "queued", "starting"].includes(createdState)) {
    throw new Error("Daytona did not start the persistent interactive shell (state: " + (createdState || "unknown") + ").");
  }
  return id;
}

/** One PTY shell per verified account and selected model, inside that model's persistent cloud computer. */
export async function cloudComputerTerminalOpen(ctx: CloudComputerContext): Promise<Json> {
  await requireComputeAllowance(ctx);
  const { sandbox } = await openSandbox(ctx);
  const sessionId = await ensureTerminalPty(ctx, sandbox);
  const info = await terminalRequest<Json>(ctx, sandbox, "/processes/" + encodeURIComponent(sessionId));
  return {
    ok: true,
    sessionId,
    state: info?.state || "running",
    cwd: info?.cwd || "/home/daytona",
    shell: "/bin/bash",
    terminal: info?.terminal || { cols: 120, rows: 32 },
    computerSandboxId: sandbox.id,
  };
}

/** Send a command to the live PTY. The shell, cwd and environment stay attached to this VM session. */
export async function cloudComputerTerminalExecute(ctx: CloudComputerContext, command: string): Promise<Json> {
  await requireComputeAllowance(ctx);
  const text = String(command || "");
  if (!text.trim()) throw new Error("A shell command is required.");
  if (text.length > MAX_COMMAND_CHARS) throw new Error("The shell command is too long.");
  const { sandbox } = await openSandbox(ctx);
  const sessionId = await ensureTerminalPty(ctx, sandbox);
  await terminalRequest(ctx, sandbox, "/processes/" + encodeURIComponent(sessionId) + "/stdin", {
    method: "POST",
    body: JSON.stringify({ data: text.replace(/\r?\n$/, "") + "\n" }),
  });
  return { ok: true, sessionId };
}

/** Read only the PTY log frames after the supplied cursor; this is safe to poll from the integrated computer panel. */
export async function cloudComputerTerminalPoll(ctx: CloudComputerContext, sessionId: string, cursor?: string): Promise<Json> {
  await requireComputeAllowance(ctx);
  const identity = cloudComputerIdentity(ctx.chatId, ctx.modelId);
  const expected = terminalSessionId(identity.chatKey);
  if (String(sessionId || "") !== expected) throw new Error("This terminal session does not belong to the selected model computer.");
  const { sandbox } = await openSandbox(ctx);
  const query = new URLSearchParams({ limit: "500" });
  if (cursor) query.set("cursor", String(cursor).slice(0, 300));
  let page: Json | null = null;
  try {
    page = await terminalRequest<Json>(ctx, sandbox, "/processes/" + encodeURIComponent(expected) + "/logs?" + query.toString());
  } catch (error) {
    if (!cursor || !/HTTP 409/.test(String((error as Error)?.message || error))) throw error;
    // A PTY's log retention can expire an old cursor; replay the oldest still-retained output.
    page = await terminalRequest<Json>(ctx, sandbox, "/processes/" + encodeURIComponent(expected) + "/logs?limit=500");
  }
  const info = await terminalRequest<Json>(ctx, sandbox, "/processes/" + encodeURIComponent(expected));
  const items = Array.isArray(page?.items) ? page.items : [];
  const output = items.map((frame: any) => String(frame?.data || "")).join("");
  const nextCursor = items.length ? String(items[items.length - 1]?.cursor || cursor || "") : String(cursor || "");
  const state = String(info?.state || "unknown").toLowerCase();
  const complete = ["terminal", "failed", "killed", "exited", "stopped", "completed", "finished"].includes(state);
  return {
    sessionId: expected,
    output: output.slice(-24000),
    cursor: nextCursor,
    state,
    complete,
    exitCode: typeof info?.exitCode === "number" ? info.exitCode : null,
    cwd: info?.cwd || null,
  };
}

/** Send text, interactive input, or a raw control byte (for example Ctrl+C = U+0003) to this model's PTY. */
export async function cloudComputerTerminalInput(ctx: CloudComputerContext, sessionId: string, data: string): Promise<Json> {
  await requireComputeAllowance(ctx);
  const identity = cloudComputerIdentity(ctx.chatId, ctx.modelId);
  const expected = terminalSessionId(identity.chatKey);
  if (String(sessionId || "") !== expected) throw new Error("This terminal session does not belong to the selected model computer.");
  const input = String(data ?? "");
  if (!input || input.length > 12000) throw new Error("Terminal input must contain 1 to 12000 characters.");
  const { sandbox } = await openSandbox(ctx);
  await ensureTerminalPty(ctx, sandbox);
  await terminalRequest(ctx, sandbox, "/processes/" + encodeURIComponent(expected) + "/stdin", {
    method: "POST",
    body: JSON.stringify({ data: input }),
  });
  return { ok: true, sessionId: expected };
}

/** Mint a short-lived, port-scoped Daytona token for the browser's direct PTY WebSocket.
 * The project API key never leaves this server. The token is limited to this user's selected VM toolbox port.
 */
export async function cloudComputerTerminalTicket(ctx: CloudComputerContext, sessionId: string, cursor?: string): Promise<Json> {
  await requireComputeAllowance(ctx);
  const identity = cloudComputerIdentity(ctx.chatId, ctx.modelId);
  const expected = terminalSessionId(identity.chatKey);
  if (String(sessionId || "") !== expected) throw new Error("This terminal session does not belong to the selected model computer.");
  const { sandbox } = await openSandbox(ctx);
  await ensureTerminalPty(ctx, sandbox);
  // Port-scoped, short-lived preview credential: the project API key never reaches the browser.
  const signedPreview = await readSignedPreview(ctx, sandbox, 2280);
  const socketUrl = new URL(signedPreview);
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  // A signed preview host is already routed to this sandbox's Toolbox port, so use the Toolbox API path
  // relative to that port rather than repeating the proxy's /toolbox/{sandboxId} routing prefix.
  socketUrl.pathname = `/processes/${encodeURIComponent(expected)}/attach`;
  if (cursor) socketUrl.searchParams.set("cursor", String(cursor).slice(0, 300));
  return { url: socketUrl.toString(), transport: "websocket", sandboxId: sandbox.id, sessionId: expected };
}

/** Forward xterm's measured dimensions to the PTY so TUI applications receive SIGWINCH. */
export async function cloudComputerTerminalResize(ctx: CloudComputerContext, sessionId: string, cols: number, rows: number): Promise<Json> {
  await requireComputeAllowance(ctx);
  const identity = cloudComputerIdentity(ctx.chatId, ctx.modelId);
  const expected = terminalSessionId(identity.chatKey);
  if (String(sessionId || "") !== expected) throw new Error("This terminal session does not belong to the selected model computer.");
  const c = Math.max(20, Math.min(300, Math.floor(Number(cols) || 0)));
  const r = Math.max(5, Math.min(120, Math.floor(Number(rows) || 0)));
  if (!c || !r) throw new Error("Terminal dimensions are invalid.");
  const { sandbox } = await openSandbox(ctx);
  await ensureTerminalPty(ctx, sandbox);
  const result = await terminalRequest<Json>(ctx, sandbox, `/processes/${encodeURIComponent(expected)}/resize`, {
    method: "POST",
    body: JSON.stringify({ cols: c, rows: r }),
  });
  return { ok: true, cols: c, rows: r, terminal: result?.terminal || { cols: c, rows: r } };
}

export async function cloudComputerExecute(ctx: CloudComputerContext, command: string, cwd?: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<Json> {
  await requireComputeAllowance(ctx);
  const text = String(command || "").trim();
  if (!text) throw new Error("A shell command is required.");
  if (text.length > MAX_COMMAND_CHARS) throw new Error("The shell command is too long.");
  const { sandbox } = await openSandbox(ctx);
  const started = Date.now();
  try {
    const result = await toolboxRequest<Json>(ctx, sandbox, "/process/execute", {
      method: "POST",
      body: JSON.stringify({
        command: text,
        cwd: cwd || "/home/daytona",
        timeout: Math.max(1, Math.min(300, Math.ceil(timeoutMs / 1000))),
      }),
      signal: AbortSignal.timeout(Math.max(15000, Math.min(310000, timeoutMs + 10000))),
    });
    return {
      exitCode: typeof result?.exitCode === "number" ? result.exitCode : null,
      stdout: String(result?.result || result?.stdout || "").slice(0, 14000),
      stderr: String(result?.stderr || "").slice(0, 6000),
      sandboxId: sandbox.id,
    };
  } finally {
    await chargeCompute(ctx, Date.now() - started);
  }
}

export async function cloudComputerWriteFile(ctx: CloudComputerContext, path: string, content: string): Promise<Json> {
  await requireComputeAllowance(ctx);
  const filePath = String(path || "").trim();
  if (!filePath.startsWith("/") || filePath.includes("\0") || filePath.split("/").includes("..")) throw new Error("Use an absolute file path inside the computer.");
  const bytes = Buffer.from(String(content ?? ""), "utf8");
  if (bytes.length > MAX_FILE_BYTES) throw new Error("File write limit is 8 MB per request.");
  const { sandbox } = await openSandbox(ctx);
  const form = new FormData();
  form.append("file", new Blob([bytes]), filePath.split("/").pop() || "file");
  const started = Date.now();
  try {
    await toolboxRequest(ctx, sandbox, `/files/upload-v2?path=${encodeURIComponent(filePath)}`, { method: "POST", body: form });
  } finally {
    await chargeCompute(ctx, Date.now() - started);
  }
  return { ok: true, path: filePath, bytes: bytes.length };
}

export async function cloudComputerReadFile(ctx: CloudComputerContext, path: string): Promise<{ path: string; bytes: Buffer } | null> {
  await requireComputeAllowance(ctx);
  const filePath = String(path || "").trim();
  if (!filePath.startsWith("/") || filePath.includes("\0") || filePath.split("/").includes("..")) throw new Error("Use an absolute file path inside the computer.");
  const { sandbox } = await openSandbox(ctx);
  const proxy = (sandbox.toolboxProxyUrl || toolboxBase()).replace(/\/+$/, "");
  const response = await fetchOf(ctx)(`${proxy}/${encodeURIComponent(sandbox.id)}/files/download?path=${encodeURIComponent(filePath)}`, {
    headers: { Authorization: `Bearer ${token()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Computer file download failed (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 45 * 1024 * 1024) throw new Error("The requested file exceeds the 45 MB transfer limit.");
  return { path: filePath, bytes };
}

function checkedComputerPath(value: unknown): string {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.includes("\\0") || path.split("/").includes("..")) {
    throw new Error("Use an absolute path without parent-directory segments.");
  }
  if (path.length > 1200) throw new Error("The computer file path is too long.");
  return path;
}

export type CloudComputerFile = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: string | null;
  mode: string | null;
};

export async function cloudComputerListFiles(ctx: CloudComputerContext, path = "/home/daytona", depth = 1): Promise<Json> {
  await requireComputeAllowance(ctx);
  const directory = checkedComputerPath(path);
  const maxDepth = Math.max(1, Math.min(3, Math.floor(Number(depth) || 1)));
  const { sandbox } = await openSandbox(ctx);
  const query = new URLSearchParams({ path: directory, depth: String(maxDepth) });
  const result = await toolboxRequest<any>(ctx, sandbox, "/files?" + query.toString());
  const rows = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : Array.isArray(result?.files) ? result.files : [];
  const items: CloudComputerFile[] = rows.slice(0, 500).map((file: any) => {
    const name = String(file?.name || String(file?.path || "").split("/").pop() || "");
    const filePath = String(file?.path || (directory.replace(/\\/$/, "") + "/" + name));
    return {
      name,
      path: checkedComputerPath(filePath.startsWith("/") ? filePath : (directory.replace(/\\/$/, "") + "/" + filePath)),
      isDir: Boolean(file?.isDir ?? file?.is_dir ?? file?.isDirectory),
      size: Math.max(0, Number(file?.size) || 0),
      modifiedAt: String(file?.modTime || file?.modifiedAt || file?.modifiedTime || file?.mod_time || "") || null,
      mode: String(file?.mode || file?.permissions || "") || null,
    };
  }).filter((file) => file.name);
  items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  return { path: directory, items, truncated: rows.length > 500 };
}

export async function cloudComputerCreateFolder(ctx: CloudComputerContext, path: string): Promise<Json> {
  await requireComputeAllowance(ctx);
  const folder = checkedComputerPath(path);
  if (folder === "/") throw new Error("The root directory already exists.");
  const { sandbox } = await openSandbox(ctx);
  const query = new URLSearchParams({ path: folder, mode: "755" });
  await toolboxRequest(ctx, sandbox, "/files/folder?" + query.toString(), { method: "POST" });
  return { ok: true, path: folder };
}

export async function cloudComputerDeleteFile(ctx: CloudComputerContext, path: string, recursive = false): Promise<Json> {
  await requireComputeAllowance(ctx);
  const filePath = checkedComputerPath(path);
  if (filePath === "/" || filePath === "/home" || filePath === "/home/daytona") throw new Error("Refusing to delete a protected computer root.");
  const { sandbox } = await openSandbox(ctx);
  const query = new URLSearchParams({ path: filePath });
  if (recursive) query.set("recursive", "true");
  await toolboxRequest(ctx, sandbox, "/files?" + query.toString(), { method: "DELETE" });
  return { ok: true, path: filePath };
}

export async function cloudComputerFileDownload(ctx: CloudComputerContext, path: string): Promise<Json> {
  const file = await cloudComputerReadFile(ctx, checkedComputerPath(path));
  if (!file) throw new Error("The requested file was not found.");
  if (file.bytes.length > 8 * 1024 * 1024) throw new Error("Browser file transfers are limited to 8 MB; use the terminal for larger files.");
  return { path: file.path, size: file.bytes.length, base64: file.bytes.toString("base64") };
}

export async function cloudComputerFileUpload(ctx: CloudComputerContext, path: string, base64: string): Promise<Json> {
  await requireComputeAllowance(ctx);
  const filePath = checkedComputerPath(path);
  const encoded = String(base64 || "");
  if (!encoded || encoded.length > 11_200_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Invalid file upload payload.");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error("File upload limit is 8 MB.");
  const { sandbox } = await openSandbox(ctx);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), filePath.split("/").pop() || "file");
  await toolboxRequest(ctx, sandbox, "/files/upload-v2?path=" + encodeURIComponent(filePath), { method: "POST", body: form });
  return { ok: true, path: filePath, bytes: bytes.length };
}

export type CloudScreenshotOptions = {
  region?: { x: number; y: number; width: number; height: number };
  compressed?: boolean;
  format?: "png" | "jpeg";
  quality?: number;
  scale?: number;
};

function safeRecordingId(value: unknown): string {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid recording id.");
  return id;
}

function safeProcessName(value: unknown): string {
  const name = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name)) throw new Error("Invalid desktop process name.");
  return name;
}

async function screenshotEndpoint(ctx: CloudComputerContext, sandbox: SandboxInfo, path: string): Promise<Json> {
  const started = Date.now();
  try {
    const result = await toolboxRequest<Json>(ctx, sandbox, path);
    const b64 = String(result?.screenshot || result?.image || result?.data || "");
    if (!b64) throw new Error("The desktop did not return a screenshot.");
    return { screenshot: b64, mimeType: String(result?.mimeType || result?.mime_type || "image/png"), width: result?.width || null, height: result?.height || null };
  } finally {
    await chargeCompute(ctx, Date.now() - started);
  }
}

export async function cloudComputerAction(ctx: CloudComputerContext, action: string, args: Json = {}): Promise<Json> {
  await requireComputeAllowance(ctx);
  const { sandbox } = await openSandbox(ctx);
  await startDesktop(ctx, sandbox);
  const processName = () => safeProcessName(
    ["process_status", "process_restart", "process_logs", "process_errors"].includes(action)
      ? (args.process || args.process_name)
      : "desktop",
  );
  const id = () => safeRecordingId(
    ["recording_stop", "recording_get", "recording_delete", "recording_download"].includes(action)
      ? (args.id || args.recording_id)
      : "unused",
  );
  const nodeId = () => safeRecordingId(
    ["accessibility_focus", "accessibility_invoke", "accessibility_set_value"].includes(action)
      ? args.node_id
      : "unused",
  );
  const calls: Record<string, { path: string; method?: string; body?: Json }> = {
    click: { path: "/computeruse/mouse/click", method: "POST", body: { x: Number(args.x), y: Number(args.y), button: args.button || "left", double: Boolean(args.double) } },
    move: { path: "/computeruse/mouse/move", method: "POST", body: { x: Number(args.x), y: Number(args.y) } },
    drag: { path: "/computeruse/mouse/drag", method: "POST", body: { button: args.button || "left", startX: Number(args.start_x), startY: Number(args.start_y), endX: Number(args.end_x), endY: Number(args.end_y) } },
    mouse_position: { path: "/computeruse/mouse/position" },
    type: { path: "/computeruse/keyboard/type", method: "POST", body: { text: String(args.text || ""), delay: Number(args.delay) || 0 } },
    press: { path: "/computeruse/keyboard/key", method: "POST", body: { key: String(args.key || ""), modifiers: Array.isArray(args.modifiers) ? args.modifiers.map(String) : [] } },
    hotkey: { path: "/computeruse/keyboard/hotkey", method: "POST", body: { keys: String(args.keys || "") } },
    scroll: { path: "/computeruse/mouse/scroll", method: "POST", body: { x: Number(args.x), y: Number(args.y), direction: args.direction === "up" ? "up" : "down", amount: Math.max(1, Math.min(100, Number(args.amount) || 1)) } },
    windows: { path: "/computeruse/display/windows" },
    display_info: { path: "/computeruse/display/info" },
    desktop_status: { path: "/computeruse/status" },
    accessibility_tree: { path: `/computeruse/a11y/tree?${new URLSearchParams({ scope: String(args.scope || "focused"), maxDepth: String(Math.max(1, Math.min(12, Number(args.max_depth) || 5))), ...(Number(args.pid) > 0 ? { pid: String(Math.floor(Number(args.pid))) } : {}) })}` },
    accessibility_find: { path: "/computeruse/a11y/find", method: "POST", body: {
      scope: String(args.scope || "focused"),
      ...(Number(args.pid) > 0 ? { pid: Math.floor(Number(args.pid)) } : {}),
      ...(args.role ? { role: String(args.role).slice(0, 80) } : {}),
      ...(args.name ? { name: String(args.name).slice(0, 180) } : {}),
      ...(args.name_match ? { nameMatch: String(args.name_match) } : {}),
      ...(Array.isArray(args.states) ? { states: args.states.map(String).slice(0, 12) } : {}),
      limit: Math.max(1, Math.min(100, Number(args.limit) || 20)),
    } },
    accessibility_focus: { path: "/computeruse/a11y/node/focus", method: "POST", body: { id: nodeId() } },
    accessibility_invoke: { path: "/computeruse/a11y/node/invoke", method: "POST", body: { id: nodeId(), ...(args.node_action ? { action: String(args.node_action).slice(0, 80) } : {}) } },
    accessibility_set_value: { path: "/computeruse/a11y/node/value", method: "POST", body: { id: nodeId(), value: String(args.value || "").slice(0, 12000) } },
    recording_start: { path: "/computeruse/recordings/start", method: "POST", body: { name: String(args.name || `ttbik-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) } },
    recording_stop: { path: "/computeruse/recordings/stop", method: "POST", body: { id: id() } },
    recording_list: { path: "/computeruse/recordings" },
    recording_get: { path: `/computeruse/recordings/${encodeURIComponent(id())}` },
    recording_delete: { path: `/computeruse/recordings/${encodeURIComponent(id())}`, method: "DELETE" },
    process_status: { path: `/computeruse/process/${encodeURIComponent(processName())}/status` },
    process_restart: { path: `/computeruse/process/${encodeURIComponent(processName())}/restart`, method: "POST", body: {} },
    process_logs: { path: `/computeruse/process/${encodeURIComponent(processName())}/logs` },
    process_errors: { path: `/computeruse/process/${encodeURIComponent(processName())}/errors` },
  };
  if (action === "screenshot") return screenshotEndpoint(ctx, sandbox, "/computeruse/screenshot");
  if (action === "screenshot_compressed") {
    const query = new URLSearchParams();
    query.set("format", args.format === "jpeg" ? "jpeg" : "png");
    query.set("quality", String(Math.max(1, Math.min(100, Number(args.quality) || 85))));
    query.set("scale", String(Math.max(0.1, Math.min(1, Number(args.scale) || 1))));
    return screenshotEndpoint(ctx, sandbox, `/computeruse/screenshot/compressed?${query.toString()}`);
  }
  if (action === "screenshot_region" || action === "screenshot_region_compressed") {
    const x = Math.max(0, Math.floor(Number(args.x) || 0));
    const y = Math.max(0, Math.floor(Number(args.y) || 0));
    const width = Math.max(1, Math.min(4096, Math.floor(Number(args.width) || 1)));
    const height = Math.max(1, Math.min(4096, Math.floor(Number(args.height) || 1)));
    const query = new URLSearchParams({ x: String(x), y: String(y), width: String(width), height: String(height) });
    if (action === "screenshot_region_compressed") {
      query.set("format", args.format === "jpeg" ? "jpeg" : "png");
      query.set("quality", String(Math.max(1, Math.min(100, Number(args.quality) || 85))));
    }
    return screenshotEndpoint(ctx, sandbox, `/computeruse/screenshot/region${action.endsWith("compressed") ? "/compressed" : ""}?${query.toString()}`);
  }
  if (action === "recording_download") {
    const recordingId = id();
    const filePath = String(args.path || `/home/daytona/recordings/${recordingId}.mp4`);
    if (!filePath.startsWith("/") || filePath.includes("\0") || filePath.split("/").includes("..")) throw new Error("Use an absolute destination path inside the computer.");
    const proxy = (sandbox.toolboxProxyUrl || toolboxBase()).replace(/\/+$/, "");
    const started = Date.now();
    try {
      const response = await fetchOf(ctx)(`${proxy}/${encodeURIComponent(sandbox.id)}/computeruse/recordings/${encodeURIComponent(recordingId)}/download`, {
        headers: { Authorization: `Bearer ${token()}` }, cache: "no-store", signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`Recording download failed (HTTP ${response.status}).`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 250 * 1024 * 1024) throw new Error("Recording is empty or exceeds the 250 MB transfer cap.");
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)]), filePath.split("/").pop() || "recording.mp4");
      await toolboxRequest(ctx, sandbox, `/files/upload-v2?path=${encodeURIComponent(filePath)}`, { method: "POST", body: form });
      return { ok: true, path: filePath, bytes: bytes.length };
    } finally {
      await chargeCompute(ctx, Date.now() - started);
    }
  }
  const call = calls[action];
  if (!call) throw new Error("Unsupported computer action.");
  if (action === "type" && String(args.text || "").length > 6000) throw new Error("Text input is too long.");
  if (action === "hotkey" && String(args.keys || "").length > 80) throw new Error("Invalid hotkey.");
  if (action === "accessibility_set_value" && String(args.value || "").length > 12000) throw new Error("Accessibility value is too long.");
  if (action === "recording_start" && String(args.name || "").length > 80) throw new Error("Recording name is too long.");
  const started = Date.now();
  try {
    return await toolboxRequest<Json>(ctx, sandbox, call.path, {
      method: call.method || "GET",
      ...(call.body ? { body: JSON.stringify(call.body) } : {}),
    }) || {};
  } finally {
    await chargeCompute(ctx, Date.now() - started);
  }
}

async function cloudComputerScreenshotFromSandbox(ctx: CloudComputerContext, sandbox: SandboxInfo, options: CloudScreenshotOptions = {}): Promise<Json> {
  if (options.region) return cloudComputerAction(ctx, options.compressed ? "screenshot_region_compressed" : "screenshot_region", { ...options.region, format: options.format, quality: options.quality });
  if (options.compressed) return cloudComputerAction(ctx, "screenshot_compressed", options as Json);
  const started = Date.now();
  try {
    const result = await toolboxRequest<Json>(ctx, sandbox, "/computeruse/screenshot");
    const b64 = String(result?.screenshot || result?.image || "");
    if (!b64) throw new Error("The desktop did not return a screenshot.");
    return { screenshot: b64, mimeType: String(result?.mimeType || "image/png"), width: result?.width || null, height: result?.height || null };
  } finally {
    await chargeCompute(ctx, Date.now() - started);
  }
}

export async function cloudComputerScreenshot(ctx: CloudComputerContext, options: CloudScreenshotOptions = {}): Promise<{ path: string; bytes: Buffer } | null> {
  await requireComputeAllowance(ctx);
  const { sandbox } = await openSandbox(ctx);
  await startDesktop(ctx, sandbox);
  const result = await cloudComputerScreenshotFromSandbox(ctx, sandbox, options);
  const encoded = String(result.screenshot || "");
  return { path: "cloud-computer-screenshot." + (options.format === "jpeg" ? "jpg" : "png"), bytes: Buffer.from(encoded, "base64") };
}

/** Read the visible screen text for models whose own multimodal projector cannot accept screenshots. The OCR process is installed only in this model's own isolated computer. */
export async function cloudComputerOcrScreenshot(
  ctx: CloudComputerContext,
  imageBytes: Buffer,
  mimeType = "image/jpeg",
): Promise<string> {
  if (!imageBytes.length || imageBytes.length > 8 * 1024 * 1024) throw new Error("Screenshot is empty or too large for the OCR bridge.");
  const { sandbox } = await openSandbox(ctx);
  const path = "/tmp/ttbik-screen-ocr-" + createHash("sha256").update(String(ctx.chatId) + ":" + ctx.modelId + ":" + Date.now()).digest("hex").slice(0, 12) + (mimeType === "image/png" ? ".png" : ".jpg");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(imageBytes)], { type: mimeType }), path.split("/").pop() || "screen.jpg");
  await toolboxRequest(ctx, sandbox, "/files/upload-v2?path=" + encodeURIComponent(path), { method: "POST", body: form });
  const quoted = "'" + path.replace(/'/g, "'\\''") + "'";
  const script = [
    "set +e",
    "if ! command -v tesseract >/dev/null 2>&1; then",
    "  if command -v dnf >/dev/null 2>&1; then",
    "    sudo dnf install -y tesseract tesseract-langpack-eng tesseract-langpack-ara >/tmp/ttbik-ocr-install.log 2>&1",
    "  elif command -v apt-get >/dev/null 2>&1; then",
    "    sudo apt-get update -qq >/tmp/ttbik-ocr-install.log 2>&1 && sudo apt-get install -y tesseract-ocr tesseract-ocr-ara >>/tmp/ttbik-ocr-install.log 2>&1",
    "  fi",
    "fi",
    "if command -v tesseract >/dev/null 2>&1 && ! tesseract --list-langs 2>/dev/null | grep -q '^ara$'; then",
    "  if command -v dnf >/dev/null 2>&1; then sudo dnf install -y tesseract-langpack-ara >/tmp/ttbik-ocr-ar.log 2>&1",
    "  elif command -v apt-get >/dev/null 2>&1; then sudo apt-get install -y tesseract-ocr-ara >/tmp/ttbik-ocr-ar.log 2>&1; fi",
    "fi",
    "if command -v tesseract >/dev/null 2>&1; then",
    "  LANGS=$(tesseract --list-langs 2>/dev/null | grep -q '^ara$' && echo eng+ara || echo eng)",
    "  tesseract " + quoted + " stdout -l \"$LANGS\" 2>/dev/null",
    "else echo '__TTBIK_OCR_UNAVAILABLE__'; fi",
    "rm -f " + quoted,
  ].join("\n");
  const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const result = await cloudComputerExecute(ctx, "bash -lc " + shellQuote(script), "/home/daytona", 120000);
  const text = String(result.stdout || "").trim();
  if (!text || text.includes("__TTBIK_OCR_UNAVAILABLE__")) {
    return "OCR fallback is not installed in this model's private computer. The accessibility tree and window list are still available for computer interaction.";
  }
  return text.slice(0, 14000);
}

export async function cloudComputerSelfTest(ctx: CloudComputerContext): Promise<Json> {
  const results: Array<{ test: string; ok: boolean; detail: string }> = [];
  const check = async (test: string, task: () => Promise<string | boolean | Json>) => {
    try {
      const out = await task();
      results.push({ test, ok: true, detail: typeof out === "string" ? out.slice(0, 180) : JSON.stringify(out).slice(0, 180) });
    } catch (error) {
      results.push({ test, ok: false, detail: String((error as Error)?.message || error).slice(0, 180) });
    }
  };
  await check("isolated VM provision and start", async () => {
    const { sandbox } = await openSandbox(ctx);
    return { id: sandbox.id, state: sandbox.state, snapshot: sandbox.snapshot };
  });
  await check("arbitrary shell execution", async () => {
    const result = await cloudComputerExecute(ctx, "printf 'TTBIK_CLOUD_COMPUTER_OK\\n' && id && uname -a");
    if (result.exitCode !== 0 || !String(result.stdout).includes("TTBIK_CLOUD_COMPUTER_OK")) throw new Error("Shell execution returned an unexpected result.");
    return String(result.stdout).slice(0, 150);
  });
  const marker = `/home/daytona/.ttbik-persistence-${Date.now()}.txt`;
  await check("persistent file write and read", async () => {
    await cloudComputerWriteFile(ctx, marker, "ttbik-cloud-computer-persistence-check");
    const read = await cloudComputerReadFile(ctx, marker);
    if (!read || read.bytes.toString("utf8") !== "ttbik-cloud-computer-persistence-check") throw new Error("File bytes did not round-trip.");
    return marker;
  });
  await check("stop and resume without losing data", async () => {
    const before = await openSandbox(ctx);
    await cloudComputerStop(ctx);
    const after = await openSandbox(ctx);
    const read = await cloudComputerReadFile(ctx, marker);
    if (before.sandbox.id !== after.sandbox.id) throw new Error("The resumed computer has a different sandbox id.");
    if (!read || read.bytes.toString("utf8") !== "ttbik-cloud-computer-persistence-check") throw new Error("The persistent disk did not preserve the test file.");
    return { sandboxIdUnchanged: true, filePreserved: true };
  });
  await check("persistent interactive shell session in the same VM", async () => {
    const opened = await cloudComputerTerminalOpen(ctx);
    const id = String(opened.sessionId || "");
    if (!id) throw new Error("PTY session did not return a stable id.");
    await cloudComputerTerminalExecute(ctx, "printf 'TTBIK_PTY_ACCEPTANCE\\n'");
    const output = await cloudComputerTerminalPoll(ctx, id);
    if (!String(output.output || "").includes("TTBIK_PTY_ACCEPTANCE")) throw new Error("PTY output was not returned to the computer panel.");
    await cloudComputerTerminalInput(ctx, id, "\u0003");
    return { sessionId: id, state: output.state, outputReceived: true };
  });
  await check("desktop services start", async () => {
    const { sandbox } = await openSandbox(ctx);
    const status = await startDesktop(ctx, sandbox);
    return { status: status.status || "started" };
  });
  await check("screenshot capture", async () => {
    const shot = await cloudComputerScreenshot(ctx);
    if (!shot || !shot.bytes.length) throw new Error("Screenshot is empty.");
    return { bytes: shot.bytes.length };
  });
  await check("mouse and keyboard automation", async () => {
    await cloudComputerAction(ctx, "click", { x: 12, y: 12, button: "left" });
    await cloudComputerAction(ctx, "type", { text: "TTBIK COMPUTER TEST" });
    await cloudComputerAction(ctx, "press", { key: "esc" });
    return "click/type/press accepted";
  });
  await check("desktop window enumeration", async () => {
    const windows = await cloudComputerAction(ctx, "windows");
    return { windows: Array.isArray(windows.windows) ? windows.windows.length : 0 };
  });
  await check("signed remote desktop preview", async () => {
    const { sandbox } = await openSandbox(ctx);
    const url = await readSignedPreview(ctx, sandbox);
    return { https: url.startsWith("https://"), expiresInSeconds: PREVIEW_TTL_SECONDS };
  });
  await check("advanced mouse movement, drag and cursor position", async () => {
    await cloudComputerAction(ctx, "move", { x: 30, y: 30 });
    await cloudComputerAction(ctx, "drag", { start_x: 30, start_y: 30, end_x: 55, end_y: 55, button: "left" });
    const position = await cloudComputerAction(ctx, "mouse_position");
    return { move: true, drag: true, position: Boolean(position) };
  });
  await check("accessibility tree, find and controls", async () => {
    const tree = await cloudComputerAction(ctx, "accessibility_tree", { scope: "all", max_depth: 2 });
    const found = await cloudComputerAction(ctx, "accessibility_find", { scope: "all", limit: 5 });
    const nodes = Array.isArray(found.nodes) ? found.nodes : Array.isArray(tree.nodes) ? tree.nodes : [];
    if (nodes[0]?.id) {
      const nodeId = String(nodes[0].id);
      await cloudComputerAction(ctx, "accessibility_focus", { node_id: nodeId });
      await cloudComputerAction(ctx, "accessibility_invoke", { node_id: nodeId });
      await cloudComputerAction(ctx, "accessibility_set_value", { node_id: nodeId, value: "TTBIK accessibility check" });
    }
    return { tree: Boolean(tree), search: Boolean(found), controlsTested: Boolean(nodes[0]?.id) };
  });
  await check("display information and desktop process diagnostics", async () => {
    const display = await cloudComputerAction(ctx, "display_info");
    const status = await cloudComputerAction(ctx, "process_status", { process: "desktop" });
    await cloudComputerAction(ctx, "process_logs", { process: "desktop" });
    await cloudComputerAction(ctx, "process_errors", { process: "desktop" });
    return { display: Boolean(display), process: Boolean(status) };
  });
  await check("screen recording lifecycle and download to persistent disk", async () => {
    const started = await cloudComputerAction(ctx, "recording_start", { name: "ttbik-acceptance" });
    const recordingId = String(started.id || "");
    if (!recordingId) throw new Error("Recording API returned no id.");
    await cloudComputerAction(ctx, "recording_stop", { id: recordingId });
    await cloudComputerAction(ctx, "recording_list");
    await cloudComputerAction(ctx, "recording_get", { id: recordingId });
    const downloaded = await cloudComputerAction(ctx, "recording_download", { id: recordingId, path: "/home/daytona/recordings/ttbik-acceptance.mp4" });
    await cloudComputerAction(ctx, "recording_delete", { id: recordingId });
    return downloaded;
  });
  await check("full, regional and compressed screenshots", async () => {
    const region = await cloudComputerScreenshot(ctx, { region: { x: 0, y: 0, width: 320, height: 240 } });
    const compressed = await cloudComputerScreenshot(ctx, { compressed: true, format: "jpeg", quality: 80, scale: 0.5 });
    if (!region?.bytes.length || !compressed?.bytes.length) throw new Error("A screenshot mode returned no data.");
    return { regionBytes: region.bytes.length, compressedBytes: compressed.bytes.length };
  });

  const passed = results.filter((r) => r.ok).length;
  return { ok: passed === results.length, passed, total: results.length, results };
}
