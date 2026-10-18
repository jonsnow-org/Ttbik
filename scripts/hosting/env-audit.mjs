// Lists the environment variables the site reads (src/**, prisma/schema.prisma, next.config.mjs) and compares them with a file of NAME=value lines
// (default deploy/oracle/.env.example). Names only: values are never read or printed.
// Usage: node scripts/hosting/env-audit.mjs [path/to/.env]      Prints variables the code reads that the file does not list.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const walk = (d, out = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (f === "node_modules" || f === ".next" || f === "__tests__" || f === "vendor") continue;
    statSync(p).isDirectory() ? walk(p, out) : /\.(ts|tsx|js|mjs)$/.test(f) && out.push(p);
  }
  return out;
};
const used = new Map();
for (const f of [...walk(join(root, "src")), join(root, "next.config.mjs")]) {
  if (!existsSync(f)) continue;
  for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) { if (!used.has(m[1])) used.set(m[1], new Set()); used.get(m[1]).add(f.replace(root, "")); }
}
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
for (const m of schema.matchAll(/env\("([A-Z_]+)"\)/g)) used.set(m[1], new Set(["prisma/schema.prisma"]));
// set by the platform, not by us
for (const k of ["NODE_ENV", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_GIT_COMMIT_SHA", "NEXT_RUNTIME", "NEXT_PHASE", "NEXT_OUTPUT", "PORT", "HOSTNAME", "CI"]) used.delete(k);
const file = process.argv[2] || join(root, "deploy/oracle/.env.example");
const have = new Set(readFileSync(file, "utf8").split("\n").map((l) => /^\s*#?\s*([A-Z][A-Z0-9_]+)=/.exec(l)?.[1]).filter(Boolean));
const missing = [...used.keys()].filter((k) => !have.has(k)).sort();
console.log(`${used.size} variables read by the code; ${missing.length} not listed in ${file.replace(root, "")}:`);
for (const k of missing) console.log("  " + k + "   (" + [...used.get(k)].slice(0, 2).join(", ") + ")");
