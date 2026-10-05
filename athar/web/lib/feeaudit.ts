// Picture-fee audit (server side, our own server only).
//
// The deployed seller contract cannot tell a free picture from a paid one: a purchase sent by hand with style 0 and a picture id binds
// that picture without the photo fee. We cannot change that contract, so we enforce the fee where we decide what is SHOWN: a custom
// picture (one that carries a photo) is shown only if
//   - it was bound through the fee path (the purchase said style 1 or 2, and the contract itself made the buyer pay), or
//   - the buyer was the management wallet (the owner pays no fees, ever), or
//   - it was set later through the item's own "set picture" message (the contract charged that fee), or
//   - the token did not come from a direct purchase (auctions and mystery boxes carry pictures chosen by the management).
// Plain generated pictures (no photo) are free for everybody and always shown.
// The purchases are read from the seller contract's own transactions (public, on-chain) and kept in a small file.
import fs from "fs";
import path from "path";
import { Address, Cell } from "@ton/core";
import { loadBuy } from "../../build/athar_AtharMinter";
import { TONCENTER_V3 } from "./config";
import { arweaveId } from "./ids";
import { addresses } from "./chain";

export type BuyRec = { index: number; buyer: string; style: number; ref: string; lt: string };
type Book = { lastLt: string; byIndex: Record<string, BuyRec[]> };

const DIR = process.env.ATHAR_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DIR, "buys.json");
const BUY_OPCODE = "0x41540044";

const loadBook = (): Book => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")) as Book; } catch { return { lastLt: "0", byIndex: {} }; } };
const saveBook = (b: Book) => { fs.mkdirSync(DIR, { recursive: true }); const t = FILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(b)); fs.renameSync(t, FILE); };

/** Reads one transaction of the seller contract: a successful purchase request, or null. */
export function parseBuyTx(tx: any): BuyRec | null {
  try {
    const im = tx?.in_msg;
    if (!im || im.opcode !== BUY_OPCODE || !im.source) return null;
    if (tx?.description?.aborted) return null;                                  // the contract refused it: nothing was bought
    const body = im.message_content?.body;
    if (!body) return null;
    const b = loadBuy(Cell.fromBase64(body).beginParse());
    return { index: Number(b.index), buyer: Address.parseRaw(im.source).toRawString(), style: Number(b.style), ref: b.mediaRef === 0n ? "" : arweaveId(b.mediaRef), lt: String(tx.lt) };
  } catch { return null; }
}

let lastScan = 0, scanning: Promise<Book> | null = null;
/** Brings the file up to date (at most every 30 s), asking only for transactions newer than the last one already read. */
export async function buys(): Promise<Book> {
  if (scanning) return scanning;
  const book = loadBook();
  if (Date.now() - lastScan < 30_000) return book;
  scanning = (async () => {
    const a = await addresses(1);
    if (!a) return book;
    const minter = a.minter.address.toString({ bounceable: true });
    const headers: Record<string, string> = process.env.TONCENTER_API_KEY ? { "X-API-Key": process.env.TONCENTER_API_KEY } : {};
    let offset = 0, newest = book.lastLt, done = false;
    while (!done && offset < 2000) {
      const r = await fetch(`${TONCENTER_V3}/transactions?account=${encodeURIComponent(minter)}&limit=20&offset=${offset}&sort=desc`, { headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!r.ok) break;
      const txs: any[] = (await r.json()).transactions || [];
      if (!txs.length) break;
      for (const tx of txs) {
        if (BigInt(tx.lt) <= BigInt(book.lastLt)) { done = true; break; }
        if (BigInt(tx.lt) > BigInt(newest)) newest = String(tx.lt);
        const rec = parseBuyTx(tx);
        if (rec) { const k = String(rec.index); (book.byIndex[k] ||= []).push(rec); }
      }
      offset += txs.length;
      await new Promise((res) => setTimeout(res, process.env.TONCENTER_API_KEY ? 150 : 1100));
    }
    book.lastLt = newest; saveBook(book); lastScan = Date.now();
    return book;
  })().catch(() => book).finally(() => { scanning = null; });
  return scanning;
}

/** Does this stored picture carry a photo? Checked by reading it (cached: a picture never changes). */
const photoCache = new Map<string, boolean>();
export async function carriesPhoto(ref: string, gateways = ["https://turbo-gateway.com", "https://arweave.net"]): Promise<boolean | null> {
  const c = photoCache.get(ref);
  if (c !== undefined) return c;
  for (const g of gateways) {
    try {
      const r = await fetch(`${g}/${ref}`, { signal: AbortSignal.timeout(8000), redirect: "follow" });
      if (!r.ok) continue;
      const text = await r.text();
      const has = /<image\b|<foreignObject\b|<script\b/i.test(text) || !/^\s*<svg\b/i.test(text.slice(0, 200).replace(/^<\?xml[^>]*>\s*/, ""));   // anything but a plain drawn picture counts as custom
      photoCache.set(ref, has);
      return has;
    } catch { /* next gateway */ }
  }
  return null;                          // unreadable right now: decided later, shown meanwhile
}

type Tok = { index: number; mediaRef: string | null; media: { ref: string }[] };
export type Verdict = "ok" | "unpaid";

/** The whole rule, as a pure function of what is on the chain (so it can be tested). */
export function judge(t: Tok, recs: BuyRec[], adminRaw: string | null, hasPhoto: boolean | null): Verdict {
  if (!t.mediaRef) return "ok";
  const log = t.media || [];
  const mintRef = log.length ? log[log.length - 1].ref : t.mediaRef;               // the oldest entry: the picture the token was born with
  if (log.length >= 2 && t.mediaRef !== mintRef) return "ok";                      // set later through the item's own paid message
  const rec = [...recs].reverse().find((r) => r.ref === mintRef);
  if (!rec) return "ok";                                                          // not a direct purchase (auction, box): the management chose it
  if (hasPhoto === false) return "ok";                                            // a generated picture: free for everybody
  if (rec.style >= 1) return "ok";                                                // the contract made the buyer pay the photo fee
  if (adminRaw && rec.buyer === adminRaw) return "ok";                            // the owner pays no fees
  return hasPhoto === null ? "ok" : "unpaid";                                     // unreadable now: show it and judge on the next look
}

export async function verdictOf(t: Tok, adminRaw: string | null): Promise<Verdict> {
  if (!t.mediaRef) return "ok";
  const book = await buys();
  const recs = book.byIndex[String(t.index)] || [];
  const log = t.media || [];
  const mintRef = log.length ? log[log.length - 1].ref : t.mediaRef;
  const needsLook = recs.some((r) => r.ref === mintRef) && !(log.length >= 2 && t.mediaRef !== mintRef);
  const hasPhoto = needsLook ? await carriesPhoto(mintRef) : false;
  return judge(t, recs, adminRaw, hasPhoto);
}
