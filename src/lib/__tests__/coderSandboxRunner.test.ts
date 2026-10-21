import { backendOrder, runSandboxTool, setSandboxBackends, type SbxDriver } from "@/lib/coderSandbox";
import { codesandboxDriver, codespacesDriver, oracleDriver, setRunnerFetch } from "@/lib/coderSandboxRunner";

type Call = { method: string; url: string; headers: Record<string, string>; body: any };
const KEYS = ["CODER_SANDBOX_ORACLE_URL", "CODER_SANDBOX_ORACLE_SECRET", "CSB_API_KEY", "CODER_CSB_TEMPLATE", "CODER_CSB_RUNNER_SECRET",
  "CODER_CODESPACES_TOKEN", "CODER_CODESPACES_REPO", "CODER_CODESPACES_RUNNER_SECRET", "VERCEL", "DAYTONA_API_KEY", "E2B_API_KEY", "VERCEL_OIDC_TOKEN", "VERCEL_TOKEN"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setRunnerFetch(null);
  setSandboxBackends(null);
});

/** An in-memory runner (the coder-sandbox/runner.mjs protocol) plus the CodeSandbox / GitHub REST calls the drivers make. */
function fakeWorld(opt: { accepting?: boolean } = {}) {
  const calls: Call[] = [];
  const boxes = new Map<string, Map<string, Buffer>>();
  const csbVms = new Set<string>();
  const codespaces: { name: string; state: string; display_name: string }[] = [];
  const res = (status: number, body: unknown) => new Response(typeof body === "string" || body instanceof Uint8Array ? (body as any) : JSON.stringify(body), { status });
  const fetchFake = (async (input: any, init: any = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    const method = init.method || "GET";
    calls.push({ method, url, headers, body });
    const u = new URL(url);
    // CodeSandbox control plane
    if (u.host === "api.codesandbox.io") {
      if (headers.authorization !== "Bearer csb-key") return res(401, "no");
      if (/\/sandbox\/tmpl1\/fork$/.test(u.pathname)) { csbVms.add("vm9"); return res(201, { data: { id: "vm9" } }); }
      if (u.pathname === "/sandbox") return res(200, { data: { sandboxes: [...csbVms].map((id) => ({ id })) } });
      if (/\/vm\/vm9\/shutdown$/.test(u.pathname)) { csbVms.delete("vm9"); return res(200, { success: true }); }
      return res(404, "?");
    }
    // GitHub Codespaces
    if (u.host === "api.github.com") {
      if (headers.authorization !== "Bearer gh-pat") return res(401, "no");
      if (u.pathname === "/repos/me/box") return res(200, { id: 42 });
      if (u.pathname === "/user/codespaces" && method === "POST") { const cs = { name: "me-fluffy-x1", state: "Starting", display_name: body.display_name }; codespaces.push(cs); return res(201, cs); }
      if (u.pathname === "/user/codespaces") return res(200, { codespaces });
      if (u.pathname === "/user/codespaces/me-fluffy-x1" && method === "GET") { codespaces[0].state = "Available"; return res(200, codespaces[0]); }
      if (u.pathname === "/user/codespaces/me-fluffy-x1" && method === "DELETE") { codespaces.splice(0, 1); return res(202, {}); }
      return res(404, "?");
    }
    // runner (oracle / csb preview host / codespaces port host)
    const key = headers["x-runner-key"];
    if (!["oracle-secret", "csb-runner", "cs-runner"].includes(key || "")) return res(401, { error: "unauthorized" });
    if (u.pathname === "/health") return res(200, { ok: true, accepting: opt.accepting !== false });
    const m = /^\/v1\/boxes(?:\/([^/]+))?(\/exec|\/files|\/extend)?$/.exec(u.pathname);
    if (!m) return res(404, {});
    if (!m[1] && method === "POST") {
      if (opt.accepting === false) return res(503, { error: "not accepting new boxes: sham-busy" });
      boxes.set(body.name, new Map());
      return res(201, { name: body.name, home: "/work" });
    }
    const box = boxes.get(decodeURIComponent(m[1]));
    if (!box) return res(404, { error: "no such box" });
    if (!m[2] && method === "GET") return res(200, { name: m[1], home: "/work" });
    if (!m[2] && method === "DELETE") { boxes.delete(decodeURIComponent(m[1])); return res(200, { ok: true }); }
    if (m[2] === "/exec") {
      const script = String(body.args?.[body.args.length - 1] || "");
      const mm = script.match(/\( ([\s\S]*) \) > \/tmp\/coder-cmd\/([a-f0-9]{8})\.out/);
      if (body.detached && mm) {
        box.set(`/tmp/coder-cmd/${mm[2]}.out`, Buffer.from(`ran: ${mm[1]}`));
        box.set(`/tmp/coder-cmd/${mm[2]}.exit`, Buffer.from("0\n"));
      }
      return res(200, { exitCode: body.detached ? null : 0, stdout: "", stderr: "" });
    }
    if (m[2] === "/files" && method === "PUT") { box.set(body.path, Buffer.from(body.contentB64, "base64")); return res(200, { ok: true }); }
    if (m[2] === "/files") { const b = box.get(u.searchParams.get("path") || ""); return b ? res(200, new Uint8Array(b)) : res(404, {}); }
    if (m[2] === "/extend") return res(200, { ok: true });
    return res(405, {});
  }) as typeof fetch;
  setRunnerFetch(fetchFake, async () => {});
  return { calls, boxes, csbVms, codespaces };
}

