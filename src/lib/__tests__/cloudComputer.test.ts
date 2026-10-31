import {
  cloudComputerAction,
  cloudComputerExecute,
  cloudComputerIdentity,
  cloudComputerOpen,
  cloudComputerSelfTest,
  cloudComputerStatus,
  cloudComputerStop,
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
          model_id: args[1],
          sandbox_id: args[2],
          sandbox_name: args[3],
          snapshot: args[4],
          state: args[5],
        });
      }
    },
    query: async <T,>(sql: string, ...args: any[]): Promise<T[]> => {
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
  const calls: Array<{ url: string; method: string; body: any }> = [];
  let seq = 0;
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
        const sandbox = sandboxes.get(tail) || [...sandboxes.values()].find((item) => item.name === tail);
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
      if (path === "/computeruse/status") return Response.json({ status: "ready" });
      if (path === "/computeruse/start" && method === "POST") return Response.json({ status: "ready" });
      if (path === "/computeruse/screenshot") return Response.json({ screenshot: PNG_1PX, width: 1, height: 1 });
      if (path === "/computeruse/display/windows") return Response.json({ windows: [{ title: "Test browser" }] });
      if (path === "/process/execute" && method === "POST") {
        return Response.json({ exitCode: 0, result: "TTBIK_CLOUD_COMPUTER_OK\n" + body.command });
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
        return file ? new Response(file) : new Response("not found", { status: 404 });
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
  process.env.CLOUD_COMPUTER_OWNER_SNAPSHOT = "daytona-vm-large";
  process.env.CLOUD_COMPUTER_PLUS_SNAPSHOT = "daytona-vm-medium";
  process.env.CLOUD_COMPUTER_PRO_SNAPSHOT = "daytona-vm-large";
});

afterEach(() => {
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
    const id = String(opened.state);
    const path = "/home/daytona/test-persistent.txt";
    const { cloudComputerWriteFile, cloudComputerReadFile } = await import("@/lib/cloudComputer");
    await cloudComputerWriteFile(ctx, path, "persistent-across-restart");
    const first = [...provider.sandboxes.values()][0].id;
    await cloudComputerStop(ctx);
    const read = await cloudComputerReadFile(ctx, path);
    expect(read?.bytes.toString("utf8")).toBe("persistent-across-restart");
    expect([...provider.sandboxes.values()][0].id).toBe(first);
  });

  it("runs the owner full acceptance suite and reports every computer capability", async () => {
    const db = computerDb();
    const provider = providerFetch();
    const result = await cloudComputerSelfTest(ownerCtx(db, provider.fetchImpl));
    expect(result).toMatchObject({ ok: true, passed: result.total, total: 9 });
    expect(result.results.every((test) => test.ok)).toBe(true);
  });
});
