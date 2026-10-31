import {
  cloudComputerAction,
  cloudComputerExecute,
  cloudComputerIdentity,
  cloudComputerOpen,
  cloudComputerOcrScreenshot,
  cloudComputerTerminalExecute,
  cloudComputerTerminalInput,
  cloudComputerTerminalOpen,
  cloudComputerTerminalPoll,
  cloudComputerSelfTest,
  cloudComputerStatus,
  cloudComputerStop,
  cloudComputerRuntimeTick,
} from "@/lib/cloudComputer";
import type { Db } from "@/lib/coderAuth";

type ComputerDb = Db & { ddl: true; computers: Map<string, any> };

function computerDb(): ComputerDb {
  const computers = new Map<string, any>();
  return {
    ddl: true,
    computers,
    exec: async (sql: string, ...args: any[]) => {
      if (sql.includes("INSERT INTO cloud_computers")) {
        computers.set(args[0], {
          chat_key: args[0],
          chat_id: args[1],
          model_id: args[2],
          sandbox_id: args[3],
          sandbox_name: args[4],
          snapshot: args[5],
          state: args[6],
          last_billed_at: args[6] === "started" ? new Date().toISOString() : null,
        });
      }
    },
    query: async <T,>(sql: string, ...args: any[]): Promise<T[]> => {
      if (sql.includes("WITH due AS")) {
        const now = new Date(args[0]).getTime();
        const checkpoint = Math.floor(now / 60000) * 60000;
        const due = [...computers.values()].filter((row) => row.state === "started" && row.last_billed_at && Date.parse(row.last_billed_at) < checkpoint - 60000).slice(0, Number(args[1]) || 20);
        return due.map((row) => {
          const elapsed_seconds = Math.max(1, Math.floor((checkpoint - Date.parse(row.last_billed_at)) / 1000));
          row.last_billed_at = new Date(checkpoint).toISOString();
          return { chat_key: row.chat_key, chat_id: row.chat_id, model_id: row.model_id, sandbox_id: row.sandbox_id, sandbox_name: row.sandbox_name, snapshot: row.snapshot, elapsed_seconds };
        }) as T[];
      }
      if (sql.includes("FROM cloud_computers")) {
        const row = computers.get(args[0]);
        return (row ? [row] : []) as T[];
      }
      return [];
    },
  } as ComputerDb;
}

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5QAAAABJRU5ErkJggg==";

