/** Arweave transaction ids are 32 bytes written as 43 characters of URL-safe base64; the token stores the 32 bytes as one number. */
export function idToUint256(id: string): bigint {
  const b = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/") + "=", "base64");
  if (b.length !== 32) throw new Error("bad Arweave id");
  return BigInt("0x" + b.toString("hex"));
}
export function arweaveId(v: bigint) {
  return Buffer.from(v.toString(16).padStart(64, "0"), "hex").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
