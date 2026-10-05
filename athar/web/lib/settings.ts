// Settings the owner can change from the management panel without touching the server. Today: the free Toncenter API key, which makes
// reading the chain about nine times faster. It is kept in a file inside the server's data folder (never in the code, the repository
// or the logs) and is only ever shown as its last four characters. A key set on the server itself (TONCENTER_API_KEY) wins over it.
import fs from "fs";
import path from "path";

const dir = () => path.join(process.env.ATHAR_DATA_DIR || path.join(process.cwd(), "data"), "secrets");
const file = () => path.join(dir(), "toncenter.key");
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

let memo: { at: number; v: string } | null = null;

/** The Toncenter key in use ("" when there is none). Cheap: the file is looked at at most every few seconds. */
export function toncenterKey(): string {
  const fromEnv = (process.env.TONCENTER_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  if (memo && Date.now() - memo.at < 5000) return memo.v;
  let v = "";
  try { v = fs.readFileSync(file(), "utf8").trim(); } catch { /* none saved */ }
  memo = { at: Date.now(), v };
  return v;
}

export const validKey = (k: string) => KEY_SHAPE.test(k.trim());

export function saveToncenterKey(k: string): void {
  const key = k.trim();
  if (!validKey(key)) throw new Error("bad key");
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file(), key, { mode: 0o600 });
  memo = null;
}

export function clearToncenterKey(): void {
  try { fs.unlinkSync(file()); } catch { /* nothing to remove */ }
  memo = null;
}

/** What the panel may show: where the key comes from and its last four characters, never the key. */
export function keyStatus(): { source: "server" | "panel" | "none"; hint: string } {
  const fromEnv = (process.env.TONCENTER_API_KEY || "").trim();
  const k = fromEnv || toncenterKey();
  return { source: fromEnv ? "server" : k ? "panel" : "none", hint: k ? k.slice(-4) : "" };
}

/** Asks Toncenter once whether the key is accepted (a wrong key is refused with 401/403). Network trouble is not held against the key. */
export async function keyAccepted(k: string): Promise<boolean> {
  try {
    const r = await fetch("https://toncenter.com/api/v3/masterchainInfo", { headers: { "X-API-Key": k.trim() }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    return r.status !== 401 && r.status !== 403;
  } catch { return true; }
}