function providerFetch() {
  const sandboxes = new Map<string, any>();
  const files = new Map<string, Buffer>();
  const processes = new Map<string, { id: string; state: string; cwd: string; logs: Array<{ data: string; cursor: string }> }>();
  const calls: Array<{ url: string; method: string; body: any }> = [];
  let seq = 0;
  let desktopReady = false;
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    const bodyText = typeof init.body === "string" ? init.body : "";
    const body = bodyText ? JSON.parse(bodyText) : {};
    calls.push({ url: url.toString(), method, body });

    if (url.origin === "https://daytona.test") {
      if (url.pathname === "/sandbox" && method === "POST") {
        const id = "sandbox-" + (++seq);
        const sandbox = {
          id,
          name: body.name,
          state: "started",
          snapshot: body.snapshot,
          toolboxProxyUrl: "https://toolbox.test",
        };
        sandboxes.set(id, sandbox);
        return Response.json(sandbox);
      }
      if (url.pathname.startsWith("/sandbox/")) {
        const tail = decodeURIComponent(url.pathname.slice("/sandbox/".length));
        const idOrName = tail.split("/")[0];
        const sandbox = sandboxes.get(idOrName) || [...sandboxes.values()].find((item) => item.name === idOrName);
        if (!sandbox) return new Response("not found", { status: 404 });
        if (url.pathname.endsWith("/stop") && method === "POST") {
          sandbox.state = "stopped";
          return Response.json({ state: "stopped" });
        }
        if (url.pathname.endsWith("/start") && method === "POST") {
          sandbox.state = "started";
          return Response.json({ state: "started" });
        }
        if (url.pathname.includes("/ports/6080/signed-preview-url")) {
          return Response.json({ url: "https://preview.daytona.test/signed?token=temporary" });
        }
        return Response.json(sandbox);
      }
    }

    if (url.origin === "https://toolbox.test") {
      const path = url.pathname.replace(/^\/sandbox-[^/]+/, "");
      if (path === "/processes" && method === "POST") {
        const id = String(body.name || "process-" + (++seq));
        if (processes.has(id)) return new Response("name conflict", { status: 409 });
        const process = { id, state: "running", cwd: String(body.cwd || "/home/daytona"), logs: [] as Array<{ data: string; cursor: string }> };
        processes.set(id, process);
        return Response.json(process, { status: 201 });
      }
      const processMatch = /^\/processes\/([^/]+)(?:\/(stdin|logs))?$/.exec(path);
      if (processMatch) {
        const id = decodeURIComponent(processMatch[1]);
        const process = processes.get(id);
        if (!process) return new Response("not found", { status: 404 });
        if (!processMatch[2] && method === "GET") return Response.json(process);
        if (!processMatch[2] && method === "DELETE") { process.state = "killed"; return Response.json({ ok: true }); }
        if (processMatch[2] === "stdin" && method === "POST") {
          const data = String(body.data || "");
          process.logs.push({ data: data === "\u0003" ? "^C\r\n" : data, cursor: String(process.logs.length + 1) });
          return Response.json({ ok: true });
        }
        if (processMatch[2] === "logs" && method === "GET") {
          const after = Number(url.searchParams.get("cursor") || 0);
          return Response.json({ items: process.logs.filter((item) => Number(item.cursor) > after) });
        }
      }
      if (path === "/computeruse/status") return Response.json({ status: desktopReady ? "ready" : "stopped" });
      if (path === "/computeruse/start" && method === "POST") { desktopReady = true; return Response.json({ status: "ready" }); }
      if (path.startsWith("/computeruse/screenshot")) return Response.json({ screenshot: PNG_1PX, width: 1, height: 1 });
      if (path === "/computeruse/display/windows") return Response.json({ windows: [{ title: "Test browser" }] });
      if (path === "/computeruse/recordings/start" && method === "POST") return Response.json({ id: "recording-1", name: body.name });
      if (path === "/computeruse/recordings/stop" && method === "POST") return Response.json({ id: body.id, status: "stopped" });
      if (path === "/computeruse/recordings") return Response.json({ recordings: [{ id: "recording-1", status: "stopped" }] });
      if (path === "/computeruse/recordings/recording-1" && method === "GET") return Response.json({ id: "recording-1", status: "stopped" });
      if (path === "/computeruse/recordings/recording-1" && method === "DELETE") return Response.json({ ok: true });
      if (path === "/computeruse/recordings/recording-1/download") return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
      if (path === "/computeruse/display/info") return Response.json({ displays: [{ width: 1280, height: 720 }], total_displays: 1 });
      if (path === "/computeruse/a11y/tree") return Response.json({ nodes: [{ id: "node-1", role: "button" }] });
      if (path === "/computeruse/a11y/find" && method === "POST") return Response.json({ nodes: [{ id: "node-1", role: "button" }] });
      if (path === "/process/execute" && method === "POST") {
        const result = String(body.command || "").includes("tesseract") ? "Visible screen text: TTBik browser dashboard" : "TTBIK_CLOUD_COMPUTER_OK\\n" + body.command;
        return Response.json({ exitCode: 0, result });
      }
      if (path === "/files/upload-v2" && method === "POST") {
        const form = init.body as FormData;
        const file = form.get("file") as Blob;
        const target = url.searchParams.get("path") || "";
        files.set(target, Buffer.from(await file.arrayBuffer()));
        return Response.json({ ok: true });
      }
      if (path === "/files/download" && method === "GET") {
        const target = url.searchParams.get("path") || "";
        const file = files.get(target);
        return file ? new Response(new Uint8Array(file)) : new Response("not found", { status: 404 });
      }
      if (path.startsWith("/computeruse/") && method === "POST") return Response.json({ ok: true, action: path });
    }
    return Response.json({ ok: true });
  }) as typeof fetch;

  return { fetchImpl, calls, sandboxes, files };
}

const OWNER = 777;
const ownerCtx = (db: ComputerDb, fetchImpl: typeof fetch, modelId = "coder") => ({
  chatId: OWNER,
  modelId,
  tier: "owner" as const,
  db,
  fetchImpl,
});

beforeEach(() => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_STATE_SALT = "cloud-computer-test-salt";
  process.env.DAYTONA_API_KEY = "daytona-test-secret";
  process.env.DAYTONA_API_URL = "https://daytona.test";
  process.env.DAYTONA_TOOLBOX_URL = "https://toolbox.test";
  process.env.DAYTONA_TOOLBOX_V2_URL = "https://toolbox.test";
  process.env.CLOUD_COMPUTER_OWNER_SNAPSHOT = "daytona-vm-large";
  process.env.CLOUD_COMPUTER_PLUS_SNAPSHOT = "daytona-vm-medium";
  process.env.CLOUD_COMPUTER_PRO_SNAPSHOT = "daytona-vm-large";
});

