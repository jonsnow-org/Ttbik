// Demand for dates that are not in the open season. A person says "I want this date" (optionally leaving a Telegram handle so
// we can tell them when a season that includes it opens). Only counts are public. One vote per person per date.
import fs from "fs";
import path from "path";
import { createHash } from "crypto";

const DIR = process.env.ATHAR_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DIR, "waitlist.json");
type Row = { n: number; who: string[]; contacts: string[] };
type Book = Record<string, Row>;

function load(): Book { try { return JSON.parse(fs.readFileSync(FILE, "utf8")) as Book; } catch { return {}; } }
function save(b: Book) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(b));
  fs.renameSync(tmp, FILE);
}
export const voter = (ip: string, ua: string) => createHash("sha256").update(`athar-wl|${ip}|${ua}`).digest("hex").slice(0, 16);

export const countOf = (index: number) => load()[String(index)]?.n ?? 0;

/** Adds one vote. Returns the new count, and whether this person had already voted for the date. */
export function vote(index: number, who: string, contact?: string): { n: number; again: boolean } {
  const b = load(), k = String(index);
  const row = b[k] || (b[k] = { n: 0, who: [], contacts: [] });
  if (row.who.includes(who)) return { n: row.n, again: true };
  row.who.push(who); row.n = row.who.length;
  const c = (contact || "").trim().replace(/^@/, "");
  if (/^[A-Za-z0-9_]{4,32}$/.test(c) && row.contacts.length < 200 && !row.contacts.includes(c)) row.contacts.push(c);
  save(b);
  return { n: row.n, again: false };
}

/** For the owner: the most wanted dates and years. */
export function top(limit = 40) {
  const b = load();
  const dates = Object.entries(b).map(([i, r]) => ({ index: Number(i), n: r.n, contacts: r.contacts })).sort((a, c) => c.n - a.n).slice(0, limit);
  return { total: Object.values(b).reduce((s, r) => s + r.n, 0), dates };
}
