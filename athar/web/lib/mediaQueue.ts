// Server side of the failure plan. Every picture that is about to be (or has been) bound to a token is kept here until the
// permanent network has really confirmed it, then archived for good (these folders are in the daily backup). A background
// retry (called every few minutes by the update agent) keeps trying; because a file's id comes from its content, the token never
// needs touching: the picture simply starts to appear at the id the token already carries.
import fs from "fs";
import path from "path";
import { buildItem, isReadable, uploadItem, MAX_BYTES } from "./storage";

const ROOT = process.env.ATHAR_DATA_DIR || path.join(process.cwd(), "data");
const Q = path.join(ROOT, "queue"), S = path.join(ROOT, "stored");
const ensure = () => { fs.mkdirSync(Q, { recursive: true }); fs.mkdirSync(S, { recursive: true }); };
const safeId = (id: string) => /^[A-Za-z0-9_-]{43}$/.test(id);

/** The pictures we ever store are our own composites: a plain SVG whose only external-looking part is an embedded photo. */
export function validateSvg(svg: unknown): string | null {
  if (typeof svg !== "string") return "svg is required";
  if (Buffer.byteLength(svg) > MAX_BYTES) return "picture too large";
  if (!/^\s*<svg[\s>]/.test(svg) || !/<\/svg>\s*$/.test(svg)) return "not an svg";
  if (/<script|<foreignObject|<iframe|<style|javascript:|\son\w+\s*=/i.test(svg)) return "forbidden content";
  for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*"([^"]*)"/g)) {
    if (!(m[1].startsWith("#") || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(m[1]))) return "external references are not allowed";
  }
  return null;
}

export type Entry = { id: string; at: number; tries: number; last: string };
const metaFile = (id: string) => path.join(Q, `${id}.json`);

export async function enqueue(svg: string) {
  ensure();
  const item = await buildItem(svg);
  const f = path.join(Q, `${item.id}.svg`);
  if (!fs.existsSync(f) && !fs.existsSync(path.join(S, `${item.id}.svg`))) {
    fs.writeFileSync(f, svg);
    fs.writeFileSync(metaFile(item.id), JSON.stringify({ id: item.id, at: Date.now(), tries: 0, last: "" } satisfies Entry));
  }
  return item;
}

/** One attempt for one queued picture: upload through every front door, confirm by reading it back, then archive. */
export async function attempt(id: string): Promise<boolean> {
  if (!safeId(id)) return false;
  const f = path.join(Q, `${id}.svg`);
  if (!fs.existsSync(f)) return fs.existsSync(path.join(S, `${id}.svg`));
  const svg = fs.readFileSync(f, "utf8");
  const item = await buildItem(svg);
  let ok = await isReadable(id, undefined, 8000);
  let last = "";
  if (!ok) {
    const up = await uploadItem(item);
    last = up.ok ? "" : up.error || "upload failed";
    if (up.ok) for (let i = 0; i < 4 && !ok; i++) { ok = await isReadable(id); if (!ok) await new Promise((r) => setTimeout(r, 1500)); }
  }
  let meta: Entry = { id, at: Date.now(), tries: 0, last: "" };
  try { meta = JSON.parse(fs.readFileSync(metaFile(id), "utf8")); } catch { /* new */ }
  if (ok) {
    fs.renameSync(f, path.join(S, `${id}.svg`));
    try { fs.unlinkSync(metaFile(id)); } catch { /* none */ }
    return true;
  }
  meta.tries += 1; meta.last = last || "not readable yet";
  fs.writeFileSync(metaFile(id), JSON.stringify(meta));
  return false;
}

export async function processQueue(limit = 15) {
  ensure();
  const ids = fs.readdirSync(Q).filter((n) => n.endsWith(".svg")).map((n) => n.slice(0, -4)).filter(safeId).slice(0, limit);
  let done = 0;
  for (const id of ids) if (await attempt(id)) done++;
  return { tried: ids.length, done, left: fs.readdirSync(Q).filter((n) => n.endsWith(".svg")).length };
}

export const isQueued = (id: string) => safeId(id) && fs.existsSync(path.join(Q, `${id}.svg`));
export const isArchived = (id: string) => safeId(id) && fs.existsSync(path.join(S, `${id}.svg`));

// short memory so a metadata request never waits on the network every time
const memo = new Map<string, { at: number; ok: boolean }>();
export async function available(id: string): Promise<boolean> {
  const hit = memo.get(id);
  if (hit && Date.now() - hit.at < (hit.ok ? 600_000 : 30_000)) return hit.ok;
  const ok = await isReadable(id, undefined, 6000);
  memo.set(id, { at: Date.now(), ok });
  return ok;
}
