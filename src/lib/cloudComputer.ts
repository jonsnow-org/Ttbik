import { createHash } from "crypto";
import { coderChatKey, prismaDb, type Db } from "@/lib/coderAuth";
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
  model_id: string;
  sandbox_id: string;
  sandbox_name: string;
  snapshot: string;
  state: string;
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
  const run = db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_computers (
      chat_key TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      sandbox_id TEXT NOT NULL UNIQUE,
      sandbox_name TEXT NOT NULL UNIQUE,
      snapshot TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'created',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).then(() => undefined);
  if (db === prismaDb) {
    tableReady = run.catch((error) => {
      tableReady = null;
      throw error;
    });
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
    "SELECT chat_key, model_id, sandbox_id, sandbox_name, snapshot, state, created_at, updated_at FROM cloud_computers WHERE chat_key = $1 LIMIT 1",
    chatKey,
  );
  return rows[0] || null;
}

async function saveRow(ctx: CloudComputerContext, row: Omit<ComputerRow, "created_at" | "updated_at">): Promise<void> {
  const db = dbOf(ctx);
  await ensureTable(db);
  await db.exec(
    `INSERT INTO cloud_computers (chat_key, model_id, sandbox_id, sandbox_name, snapshot, state, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (chat_key) DO UPDATE SET
       model_id = EXCLUDED.model_id,
       sandbox_id = EXCLUDED.sandbox_id,
       sandbox_name = EXCLUDED.sandbox_name,
       snapshot = EXCLUDED.snapshot,
       state = EXCLUDED.state,
       updated_at = now()`,
    row.chat_key, row.model_id, row.sandbox_id, row.sandbox_name, row.snapshot, row.state,
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

async function readSignedPreview(ctx: CloudComputerContext, sandbox: SandboxInfo): Promise<string> {
  const response = await providerRequest<Json>(
    ctx,
    `${apiBase()}/sandbox/${encodeURIComponent(sandbox.id)}/ports/${VNC_PORT}/signed-preview-url?expiresInSeconds=${PREVIEW_TTL_SECONDS}`,
  );
  const url = String(response?.url || response?.signedUrl || response?.signedPreviewUrl || "").trim();
  if (!/^https:\/\//i.test(url)) throw new Error("Daytona did not return a valid signed desktop preview link.");
  return url;
}

async function chargeCompute(ctx: CloudComputerContext, elapsedMs: number): Promise<void> {
  if (ctx.tier === "owner") return;
  const db = dbOf(ctx);
  const seconds = Math.max(0, Math.ceil(elapsedMs / 1000));
  if (seconds) await addUsage(ctx.chatId, "sandbox_minutes", seconds, db);
}

async function requireComputeAllowance(ctx: CloudComputerContext): Promise<void> {
  if (ctx.tier === "owner") return;
  const result = await checkLimit(ctx.chatId, "sandbox_minutes", 0, dbOf(ctx));
  if (!result.ok) throw new Error("انتهى رصيد وقت الحاسوب في خطتك الحالية. أوقف الحاسوب لحفظ ملفاته أو رقِّ خطتك.");
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
  await saveRow(ctx, { ...row, state: "stopped" });
  return { ok: true, state: "stopped", persistent: true };
}

export async function cloudComputerRefreshPreview(ctx: CloudComputerContext): Promise<Json> {
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
  const processName = () => safeProcessName(args.process || args.process_name);
  const id = () => safeRecordingId(args.id || args.recording_id);
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
    accessibility_focus: { path: "/computeruse/a11y/node/focus", method: "POST", body: { id: safeRecordingId(args.node_id) } },
    accessibility_invoke: { path: "/computeruse/a11y/node/invoke", method: "POST", body: { id: safeRecordingId(args.node_id), ...(args.node_action ? { action: String(args.node_action).slice(0, 80) } : {}) } },
    accessibility_set_value: { path: "/computeruse/a11y/node/value", method: "POST", body: { id: safeRecordingId(args.node_id), value: String(args.value || "").slice(0, 12000) } },
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
  if (options.region) return cloudComputerAction(ctx, options.compressed ? "screenshot_region_compressed" : "screenshot_region", options.region as unknown as Json);
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
  const passed = results.filter((r) => r.ok).length;
  return { ok: passed === results.length, passed, total: results.length, results };
}
