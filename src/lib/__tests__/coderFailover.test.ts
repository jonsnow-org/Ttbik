import { runSandboxTool, sandboxHealth, setSandboxBackends, setSandboxDriver, backendOrder, type SbxDriver, type SbxHandle } from "@/lib/coderSandbox";
import { parseNodeCommand, runJs } from "@/lib/coderSandboxLight";
import { daytonaDriver, parseEnvelopes, setDriverFetch } from "@/lib/coderSandboxDrivers";
import { coderChat, coderJobResult, coderStudioUrls, splitJob } from "@/lib/openCoderStudio";

const ctx = { chatKey: "k1", runId: "run1" };
function okDriver(tag: string, log: string[]): SbxDriver {
  const files = new Map<string, Buffer>();
  const h: SbxHandle = {
    home: `/home/${tag}`,
    async exec(_c, args, o) {
      const m = (args[args.length - 1] || "").match(/\( ([\s\S]*) \) > \/tmp\/coder-cmd\/([a-f0-9]{8})\.out/);
      if (o.detached && m) {
        log.push(`${tag}:${m[1]}`);
        files.set(`/tmp/coder-cmd/${m[2]}.out`, Buffer.from(`${tag} ran`));
        files.set(`/tmp/coder-cmd/${m[2]}.exit`, Buffer.from("0"));
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async write(fs) {
      for (const f of fs) files.set(f.path, f.content);
    },
    async read(p) {
      return files.get(p) || null;
    },
    async extend() {},
    async stop() {},
  };
  let made = false;
  return { get: async () => (made ? h : null), create: async () => ((made = true), h) };
}
const failing = (msg: string): SbxDriver => ({ get: async () => null, create: async () => { throw new Error(msg); } });

afterEach(() => {
  setSandboxBackends(null);
  setSandboxDriver(null);
  setDriverFetch(null);
});

describe("sandbox failover chain", () => {
  it("auto order = configured VM backends; unknown ids ignored", () => {
    const save = { ...process.env };
    process.env.VERCEL = "1";
    process.env.DAYTONA_API_KEY = "d";
    delete process.env.E2B_API_KEY;
    expect(backendOrder("auto")).toEqual(["vercel", "daytona"]);
    process.env.E2B_API_KEY = "e";
    expect(backendOrder("auto")).toEqual(["vercel", "daytona", "e2b"]);
    expect(backendOrder("e2b,nope,vercel")).toEqual(["e2b", "vercel"]);
    process.env = save;
  });
  it("quota on the primary -> backup 1; then sticks to it for the task; health shows the cooling", async () => {
    const log: string[] = [];
    setSandboxBackends([
      { id: "vercel", driver: failing("Sandbox creation paused: usage limit exceeded") },
      { id: "daytona", driver: failing("fetch failed") },
      { id: "e2b", driver: okDriver("e2b", log) },
    ]);
    const a = await runSandboxTool("sandbox_exec", { command: "echo 1" }, ctx);
    expect(a).toMatch(/E2B Linux microVM/);
    expect(a).toMatch(/home \/home\/e2b/);
    expect(a).toMatch(/e2b ran/);
    const b = await runSandboxTool("sandbox_exec", { command: "echo 2" }, ctx);
    expect(b).not.toMatch(/new sandbox/);
    expect(log).toEqual(["e2b:echo 1", "e2b:echo 2"]);
    const h = sandboxHealth();
    expect(h.find((x) => x.id === "vercel")!.ok).toBe(false);
    expect(h.find((x) => x.id === "daytona")!.coolingUntil).not.toBeNull();
    expect(h.find((x) => x.id === "e2b")!.ok).toBe(true);
    expect(h[h.length - 1].id).toBe("light");
  });
  it("every VM out -> the light JavaScript runner keeps going (files, fs, errors, time limit)", async () => {
    setSandboxBackends([{ id: "vercel", driver: failing("402 quota") }]);
    const ctx2 = { chatKey: "k2", runId: "run2" };
    expect(await runSandboxTool("sandbox_write_file", { path: "lib.js", content: "const sq = (x) => x * x; console.log([1,2,3].map(sq).join(','));" }, ctx2)).toMatch(/wrote \/vercel\/sandbox\/lib\.js/);
    expect(await runSandboxTool("sandbox_exec", { command: "node lib.js" }, ctx2)).toMatch(/exit code 0[\s\S]*1,4,9/);
    expect(await runSandboxTool("sandbox_exec", { command: `node -e 'require("fs").writeFileSync("out.txt", "hi"); console.log(require("fs").readFileSync("out.txt"))'` }, ctx2)).toMatch(/hi/);
    expect(await runSandboxTool("sandbox_read_file", { path: "/vercel/sandbox/lib.js" }, ctx2)).toMatch(/const sq/);
    expect(await runSandboxTool("sandbox_exec", { command: "npm test" }, ctx2)).toMatch(/only `node -e/);
    expect(await runSandboxTool("sandbox_exec", { command: `node -e "throw new Error('boom')"` }, ctx2)).toMatch(/exit code 1[\s\S]*boom/);
    process.env.CODER_LIGHT_TIMEOUT_MS = "500";
    expect(await runSandboxTool("sandbox_exec", { command: "node -e 'while(true){}'" }, ctx2)).toMatch(/timed out/);
    delete process.env.CODER_LIGHT_TIMEOUT_MS;
    expect(await runSandboxTool("sandbox_exec", { command: "node -e 'require(\"child_process\")'" }, ctx2)).toMatch(/not available in the light runtime/);
  });
  it("parses node commands", () => {
    expect(parseNodeCommand(`node -e 'console.log('\\''x'\\'')'`)).toEqual({ code: "console.log('x')" });
    expect(parseNodeCommand(`node -e "console.log(\\"y\\")"`)).toEqual({ code: 'console.log("y")' });
    expect(parseNodeCommand("node src/a.mjs --flag")).toEqual({ file: "src/a.mjs" });
    expect(parseNodeCommand("ls -la")).toBeNull();
  });
  it("light runtime has no host access", async () => {
    const r = await runJs("console.log(typeof fetch, typeof globalThis.process.env.HOME)", new Map());
    expect(r.out).toBe("undefined undefined");
  });
});

describe("daytona / e2b drivers (HTTP shape, fake fetch)", () => {
  it("daytona: create waits for started, exec + files go through the toolbox proxy", async () => {
    process.env.DAYTONA_API_KEY = "dk";
    const calls: string[] = [];
    let state = "creating";
    setDriverFetch((async (u: any, init?: any) => {
      const url = String(u);
      calls.push(`${init?.method || "GET"} ${url}`);
      expect(init?.headers?.Authorization).toBe("Bearer dk");
      if (url.endsWith("/api/sandbox") && init?.method === "POST") return Response.json({ id: "sb1", state, toolboxProxyUrl: "https://proxy.x/toolbox" });
      if (url.endsWith("/api/sandbox/sb1")) return Response.json({ id: "sb1", state: (state = "started"), toolboxProxyUrl: "https://proxy.x/toolbox" });
      if (url.includes("/process/execute")) return Response.json({ exitCode: 0, result: JSON.parse(init.body).command });
      if (url.includes("/files/download")) return new Response("content", { status: 200 });
      return new Response("", { status: 404 });
    }) as typeof fetch);
    const d = daytonaDriver();
    const h = await d.create("coder-x", { timeoutMs: 600000, vcpus: 2, tags: {} });
    const r = await h.exec("echo", ["a b"], { timeoutMs: 1000 });
    expect(r.stdout).toBe(`bash -c 'echo '\\''a b'\\'''`);
    expect((await h.read("/x"))!.toString()).toBe("content");
    expect(calls.some((c) => c.startsWith("POST https://proxy.x/toolbox/sb1/process/execute"))).toBe(true);
    delete process.env.DAYTONA_API_KEY;
  });
  it("e2b: Connect envelopes decode", () => {
    const enc = (o: unknown) => {
      const b = Buffer.from(JSON.stringify(o));
      const h = Buffer.alloc(5);
      h.writeUInt32BE(b.length, 1);
      return Buffer.concat([h, b]);
    };
    const buf = Buffer.concat([enc({ event: { data: { stdout: Buffer.from("hi").toString("base64") } } }), enc({ event: { end: { exitCode: 3 } } })]);
    expect(parseEnvelopes(new Uint8Array(buf))).toEqual([{ event: { data: { stdout: "aGk=" } } }, { event: { end: { exitCode: 3 } } }]);
  });
});

describe("model Studio failover", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.OPEN_CODER_STUDIO_URL;
    delete process.env.OPEN_CODER_STUDIO_URLS;
  });
  it("a new completion fails over to a replica; its job id is tagged and polled on the same replica", async () => {
    process.env.OPEN_CODER_STUDIO_URL = "https://a.example";
    process.env.OPEN_CODER_STUDIO_URLS = "https://b.example, https://a.example";
    expect(coderStudioUrls()).toEqual(["https://a.example", "https://b.example"]);
    const hits: string[] = [];
    global.fetch = (async (u: any) => {
      const url = String(u);
      hits.push(url);
      if (url.startsWith("https://a.example")) throw new TypeError("fetch failed");
      if (url.includes("/call/v2/")) return Response.json({ event_id: "e1" });
      return new Response(`data: ${JSON.stringify([JSON.stringify({ type: "pending", job: "j9" })])}\n`);
    }) as typeof fetch;
    const o = await coderChat([{ role: "user", content: "hi" }], { waitS: 1 });
    expect(o.reply?.job).toBe("s1~j9");
    expect(splitJob("s1~j9")).toEqual({ idx: 1, id: "j9" });
    hits.length = 0;
    const p = await coderJobResult("s1~j9");
    expect(hits.every((h) => h.startsWith("https://b.example"))).toBe(true);
    expect(p.reply?.job).toBe("s1~j9");
  });
  it("one Studio only: unchanged ids, off without a URL", async () => {
    expect((await coderChat([{ role: "user", content: "x" }])).failure).toBe("off");
    expect(splitJob("plain")).toEqual({ idx: 0, id: "plain" });
  });
});
