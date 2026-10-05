// Permanent storage with an identity that comes from the CONTENT. The picture is wrapped in an Arweave data item signed by a
// key derived from the picture itself (the key holds nothing and is not a secret), so the item id is the same wherever, whenever
// and by whomever it is uploaded. That is what makes the failure plan work: a token can carry its picture's final id before the
// file has reached the network, and any later upload (from the buyer's browser, from our server, a week later) lands on that id.
// Works in the browser and on the server.
import { buildDataItem } from "./dataitem";
import { idToUint256 } from "./ids";

export const MAX_BYTES = 100 * 1024 - 2048;          // the free limit is 105 KiB per item: stay clearly under it
// independent front doors of the same free upload service; the data item (and so its id) is identical through each
export const ENDPOINTS = ["https://upload.ardrive.io/v1/tx", "https://upload.services.ar.io/v1/tx", "https://turbo.ardrive.io/v1/tx"];
export const GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net", "https://ar-io.net"];

const te = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
const toBytes = (d: string | Uint8Array) => (typeof d === "string" ? te.encode(d) : d);

export async function contentKey(data: Uint8Array): Promise<string> {
  const prefix = te.encode("athar-store-v1:");
  const all = new Uint8Array(prefix.length + data.length);
  all.set(prefix, 0); all.set(data, prefix.length);
  return hex(await globalThis.crypto.subtle.digest("SHA-256", all));
}

export type Item = { id: string; ref: bigint; raw: Uint8Array; bytes: number };

export async function buildItem(content: string | Uint8Array, contentType = "image/svg+xml"): Promise<Item> {
  const data = toBytes(content);
  if (data.length > MAX_BYTES) throw new Error("file too large for free permanent storage");
  const item = buildDataItem(data, await contentKey(data), [{ name: "Content-Type", value: contentType }, { name: "App-Name", value: "Athar" }],
    "0".repeat(32));                                  // fixed anchor, so the signature (and the id) never varies
  return { id: item.id, ref: idToUint256(item.id), raw: item.raw, bytes: data.length };
}

export async function uploadItem(item: Item, endpoints = ENDPOINTS, timeoutMs = 25000): Promise<{ ok: boolean; via?: string; error?: string }> {
  let last = "no endpoint answered";
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: item.raw as BodyInit, signal: AbortSignal.timeout(timeoutMs) });
      const text = await r.text();
      if (r.ok) {
        let id = ""; try { id = JSON.parse(text).id; } catch { /* not json */ }
        if (id === item.id) return { ok: true, via: url };
        last = `unexpected answer from ${url}`;
      } else last = `${r.status} from ${url}`;
    } catch (e) { last = `${String(e).slice(0, 80)} (${url})`; }
  }
  return { ok: false, error: last };
}

/** True when at least one gateway really serves the file (checked, not assumed). */
export async function isReadable(id: string, gateways = GATEWAYS, timeoutMs = 12000): Promise<boolean> {
  for (const g of gateways) {
    try {
      const r = await fetch(`${g}/${id}`, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) { const n = (await r.arrayBuffer()).byteLength; if (n > 0) return true; }
    } catch { /* try the next gateway */ }
  }
  return false;
}

/** Upload and confirm by reading it back. `readable` is what the caller must see before taking any money for the picture. */
export async function storeNow(content: string | Uint8Array): Promise<Item & { uploaded: boolean; readable: boolean; error?: string }> {
  const item = await buildItem(content);
  const up = await uploadItem(item);
  let readable = false;
  if (up.ok) for (let i = 0; i < 4 && !readable; i++) { readable = await isReadable(item.id); if (!readable) await new Promise((r) => setTimeout(r, 1500)); }
  return { ...item, uploaded: up.ok, readable, error: up.error };
}
