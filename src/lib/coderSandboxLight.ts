// The last-resort sandbox backend: a JavaScript engine compiled to WebAssembly (QuickJS), run in-process with hard memory / time caps.
// Always available, zero cost, no account, no quota. It is NOT a computer: no shell, no network, no npm, no Python — just `node -e "<js>"`
// or `node <file.js>` over a small per-task file store (sandbox_write_file / sandbox_read_file). Used only when every Linux VM
// backend is unavailable, so the agent can still compute / test a pure function instead of stopping.
import type { Db } from "@/lib/coderAuth";

const MAX_FILE = 200_000;
const MAX_FILES = 60;
const timeoutMs = () => Math.max(500, Math.min(15000, Number(process.env.CODER_LIGHT_TIMEOUT_MS || 5000)));
const memMb = () => Math.max(16, Math.min(256, Number(process.env.CODER_LIGHT_MEMORY_MB || 64)));

// ---------------------------------------------------------------- per-task file store (DB when reachable, else this instance's memory)
const mem = new Map<string, Map<string, string>>();
let ready: Promise<void> | null = null;
async function table(db: Db): Promise<void> {
  if (!ready)
    ready = db
      .exec(`CREATE TABLE IF NOT EXISTS coder_light_files (box TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (box, path))`)
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
  return ready;
}
async function loadAll(box: string, db?: Db): Promise<Map<string, string>> {
  if (db) {
    try {
      await table(db);
      const rows = await db.query<{ path: string; content: string }>(`SELECT path, content FROM coder_light_files WHERE box = $1`, box);
      return new Map(rows.map((r) => [r.path, r.content]));
    } catch {
      /* fall back to memory */
    }
  }
  return new Map(mem.get(box) || []);
}
async function saveFile(box: string, path: string, content: string, db?: Db): Promise<void> {
  const m = mem.get(box) || new Map<string, string>();
  m.set(path, content);
  mem.set(box, m);
  if (db) {
    try {
      await table(db);
      await db.exec(
        `INSERT INTO coder_light_files (box, path, content) VALUES ($1, $2, $3) ON CONFLICT (box, path) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
        box,
        path,
        content,
      );
    } catch {
      /* memory copy stays */
    }
  }
}
export async function clearLight(box: string, db?: Db): Promise<void> {
  mem.delete(box);
  if (db) await db.exec(`DELETE FROM coder_light_files WHERE box = $1 OR updated_at < now() - interval '2 days'`, box).catch(() => null);
}

// ---------------------------------------------------------------- the engine
/** Parses `node -e '<js>'`, `node -e "<js>"`, `node --eval ...`, `node file.js [args]`. Returns null for anything else. */
export function parseNodeCommand(command: string): { code?: string; file?: string } | null {
  const c = command.trim();
  const e = /^node\s+(?:-e|--eval|-p|--print)\s+([\s\S]+)$/.exec(c);
  if (e) {
    const raw = e[1].trim();
    const q = raw[0];
    if ((q === "'" || q === '"') && raw.endsWith(q) && raw.length >= 2) {
      const body = raw.slice(1, -1);
      return { code: q === "'" ? body.replace(/'\\''/g, "'") : body.replace(/\\(["\\$`])/g, "$1") };
    }
    return { code: raw };
  }
  const fm = /^node\s+([\w./-]+\.(?:js|mjs|cjs))(?:\s.*)?$/.exec(c);
  return fm ? { file: fm[1] } : null;
}

let qjs: Promise<any> | null = null;
async function engine(): Promise<any> {
  if (!qjs)
    qjs = (async () => {
      const core: any = await import("quickjs-emscripten-core");
      const variant: any = await import("@jitl/quickjs-singlefile-cjs-release-sync");
      return core.newQuickJSWASMModuleFromVariant(variant.default || variant);
    })().catch((e) => {
      qjs = null;
      throw e;
    });
  return qjs;
}

