// The permanent-storage "data item" (ANS-104), built here with small audited primitives (@noble) instead of the general bundling library
// (which drags in an old elliptic curve package with known problems). A test builds the same item with that library and requires the
// two to be identical byte for byte, so ids never change. Signature type 3 = secp256k1 / Ethereum message signing.
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256, sha384 } from "@noble/hashes/sha2";

const te = new TextEncoder();
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const hexToBytes = (h: string) => Uint8Array.from((h.replace(/^0x/, "").match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const le = (n: number, len: number) => { const o = new Uint8Array(len); let v = n; for (let i = 0; i < len; i++) { o[i] = v & 0xff; v = Math.floor(v / 256); } return o; };

/** Arweave "deep hash" (SHA-384 over a tagged tree of byte strings). */
export function deepHash(d: Uint8Array | Uint8Array[]): Uint8Array {
  if (Array.isArray(d)) {
    let acc = sha384(te.encode("list" + d.length));
    for (const c of d) acc = sha384(cat(acc, deepHash(c)));
    return acc;
  }
  return sha384(cat(sha384(te.encode("blob" + d.length)), sha384(d)));
}

const zigzag = (n: number) => { let v = n >= 0 ? n * 2 : -n * 2 - 1; const o: number[] = []; while (v >= 128) { o.push((v % 128) | 128); v = Math.floor(v / 128); } o.push(v); return Uint8Array.from(o); };
/** Avro encoding of the tag list: one block with the count, each name and value as length-prefixed bytes, then the closing 0. */
export function serializeTags(tags: { name: string; value: string }[]): Uint8Array {
  if (!tags.length) return new Uint8Array(0);
  const parts: Uint8Array[] = [zigzag(tags.length)];
  for (const t of tags) { const n = te.encode(t.name), v = te.encode(t.value); parts.push(zigzag(n.length), n, zigzag(v.length), v); }
  parts.push(zigzag(0));
  return cat(...parts);
}

const b64url = (b: Uint8Array) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };

export type BuiltItem = { id: string; raw: Uint8Array };

/** A signed data item. `keyHex` is the 32-byte secp256k1 private key (hex); `anchor` is 32 bytes (fixed, so the id never varies). */
export function buildDataItem(data: Uint8Array, keyHex: string, tags: { name: string; value: string }[], anchor: string): BuiltItem {
  const priv = hexToBytes(keyHex);
  const owner = secp256k1.getPublicKey(priv, false);                    // 65 bytes
  const anchorB = te.encode(anchor);
  if (anchorB.length !== 32) throw new Error("anchor must be 32 bytes");
  const rawTags = serializeTags(tags);
  const message = deepHash([te.encode("dataitem"), te.encode("1"), te.encode("3"), owner, new Uint8Array(0), anchorB, rawTags, data]);
  const digest = keccak_256(cat(te.encode("\x19Ethereum Signed Message:\n" + message.length), message));   // EIP-191 personal message
  const sig = secp256k1.sign(digest, priv);                             // deterministic (RFC 6979), low-S
  const signature = cat(sig.toCompactRawBytes(), Uint8Array.from([27 + (sig.recovery ?? 0)]));         // r || s || v
  const raw = cat(le(3, 2), signature, owner, Uint8Array.from([0]), Uint8Array.from([1]), anchorB, le(tags.length, 8), le(rawTags.length, 8), rawTags, data);
  return { id: b64url(sha256(signature)), raw };
}