const ctx = { chatKey: "chat-1", runId: "run-1" };

describe("runner backends (oracle / codesandbox / codespaces)", () => {
  it("chain order: oracle first, then vercel, codesandbox, codespaces, daytona, e2b — only configured ones", () => {
    expect(backendOrder("auto")).toEqual(["vercel"]); // nothing configured -> the old default
    process.env.VERCEL = "1";
    process.env.CODER_SANDBOX_ORACLE_URL = "https://o.example";
    process.env.CODER_SANDBOX_ORACLE_SECRET = "oracle-secret";
    process.env.DAYTONA_API_KEY = "d";
    expect(backendOrder("auto")).toEqual(["oracle", "vercel", "daytona"]);
    process.env.CSB_API_KEY = "csb-key";
    process.env.CODER_CSB_TEMPLATE = "tmpl1";
    process.env.CODER_CSB_RUNNER_SECRET = "csb-runner";
    process.env.CODER_CODESPACES_TOKEN = "gh-pat";
    process.env.CODER_CODESPACES_REPO = "me/box";
    process.env.CODER_CODESPACES_RUNNER_SECRET = "cs-runner";
    process.env.E2B_API_KEY = "e";
    expect(backendOrder("auto")).toEqual(["oracle", "vercel", "codesandbox", "codespaces", "daytona", "e2b"]);
    // a half-configured backend stays off
    delete process.env.CODER_SANDBOX_ORACLE_SECRET;
    expect(backendOrder("auto")[0]).toBe("vercel");
  });

  it("oracle: runs a command, writes and reads a file, reuses the box, stops it", async () => {
    process.env.CODER_SANDBOX_ORACLE_URL = "https://o.example/";
    process.env.CODER_SANDBOX_ORACLE_SECRET = "oracle-secret";
    const w = fakeWorld();
    setSandboxBackends([{ id: "oracle", driver: oracleDriver() }]);
    const a = await runSandboxTool("sandbox_exec", { command: "echo hi" }, ctx);
    expect(a).toMatch(/capped Linux container/);
    expect(a).toMatch(/exit code 0\nran: echo hi/);
    expect(await runSandboxTool("sandbox_write_file", { path: "a/b.txt", content: "salam" }, ctx)).toMatch(/wrote \/work\/a\/b.txt \(5 bytes\)/);
    expect(await runSandboxTool("sandbox_read_file", { path: "/work/a/b.txt" }, ctx)).toMatch(/salam/);
    expect(w.boxes.size).toBe(1);
    expect(w.calls.filter((c) => c.method === "POST" && /\/v1\/boxes$/.test(c.url))).toHaveLength(1); // created once, then reused
    expect(w.calls.every((c) => c.headers["x-runner-key"] === "oracle-secret")).toBe(true);
    const sb = await oracleDriver().get([...w.boxes.keys()][0]);
    await sb!.stop();
    expect(w.boxes.size).toBe(0);
  });

  it("oracle refuses (Sham busy) -> the chain moves to the next backend", async () => {
    process.env.CODER_SANDBOX_ORACLE_URL = "https://o.example";
    process.env.CODER_SANDBOX_ORACLE_SECRET = "oracle-secret";
    fakeWorld({ accepting: false });
    let used = false;
    const next: SbxDriver = {
      get: async () => null,
      create: async () => {
        used = true;
        throw new Error("next backend reached");
      },
    };
    setSandboxBackends([{ id: "oracle", driver: oracleDriver() }, { id: "vercel", driver: next }]);
    await runSandboxTool("sandbox_exec", { command: "echo hi" }, ctx);
    expect(used).toBe(true);
  });

  it("codesandbox: forks the template (Nano, no auto wake-up), waits for the runner, shuts the VM down on stop", async () => {
    process.env.CSB_API_KEY = "csb-key";
    process.env.CODER_CSB_TEMPLATE = "tmpl1";
    process.env.CODER_CSB_RUNNER_SECRET = "csb-runner";
    const w = fakeWorld();
    const sb = await codesandboxDriver().create("coder-abc-run1", { timeoutMs: 30 * 60000, vcpus: 2, tags: {} });
    const fork = w.calls.find((c) => /\/fork$/.test(c.url))!;
    expect(fork.body.start_options.tier).toBe("Nano");
    expect(fork.body.start_options.automatic_wakeup_config).toEqual({ http: false, websocket: false });
    expect(fork.body.tags).toEqual(["cx-coder-abc-run1"]);
    expect(w.calls.some((c) => c.url === "https://vm9-8790.csb.app/health")).toBe(true);
    expect((await sb.exec("bash", ["-c", "true"], { timeoutMs: 5000 })).exitCode).toBe(0);
    expect(await codesandboxDriver().get("coder-abc-run1")).not.toBeNull();
    await sb.stop();
    expect(w.csbVms.size).toBe(0);
  });

  it("codespaces: creates on the owner's repo, waits until Available, uses the forwarded port, deletes on stop", async () => {
    process.env.CODER_CODESPACES_TOKEN = "gh-pat";
    process.env.CODER_CODESPACES_REPO = "me/box";
    process.env.CODER_CODESPACES_RUNNER_SECRET = "cs-runner";
    const w = fakeWorld();
    const sb = await codespacesDriver().create("coder-abc-run2", { timeoutMs: 30 * 60000, vcpus: 2, tags: {} });
    const create = w.calls.find((c) => c.method === "POST" && /\/user\/codespaces$/.test(c.url))!;
    expect(create.body).toMatchObject({ repository_id: 42, machine: "basicLinux32gb", display_name: "coder-abc-run2", idle_timeout_minutes: 30 });
    const runnerCall = w.calls.find((c) => c.url.startsWith("https://me-fluffy-x1-8790.app.github.dev/"))!;
    expect(runnerCall.headers["x-github-token"]).toBe("gh-pat");
    expect(await codespacesDriver().get("coder-abc-run2")).not.toBeNull();
    await sb.stop();
    expect(w.codespaces).toHaveLength(0);
  });

  it("unconfigured backends never call out", async () => {
    const w = fakeWorld();
    expect(await oracleDriver().get("x")).toBeNull();
    expect(await codesandboxDriver().get("x")).toBeNull();
    expect(await codespacesDriver().get("x")).toBeNull();
    await expect(oracleDriver().create("x", { timeoutMs: 1000, vcpus: 1, tags: {} })).rejects.toThrow(/not configured/);
    expect(w.calls).toHaveLength(0);
  });
});
