// Sham's AUTOMATIC KNOWLEDGE (owner 2026-11-09): what Sham reads while it searches (a page, a search result, a research report) is kept, with its source and date, in a small library per user and
// model, and found again by meaning-of-words (BM25 over normalised Arabic/Latin tokens). Knowledge lives OUTSIDE the weights: instant, correctable, deletable, always with its source.
// Phase 1 of the plan in docs/SHAM_KNOWLEDGE.md: no model and no training; a small learned encoder is a measured experiment for phase 2 and replaces this only if it beats it.
import { createHash } from "crypto";
import { prismaDb, type Db } from "@/lib/shamDb";

export const KNOWLEDGE_MAX_CHUNKS = 3000;        // per user and model: the oldest chunk is dropped past this
const CHUNK_CHARS = 700;
const MAX_SAVE_CHARS = 14000;                    // of one page / report
let ready = false;

async function table(db: Db): Promise<void> {
  if (db === prismaDb && ready) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS sham_knowledge (id BIGSERIAL PRIMARY KEY, chat_key TEXT NOT NULL, hash TEXT NOT NULL, source TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, norm TEXT NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (chat_key, hash))`);
  await db.exec(`CREATE INDEX IF NOT EXISTS sham_knowledge_chat ON sham_knowledge (chat_key, id)`);
  if (db === prismaDb) ready = true;
}

/** Arabic + Latin normalisation so a question and a saved text meet: no diacritics or tatweel, one alef, ى→ي, ة→ه, lower case, no punctuation, no leading «ال». */
export function normaliseText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
const STOP = new Set(["في", "من", "على", "الى", "عن", "ما", "ماذا", "هل", "هو", "هي", "كان", "ان", "او", "ثم", "هذا", "هذه", "التي", "الذي", "the", "a", "an", "of", "to", "and", "is", "in", "on", "for", "what", "who", "how"]);
export function tokens(text: string): string[] {
  return normaliseText(text).split(" ").map((t) => (t.length > 3 && t.startsWith("ال") ? t.slice(2) : t)).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Cut a text into ~700-character chunks on paragraph / sentence boundaries. */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const clean = String(text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, MAX_SAVE_CHARS);
  const parts = clean.split(/\n{2,}|(?<=[.!?؟])\s+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + " " + p).length > size && cur) { out.push(cur); cur = ""; }
    cur = cur ? cur + " " + p : p;
    while (cur.length > size * 1.5) { out.push(cur.slice(0, size)); cur = cur.slice(size); }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((c) => tokens(c).length >= 4);
}

export type Knowledge = { source: string; url?: string; title?: string; text: string };

/** Keep what Sham read. Returns how many NEW chunks were stored (a chunk already stored is skipped). Never throws: saving is best effort. */
export async function knowledgeSave(db: Db, chatKey: string, k: Knowledge): Promise<number> {
  try {
    if (!chatKey || !k.text || /^error/i.test(k.text.trim())) return 0;
    await table(db);
    let added = 0;
    for (const body of chunkText(k.text)) {
      const hash = createHash("sha256").update(normaliseText(body)).digest("hex").slice(0, 32);
      const before = await db.query<{ id: number }>(`SELECT id FROM sham_knowledge WHERE chat_key = $1 AND hash = $2 LIMIT 1`, chatKey, hash);
      if (before.length) continue;
      await db.exec(`INSERT INTO sham_knowledge (chat_key, hash, source, url, title, body, norm) VALUES ($1, $2, $3, $4, $5, $6, $7)`, chatKey, hash, String(k.source).slice(0, 40), String(k.url || "").slice(0, 400), String(k.title || "").slice(0, 200), body, normaliseText(body));
      added++;
    }
    if (added) {
      const n = (await db.query<{ n: number | string }>(`SELECT count(*) AS n FROM sham_knowledge WHERE chat_key = $1`, chatKey))[0]?.n;
      if (Number(n) > KNOWLEDGE_MAX_CHUNKS) await db.exec(`DELETE FROM sham_knowledge WHERE chat_key = $1 AND id IN (SELECT id FROM sham_knowledge WHERE chat_key = $1 ORDER BY id ASC LIMIT $2)`, chatKey, Number(n) - KNOWLEDGE_MAX_CHUNKS);
    }
    return added;
  } catch { return 0; }
}

type Row = { id: number; source: string; url: string; title: string; body: string; norm: string; saved_at: string | Date };

/** BM25 over the user's chunks (newest 3000). Returns the best `count` chunks with their source and date. */
export async function knowledgeSearch(db: Db, chatKey: string, query: string, count = 4): Promise<string> {
  try {
    await table(db);
    const q = [...new Set(tokens(query))];
    if (!q.length) return "error: give a question or keywords";
    const rows = await db.query<Row>(`SELECT id, source, url, title, body, norm, saved_at FROM sham_knowledge WHERE chat_key = $1 ORDER BY id DESC LIMIT ${KNOWLEDGE_MAX_CHUNKS}`, chatKey);
    if (!rows.length) return "nothing saved yet: use web_search / fetch_page first, then what you read is kept here automatically";
    const docs = rows.map((r) => ({ r, t: tokens(r.norm) }));
    const avg = docs.reduce((s, d) => s + d.t.length, 0) / docs.length || 1;
    const df = new Map<string, number>();
    for (const w of q) df.set(w, docs.filter((d) => d.t.includes(w)).length);
    const scored = docs.map((d) => {
      let score = 0;
      for (const w of q) {
        const tf = d.t.filter((x) => x === w).length;
        if (!tf) continue;
        const idf = Math.log(1 + (docs.length - (df.get(w) || 0) + 0.5) / ((df.get(w) || 0) + 0.5));
        score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.t.length / avg))));
      }
      return { r: d.r, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(8, count)));
    if (!scored.length) return "no saved text matches: it was not read yet, or it is worded differently; search the web for it";
    return scored.map((x, i) => `[${i + 1}] (${x.r.source}${x.r.title ? " · " + x.r.title : ""}${x.r.url ? " · " + x.r.url : ""} · saved ${new Date(x.r.saved_at).toISOString().slice(0, 10)})\n${x.r.body}`).join("\n\n");
  } catch (e) { return `error: ${String((e as Error)?.message || e).slice(0, 200)}`; }
}

export async function knowledgeCount(db: Db, chatKey: string): Promise<number> {
  try { await table(db); return Number((await db.query<{ n: number | string }>(`SELECT count(*) AS n FROM sham_knowledge WHERE chat_key = $1`, chatKey))[0]?.n || 0); } catch { return 0; }
}