/** Runs JS in a fresh QuickJS context. `files` is readable/writable through a tiny `require('fs')`; changed files are returned. */
export async function runJs(code: string, files: Map<string, string>): Promise<{ out: string; error?: string; written: Map<string, string> }> {
  const Q = await engine();
  const rt = Q.newRuntime();
  rt.setMemoryLimit(memMb() * 1024 * 1024);
  rt.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + timeoutMs();
  rt.setInterruptHandler(() => Date.now() > deadline);
  const vm = rt.newContext();
  const lines: string[] = [];
  const written = new Map<string, string>();
  let size = 0;
  const push = (s: string) => {
    if (size > 60000) return;
    size += s.length;
    lines.push(s);
  };
  try {
    const fmt = (args: any[]) => args.map((h) => { const v = vm.dump(h); return typeof v === "string" ? v : JSON.stringify(v); }).join(" ");
    const con = vm.newObject();
    for (const k of ["log", "info", "warn", "error", "debug"]) {
      const fn = vm.newFunction(k, (...a: any[]) => push(fmt(a)));
      vm.setProp(con, k, fn);
      fn.dispose();
    }
    vm.setProp(vm.global, "console", con);
    con.dispose();
    const host = vm.newObject();
    const read = vm.newFunction("read", (p: any) => {
      const k = String(vm.dump(p));
      const v = written.get(k) ?? files.get(k);
      return v == null ? vm.null : vm.newString(v);
    });
    const write = vm.newFunction("write", (p: any, c: any) => {
      const k = String(vm.dump(p));
      const v = String(vm.dump(c));
      if (v.length > MAX_FILE || written.size + files.size > MAX_FILES) throw new Error("light file store limit");
      written.set(k, v);
    });
    vm.setProp(host, "read", read);
    vm.setProp(host, "write", write);
    vm.setProp(vm.global, "__host", host);
    read.dispose();
    write.dispose();
    host.dispose();
    const prelude = `const __fs={readFileSync:(p)=>{const v=__host.read(String(p));if(v===null)throw new Error("ENOENT: "+p);return v},writeFileSync:(p,c)=>__host.write(String(p),String(c)),existsSync:(p)=>__host.read(String(p))!==null};
globalThis.require=(m)=>{if(m==="fs"||m==="node:fs")return __fs;throw new Error("module '"+m+"' is not available in the light runtime (no npm)")};
globalThis.process={argv:["node"],env:{},exit:()=>{throw new Error("process.exit")}};\n`;
    const r = vm.evalCode(prelude + code, "main.js");
    let error: string | undefined;
    if (r.error) {
      const d = vm.dump(r.error);
      error = typeof d === "object" && d ? `${d.name || "Error"}: ${d.message || ""}${d.stack ? `\n${d.stack}` : ""}` : String(d);
      if (/interrupted/.test(error)) error = `timed out after ${timeoutMs()} ms`;
      r.error.dispose();
    } else r.value.dispose();
    rt.executePendingJobs?.();
    return { out: lines.join("\n"), error, written };
  } finally {
    vm.dispose();
    rt.dispose();
  }
}

const norm = (p: string, home: string) => {
  const abs = p.startsWith("/") ? p : `${home}/${p}`;
  const out: string[] = [];
  for (const s of abs.split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return "/" + out.join("/");
};

/** The sandbox tools on the light backend. `why` says why the VMs are unavailable (shown once per call so the model adapts). */
export async function runLightTool(tool: string, a: any, box: string, home: string, why: string, db?: Db): Promise<string> {
  const head = `[light runtime: JavaScript only (QuickJS/WebAssembly; no shell, npm, network or Python) — Linux VMs unavailable now: ${why}]\n`;
  const files = await loadAll(box, db);
  switch (tool) {
    case "sandbox_write_file": {
      const path = norm(String(a.path || ""), String(a.cwd || home));
      const content = String(a.content ?? "");
      if (content.length > MAX_FILE) return `${head}error: file too large for the light runtime (200 KB max)`;
      if (!files.has(path) && files.size >= MAX_FILES) return `${head}error: too many files for the light runtime`;
      await saveFile(box, path, content, db);
      return `${head}wrote ${path} (${Buffer.byteLength(content)} bytes)`;
    }
    case "sandbox_read_file": {
      const path = norm(String(a.path || ""), String(a.cwd || home));
      const v = files.get(path);
      return v == null ? `${head}error: ${path} not found (light store has: ${[...files.keys()].slice(0, 20).join(", ") || "nothing"})` : `${head}${path}\n${v.slice(0, 20000)}`;
    }
    case "sandbox_exec": {
      const cmd = parseNodeCommand(String(a.command || ""));
      if (!cmd) return `${head}error: only \`node -e "<js>"\` or \`node <file.js>\` can run here. Shell, git, npm and python are unavailable until a VM backend is back; continue without running, or run plain JavaScript.`;
      let code = cmd.code;
      if (cmd.file) {
        code = files.get(norm(cmd.file, String(a.cwd || home)));
        if (code == null) return `${head}error: ${cmd.file} not found — write it with sandbox_write_file first`;
      }
      const t0 = Date.now();
      const r = await runJs(code || "", files);
      for (const [p, c] of r.written) await saveFile(box, p, c, db);
      return `${head}exit code ${r.error ? 1 : 0} (${Date.now() - t0} ms)\n${r.out || ""}${r.error ? `\n${r.error}` : ""}`.trimEnd() || `${head}(no output)`;
    }
    default:
      return `${head}error: ${tool} needs a Linux VM, which is unavailable right now.`;
  }
}