afterEach(() => {
  delete process.env.DAYTONA_TOOLBOX_V2_URL;
  delete process.env.CLOUD_COMPUTER_OWNER_SNAPSHOT;
  delete process.env.CLOUD_COMPUTER_PLUS_SNAPSHOT;
  delete process.env.CLOUD_COMPUTER_PRO_SNAPSHOT;
});

describe("cloud computer identity and isolation", () => {
  it("assigns a deterministic but distinct VM name to each user/model pair", () => {
    const a = cloudComputerIdentity(101, "coder");
    const b = cloudComputerIdentity(102, "coder");
    const c = cloudComputerIdentity(101, "sham_v2");
    const d = cloudComputerIdentity(101, "qwen35-9b");
    expect(a.sandboxName).toMatch(/^ttbik-pc-[a-f0-9]{28}$/);
    expect(a.sandboxName).toBe(cloudComputerIdentity(101, "coder").sandboxName);
    expect(new Set([a.sandboxName, b.sandboxName, c.sandboxName, d.sandboxName]).size).toBe(4);
    expect(a.chatKey).not.toBe(c.chatKey);
  });

  it("keeps each persisted machine record under its own opaque user/model key", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const one = ownerCtx(db, provider.fetchImpl, "coder");
    const two = { ...ownerCtx(db, provider.fetchImpl, "sham_v2"), chatId: 888 };
    await cloudComputerOpen(one);
    await cloudComputerOpen(two);
    expect(db.computers.size).toBe(2);
    expect([...db.computers.values()].map((x) => x.model_id).sort()).toEqual(["coder", "sham_v2"]);
    expect([...provider.sandboxes.keys()]).toHaveLength(2);
    expect([...new Set([...db.computers.keys()])]).toHaveLength(2);
  });
});

