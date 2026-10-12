import crypto from "crypto";
import { Address, Cell, loadStateInit } from "@ton/core";
import { signVerify } from "@ton/crypto";

/**
 * Wallet ownership for the Zenobia bot: TonConnect `ton_proof`.
 * - A signed link token proves "this link was issued by the bot to this Telegram user".
 * - A signed proof payload binds the wallet signature to that user (no database needed for challenges).
 * - verifyTonProof checks the wallet's ed25519 signature the way the TonConnect spec defines it.
 * Keys are derived from the bot's own token, so no new secret has to be configured.
 */

const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest();
const mac = (botToken: string, data: string) => crypto.createHmac("sha256", sha256("zenobia-link:" + botToken)).update(data).digest("hex").slice(0, 32);
const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function makeLinkToken(botToken: string, userId: string, now = Date.now(), ttlMs = 30 * 60_000): string {
  const body = `${userId}.${Math.floor((now + ttlMs) / 1000)}`;
  return `${body}.${mac(botToken, "t:" + body)}`;
}
export function readLinkToken(botToken: string, token: string, now = Date.now()): string | null {
  const m = /^(\d{5,15})\.(\d{9,11})\.([0-9a-f]{32})$/.exec(token || "");
  if (!m) return null;
  if (!safeEq(mac(botToken, `t:${m[1]}.${m[2]}`), m[3])) return null;
  return Number(m[2]) * 1000 >= now ? m[1] : null;
}

/** The ton_proof payload the wallet signs (kept short: wallets limit it to 128 bytes). */
export function makeProofPayload(botToken: string, userId: string, now = Date.now(), ttlMs = 15 * 60_000): string {
  const body = `${userId}.${Math.floor((now + ttlMs) / 1000)}.${crypto.randomBytes(6).toString("hex")}`;
  return `${body}.${mac(botToken, "p:" + body)}`;
}
export function readProofPayload(botToken: string, payload: string, now = Date.now()): string | null {
  const m = /^(\d{5,15})\.(\d{9,11})\.([0-9a-f]{12})\.([0-9a-f]{32})$/.exec(payload || "");
  if (!m) return null;
  if (!safeEq(mac(botToken, `p:${m[1]}.${m[2]}.${m[3]}`), m[4])) return null;
  return Number(m[2]) * 1000 >= now ? m[1] : null;
}

export interface TonProofRequest {
  account: { address: string; publicKey: string; walletStateInit: string };
  proof: { timestamp: number; domain: { lengthBytes: number; value: string }; payload: string; signature: string };
}
export type ProofResult = { ok: true; address: string } | { ok: false; reason: string };

export function verifyTonProof(req: TonProofRequest, opts: { domain: string; now?: number; maxAgeSec?: number }): ProofResult {
  try {
    const now = Math.floor((opts.now ?? Date.now()) / 1000);
    const { account, proof } = req;
    const address = Address.parse(account.address);
    const stateInitCell = Cell.fromBase64(account.walletStateInit);
    if (!stateInitCell.hash().equals(address.hash)) return { ok: false, reason: "address does not match the wallet state" };

    // the public key must be the one stored in the wallet's own data (v3/v4: after seqno+wallet id; v5: one flag bit first)
    const pub = Buffer.from(account.publicKey, "hex");
    const data = loadStateInit(stateInitCell.beginParse()).data;
    if (!data || pub.length !== 32) return { ok: false, reason: "no public key" };
    const found = [64, 65].some((offset) => {
      const s = data.beginParse();
      if (s.remainingBits < offset + 256) return false;
      s.skip(offset);
      return s.loadBuffer(32).equals(pub);
    });
    if (!found) return { ok: false, reason: "public key is not in the wallet state" };

    if (proof.domain.value !== opts.domain || proof.domain.lengthBytes !== Buffer.byteLength(opts.domain)) return { ok: false, reason: "wrong domain" };
    const age = now - proof.timestamp;
    if (age > (opts.maxAgeSec ?? 15 * 60) || age < -60) return { ok: false, reason: "proof expired" };

    const wc = Buffer.alloc(4); wc.writeInt32BE(address.workChain);
    const ts = Buffer.alloc(8); ts.writeBigUInt64LE(BigInt(proof.timestamp));
    const dl = Buffer.alloc(4); dl.writeUInt32LE(proof.domain.lengthBytes);
    const msg = Buffer.concat([Buffer.from("ton-proof-item-v2/"), wc, address.hash, dl, Buffer.from(opts.domain), ts, Buffer.from(proof.payload)]);
    const full = Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from("ton-connect"), sha256(msg)]);
    if (!signVerify(sha256(full), Buffer.from(proof.signature, "base64"), pub)) return { ok: false, reason: "bad signature" };
    return { ok: true, address: address.toString({ bounceable: false }) };
  } catch (e) {
    return { ok: false, reason: "malformed proof" };
  }
}
