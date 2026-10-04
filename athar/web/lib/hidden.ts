// Legal takedown list. A picture on Arweave cannot be erased, but WHAT OUR APP AND OUR TOKEN METADATA SHOW is ours to decide.
// An entry hides one token's picture ("token") or one specific stored file ("ref"). Entries are kept with the reason/case reference.
import fs from "fs";
import path from "path";

const DIR = process.env.ATHAR_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DIR, "hidden.json");
export type Hidden = { kind: "token" | "ref"; key: string; at: number; note: string };

let cache: { mtime: number; rows: Hidden[] } | null = null;
function load(): Hidden[] {
  try {
    const st = fs.statSync(FILE);
    if (cache && cache.mtime === st.mtimeMs) return cache.rows;
    const rows = JSON.parse(fs.readFileSync(FILE, "utf8")) as Hidden[];
    cache = { mtime: st.mtimeMs, rows };
    return rows;
  } catch { return []; }
}
function save(rows: Hidden[]) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, FILE);
  cache = null;
}
export const listHidden = () => load();
export const isHiddenToken = (index: number) => load().some((r) => r.kind === "token" && r.key === String(index));
export const isHiddenRef = (ref: string | null | undefined) => !!ref && load().some((r) => r.kind === "ref" && r.key === ref);
export function hide(kind: Hidden["kind"], key: string, note: string) {
  const rows = load().filter((r) => !(r.kind === kind && r.key === key));
  rows.push({ kind, key, at: Math.floor(Date.now() / 1000), note: note.slice(0, 300) });
  save(rows);
}
export function unhide(kind: Hidden["kind"], key: string) { save(load().filter((r) => !(r.kind === kind && r.key === key))); }
