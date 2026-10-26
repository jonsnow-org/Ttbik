import { resolvePath, runSandboxTool, sandboxName, scrub, setSandboxDriver, type SbxDriver, type SbxHandle } from "@/lib/coderSandbox";
import { runTool } from "@/lib/coderAgent";

type Fake = { files: Map<string, Buffer>; runs: string[]; stopped: boolean; extended: number };
function fakeDriver(behave: (cmd: string) => { out: string; code: number; slow?: boolean } = () => ({ out: "ok", code: 0 })) {
  const vms = new Map<string, Fake>();
  const created: { name: string; o: any }[] = [];
  const pending = new Map<string, { vm: Fake; id: string; out: string; code: number }>();
  const handle = (vm: Fake): SbxHandle => ({
    async exec(cmd, args, o) {
      const script = args[args.length - 1] || "";
      vm.runs.push(`${cmd} ${args.join(" ")}`);
      if (o.detached) {
        const m = script.match(/\( ([\s\S]*) \) > \/tmp\/coder-cmd\/([a-f0-9]{8})\.out/);
        if (m) {
          const r = behave(m[1]);
          if (r.slow) pending.set(m[2], { vm, id: m[2], out: r.out, code: r.code });
          else {
            vm.files.set(`/tmp/coder-cmd/${m[2]}.out`, Buffer.from(r.out));
            vm.files.set(`/tmp/coder-cmd/${m[2]}.exit`, Buffer.from(`${r.code}\n`));
          }
          if (r.slow) vm.files.set(`/tmp/coder-cmd/${m[2]}.out`, Buffer.from("partial output"));
        }
        return { exitCode: null, stdout: "", stderr: "" };
      }
      if (cmd === "bash" && /tail -c/.test(script)) {
        const id = script.match(/coder-cmd\/([a-f0-9]{8})/)?.[1] || "";
        return { exitCode: 0, stdout: vm.files.get(`/tmp/coder-cmd/${id}.out`)?.toString() || "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async write(files) {
      for (const f of files) vm.files.set(f.path, f.content);
    },
    async read(path) {
      return vm.files.get(path) || null;
    },
    async extend(ms) {
      vm.extended += ms;
    },
    async stop() {
      vm.stopped = true;
    },
  });
  const d: SbxDriver = {
    async get(name) {
      const vm = vms.get(name);
      return vm && !vm.stopped ? handle(vm) : null;
    },
    async create(name, o) {
      created.push({ name, o });
      const vm: Fake = { files: new Map(), runs: [], stopped: false, extended: 0 };
      vms.set(name, vm);
      return handle(vm);
    },
  };
  const finish = (id: string) => {
    const p = pending.get(id)!;
    p.vm.files.set(`/tmp/coder-cmd/${id}.out`, Buffer.from(p.out));
    p.vm.files.set(`/tmp/coder-cmd/${id}.exit`, Buffer.from(`${p.code}\n`));
  };
  return { d, vms, created, finish, pending };
}

const ctx = { chatKey: "tgc:abc", runId: "run123", githubToken: "ghp_SECRETSECRETSECRETSECRET1234" };
beforeEach(() => {
  process.env.CODER_SANDBOX_WAIT_MS = "3000";
  delete process.env.CODER_SANDBOX;
});
afterEach(() => setSandboxDriver(null));

describe("sandbox", () => {
  it("one VM per user per task: names never collide across chats or runs", () => {
    expect(sandboxName("tgc:a", "r1")).not.toBe(sandboxName("tgc:b", "r1"));
    expect(sandboxName("tgc:a", "r1")).not.toBe(sandboxName("tgc:a", "r2"));
    expect(sandboxName("tgc:a", "r1")).toMatch(/^coder-[a-f0-9]{10}-r1$/);
  });
  it("creates the VM on first use, then reuses it (and extends its timeout)", async () => {
    const f = fakeDriver();
    setSandboxDriver(f.d);
    const a = await runSandboxTool("sandbox_exec", { command: "echo hi" }, ctx);
    expect(a).toMatch(/new sandbox/);
    expect(a).toMatch(/exit code 0\nok/);
    const b = await runSandboxTool("sandbox_exec", { command: "echo again" }, ctx);
    expect(b).not.toMatch(/new sandbox/);
    expect(f.created).toHaveLength(1);
    expect(f.created[0].o.vcpus).toBe(2);
    expect([...f.vms.values()][0].extended).toBeGreaterThan(0);
  });
  it("long commands return 'still running' with an id; sandbox_wait gets the result", async () => {
    const f = fakeDriver((cmd) => (/npm ci/.test(cmd) ? { out: "added 900 packages\nexit fine", code: 0, slow: true } : { out: "", code: 0 }));
    setSandboxDriver(f.d);
    const r = await runSandboxTool("sandbox_exec", { command: "cd app && npm ci" }, ctx);
    expect(r).toMatch(/still running \(command id ([a-f0-9]{8})\)/);
    expect(r).toMatch(/partial output/);
    const id = r!.match(/command id ([a-f0-9]{8})/)![1];
    f.finish(id);
    const w = await runSandboxTool("sandbox_wait", { id }, ctx);
    expect(w).toMatch(/exit code 0\nadded 900 packages/);
    expect(await runSandboxTool("sandbox_wait", { id: "../../etc" }, ctx)).toMatch(/bad command id/);
  }, 15000);
  it("clones with the user's token as a one-off header and never shows the token", async () => {
    const f = fakeDriver(() => ({ out: "abc123 init\nREADME.md  ghp_SECRETSECRETSECRETSECRET1234", code: 0 }));
    setSandboxDriver(f.d);
    const r = await runSandboxTool("sandbox_clone", { repo: "o/r", branch: "dev" }, ctx);
    expect(r).toMatch(/cloned into \/vercel\/sandbox\/r/);
    expect(r).not.toContain("ghp_SECRET");
    const run = [...f.vms.values()][0].runs.join("\n");
    expect(run).toMatch(/git -c http\.extraHeader=/);
    expect(run).toMatch(/--branch 'dev'/);
    expect(run).not.toMatch(/x-access-token:ghp_/);                  // not in a URL / remote config
    expect(await runSandboxTool("sandbox_clone", { repo: "not a repo" }, ctx)).toMatch(/owner\/name/);
  });
  it("pushes the VM's changes to a branch with the token as a one-off header (never in the output), refuses bad names and a missing token", async () => {
    const f = fakeDriver(() => ({ out: "commit abc fix\n cart.py | 2 +-\nPUSHED to o/r branch fix/cart ghp_SECRETSECRETSECRETSECRET1234", code: 0 }));
    setSandboxDriver(f.d);
    const r = await runSandboxTool("sandbox_push", { repo: "o/r", branch: "fix/cart", message: "fix the cart bugs" }, ctx);
    expect(r).toMatch(/PUSHED to o\/r branch fix\/cart/);
    expect(r).not.toContain("ghp_SECRET");
    const run = [...f.vms.values()][0].runs.join("\n");
    expect(run).toMatch(/git checkout -B 'fix\/cart'/);
    expect(run).toMatch(/git -c http\.extraHeader=.* push origin HEAD:refs\/heads\/fix\/cart/);
    expect(run).not.toMatch(/--force|push -f/);
    expect(run).not.toMatch(/x-access-token:ghp_/);
    expect(await runSandboxTool("sandbox_push", { repo: "o/r", branch: "--delete", message: "m" }, ctx)).toMatch(/plain branch name/);
    expect(await runSandboxTool("sandbox_push", { repo: "o/r", branch: "a..b", message: "m" }, ctx)).toMatch(/plain branch name/);
    expect(await runSandboxTool("sandbox_push", { repo: "o/r", branch: "fix/x", message: "m" }, { ...ctx, githubToken: undefined })).toMatch(/not connected/);
  });
  it("writes and reads files (relative paths resolve under the home folder; line windows)", async () => {
    const f = fakeDriver();
    setSandboxDriver(f.d);
    expect(await runSandboxTool("sandbox_write_file", { path: "app/src/a.ts", content: "l1\nl2\nl3\nl4" }, ctx)).toMatch(/wrote \/vercel\/sandbox\/app\/src\/a\.ts \(11 bytes\)/);
    const r = await runSandboxTool("sandbox_read_file", { path: "/vercel/sandbox/app/src/a.ts", start_line: 2, max_lines: 2 }, ctx);
    expect(r).toMatch(/4 lines; showing 2-3\)\nl2\nl3$/);
    expect(await runSandboxTool("sandbox_read_file", { path: "nope.txt" }, ctx)).toMatch(/not found/);
    expect(resolvePath("../../etc/passwd", "/vercel/sandbox/app")).toBe("/vercel/etc/passwd");   // inside the user's own VM: allowed, still normalised
  });
  it("edits a file by replacing one exact piece of text; refuses zero or several matches", async () => {
    const f = fakeDriver();
    setSandboxDriver(f.d);
    await runSandboxTool("sandbox_write_file", { path: "e.ts", content: "a = 1\nb = 2\nb = 2\n" }, ctx);
    expect(await runSandboxTool("sandbox_edit_file", { path: "e.ts", old: "a = 1", new: "a = 9" }, ctx)).toMatch(/edited .*e\.ts \(1 replacement\)/);
    expect(await runSandboxTool("sandbox_edit_file", { path: "e.ts", old: "b = 2", new: "b = 3" }, ctx)).toMatch(/occurs 2 times/);
    expect(await runSandboxTool("sandbox_edit_file", { path: "e.ts", old: "zzz", new: "y" }, ctx)).toMatch(/not found/);
    expect(await runSandboxTool("sandbox_edit_file", { path: "e.ts", old: "b = 2", new: "b = 3", replace_all: true }, ctx)).toMatch(/2 replacements/);
    expect(await runSandboxTool("sandbox_read_file", { path: "e.ts" }, ctx)).toMatch(/a = 9\nb = 3\nb = 3/);
    expect(await runSandboxTool("sandbox_search", {}, ctx)).toMatch(/give a pattern/);
  });
  it("refuses dark-web tooling", async () => {
    setSandboxDriver(fakeDriver().d);
    for (const c of ["sudo dnf install tor", "torsocks curl http://x.onion", "curl http://abc.onion/", "i2pd --daemon"]) expect(await runSandboxTool("sandbox_exec", { command: c }, ctx)).toMatch(/not allowed/);
    expect(await runSandboxTool("sandbox_exec", { command: "pytest tests/test_tornado.py" }, ctx)).toMatch(/exit code 0/);
  });
  it("explains a used-up free allowance or missing credentials instead of failing silently", async () => {
    process.env.CODER_LIGHT = "off";                                   // (with it on, the light runner takes over: coderFailover.test.ts)
    setSandboxDriver({ get: async () => null, create: async () => { throw new Error("Sandbox creation paused: usage limit exceeded"); } });
    expect(await runSandboxTool("sandbox_exec", { command: "ls" }, ctx)).toMatch(/free sandbox allowance/);
    setSandboxDriver({ get: async () => null, create: async () => { throw new Error("Missing OIDC token"); } });
    expect(await runSandboxTool("sandbox_exec", { command: "ls" }, ctx)).toMatch(/not available on this deployment/);
    process.env.CODER_SANDBOX = "off";
    expect(await runSandboxTool("sandbox_exec", { command: "ls" }, ctx)).toMatch(/switched off/);
    delete process.env.CODER_LIGHT;
  });
  it("scrubs tokens of any shape", () => {
    expect(scrub("a ghp_abcdefghijklmnopqrstuvwxyz b github_pat_11ABCDEFGHIJKLMNOPQRSTUV_x c https://x-access-token:zzz@github.com", ["mysecretvalue"])).toBe("a *** b *** c https://x-access-token:***@github.com");
  });
  it("is wired into the agent's runTool with the task's own key", async () => {
    const f = fakeDriver();
    setSandboxDriver(f.d);
    const out = await runTool({ id: "1", type: "function", function: { name: "sandbox_exec", arguments: JSON.stringify({ command: "node -v" }) } }, { gh: null, addNote: () => undefined, chatKey: "tgc:zz", runId: "conv1" });
    expect(out).toMatch(/exit code 0/);
    expect(f.created[0].name).toBe(sandboxName("tgc:zz", "conv1"));
  });
});