describe("cloud desktop lifecycle and controls", () => {
  it("provisions an always-on VM with a non-deleting persistent snapshot and signed desktop URL", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const opened = await cloudComputerOpen(ownerCtx(db, provider.fetchImpl));
    expect(opened).toMatchObject({ ok: true, state: "started", previewUrl: "https://preview.daytona.test/signed?token=temporary" });
    const creation = provider.calls.find((call) => call.url.endsWith("/sandbox") && call.method === "POST")!;
    expect(creation.body).toMatchObject({
      snapshot: "daytona-vm-large",
      autoStopInterval: 0,
      autoPauseInterval: 0,
      autoDeleteInterval: -1,
      ephemeral: false,
    });
    expect(provider.calls.some((call) => call.url.includes("/computeruse/start"))).toBe(true);
    expect((await cloudComputerStatus(ownerCtx(db, provider.fetchImpl))).state).toBe("started");
  });

  it("keeps one interactive PTY inside the selected model's same persistent VM", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const ctx = ownerCtx(db, provider.fetchImpl, "qwen35-9b");
    await cloudComputerOpen(ctx);
    const opened = await cloudComputerTerminalOpen(ctx);
    expect(opened).toMatchObject({ ok: true, state: "running", shell: "/bin/bash" });
    await cloudComputerTerminalExecute(ctx, "pwd");
    const polled = await cloudComputerTerminalPoll(ctx, opened.sessionId);
    expect(polled.output).toContain("pwd");
    expect(polled.complete).toBe(false);
    await cloudComputerTerminalInput(ctx, opened.sessionId, "\u0003");
    const other = await cloudComputerTerminalOpen({ ...ctx, modelId: "gemma4-e4b" });
    expect(other.sessionId).not.toBe(opened.sessionId);
    expect(db.computers.size).toBe(2);
  });

  it("performs OCR inside that same model's own isolated computer when native vision is unavailable", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const ctx = ownerCtx(db, provider.fetchImpl, "minicpmo45");
    const text = await cloudComputerOcrScreenshot(ctx, Buffer.from(PNG_1PX, "base64"), "image/png");
    expect(text).toContain("Visible screen text");
    expect(provider.calls.some((call) => call.url.includes("/files/upload-v2?path=%2Ftmp%2Fttbik-screen-ocr-"))).toBe(true);
    expect(provider.calls.some((call) => call.url.endsWith("/process/execute"))).toBe(true);
  });

  it("runs arbitrary shell commands without a command-name allowlist", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const ctx = ownerCtx(db, provider.fetchImpl);
    await cloudComputerOpen(ctx);
    const command = "sudo apt-get update && npm install -g playwright && node --version";
    const result = await cloudComputerExecute(ctx, command, "/home/daytona", 90000);
    expect(result.exitCode).toBe(0);
    expect(provider.calls.some((call) => call.url.endsWith("/process/execute") && call.body.command === command)).toBe(true);
  });

  it("supports desktop click, typing, key presses, hotkeys, scrolling, windows and screenshots", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const ctx = ownerCtx(db, provider.fetchImpl);
    await cloudComputerOpen(ctx);
    for (const [action, args] of [
      ["click", { x: 10, y: 20, button: "left" }],
      ["type", { text: "Hello" }],
      ["press", { key: "enter", modifiers: ["ctrl"] }],
      ["hotkey", { keys: "ctrl+l" }],
      ["scroll", { x: 40, y: 80, direction: "down", amount: 3 }],
      ["windows", {}],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await cloudComputerAction(ctx, action, args);
      expect(result).toBeTruthy();
    }
    const shot = await cloudComputerScreenshot(ctx);
    expect(shot?.bytes.length).toBeGreaterThan(0);
    expect(provider.calls.filter((call) => call.url.includes("/computeruse/")).length).toBeGreaterThanOrEqual(8);
  });

  it("preserves files across explicit stop and resume on the same VM id", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const ctx = ownerCtx(db, provider.fetchImpl);
    const opened = await cloudComputerOpen(ctx);
    const path = "/home/daytona/test-persistent.txt";
    const { cloudComputerWriteFile, cloudComputerReadFile } = await import("@/lib/cloudComputer");
    await cloudComputerWriteFile(ctx, path, "persistent-across-restart");
    const first = [...provider.sandboxes.values()][0].id;
    await cloudComputerStop(ctx);
    const read = await cloudComputerReadFile(ctx, path);
    expect(read?.bytes.toString("utf8")).toBe("persistent-across-restart");
    expect([...provider.sandboxes.values()][0].id).toBe(first);
  });

  it("covers full mouse, accessibility, display, process and recording controls", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const ctx = ownerCtx(db, provider.fetchImpl);
    await cloudComputerOpen(ctx);
    const actions: Array<[string, Record<string, unknown>]> = [
      ["move", { x: 80, y: 40 }],
      ["drag", { start_x: 20, start_y: 20, end_x: 60, end_y: 60, button: "left" }],
      ["mouse_position", {}],
      ["display_info", {}],
      ["accessibility_tree", { scope: "all", max_depth: 2 }],
      ["accessibility_find", { scope: "all", role: "button", limit: 5 }],
      ["accessibility_focus", { node_id: "node-1" }],
      ["accessibility_invoke", { node_id: "node-1", node_action: "click" }],
      ["accessibility_set_value", { node_id: "node-1", value: "example" }],
      ["process_status", { process: "desktop" }],
      ["process_restart", { process: "desktop" }],
      ["process_logs", { process: "desktop" }],
      ["process_errors", { process: "desktop" }],
    ];
    for (const [action, args] of actions) {
      const result = await cloudComputerAction(ctx, action, args);
      expect(result).toBeTruthy();
    }
    const recording = await cloudComputerAction(ctx, "recording_start", { name: "test-capture" });
    expect(recording.id).toBe("recording-1");
    await cloudComputerAction(ctx, "recording_stop", { id: "recording-1" });
    await cloudComputerAction(ctx, "recording_list");
    await cloudComputerAction(ctx, "recording_get", { id: "recording-1" });
    const downloaded = await cloudComputerAction(ctx, "recording_download", { id: "recording-1", path: "/home/daytona/recordings/test.mp4" });
    expect(downloaded).toMatchObject({ ok: true, path: "/home/daytona/recordings/test.mp4" });
    await cloudComputerAction(ctx, "recording_delete", { id: "recording-1" });
    expect((await import("@/lib/cloudComputer")).cloudComputerReadFile(ctx, "/home/daytona/recordings/test.mp4")).resolves.toBeTruthy();
  });

  it("bills persistent VM wall time from the one-minute runtime heartbeat", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const ctx = ownerCtx(db, provider.fetchImpl);
    await cloudComputerOpen(ctx);
    const later = new Date(Date.now() + 180000);
    const result = await cloudComputerRuntimeTick(db, later, 20);
    expect(result.errors).toEqual([]);
    expect(result.billedSeconds).toBeGreaterThanOrEqual(60);
    expect(result.stopped).toBe(0);
  });

  it("runs the owner full acceptance suite and reports every computer capability", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const result = await cloudComputerSelfTest(ownerCtx(db, provider.fetchImpl));
    expect(result).toMatchObject({ ok: true, passed: result.total, total: 15 });
    expect(result.results.every((test) => test.ok)).toBe(true);
  });
});
