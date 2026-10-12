// Zenobia: passport metadata and TonConnect ton_proof verification (pure; a real wallet key signs the proof).
import crypto from "crypto";
import { beginCell, storeStateInit } from "@ton/core";
import { mnemonicNew, mnemonicToPrivateKey, sign } from "@ton/crypto";
import { WalletContractV4 } from "@ton/ton";
import { makeLinkToken, readLinkToken, makeProofPayload, readProofPayload, verifyTonProof, type TonProofRequest } from "../zenobiaTonProof";
import { passportMetadata, parsePassportFile } from "../zenobiaPassport";

const TOKEN = "123456:TESTTOKEN";
const DOMAIN = "ttbik.vercel.app";
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest();

async function wallet() {
  const kp = await mnemonicToPrivateKey(await mnemonicNew(24));
  const w = WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey });
  const stateInit = beginCell().store(storeStateInit(w.init)).endCell();
  return { kp, w, stateInit };
}
// what a wallet does when it signs ton_proof (TonConnect spec)
function signProof(w: any, kp: any, payload: string, ts: number, domain = DOMAIN) {
  const wc = Buffer.alloc(4); wc.writeInt32BE(0);
  const tsb = Buffer.alloc(8); tsb.writeBigUInt64LE(BigInt(ts));
  const dl = Buffer.alloc(4); dl.writeUInt32LE(Buffer.byteLength(domain));
  const msg = Buffer.concat([Buffer.from("ton-proof-item-v2/"), wc, w.address.hash, dl, Buffer.from(domain), tsb, Buffer.from(payload)]);
  const full = Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from("ton-connect"), sha256(msg)]);
  return sign(sha256(full), kp.secretKey).toString("base64");
}
async function request(over: { domain?: string; ts?: number; payload?: string } = {}): Promise<TonProofRequest> {
  const { kp, w, stateInit } = await wallet();
  const ts = over.ts ?? Math.floor(Date.now() / 1000);
  const payload = over.payload ?? makeProofPayload(TOKEN, "424242");
  const domain = over.domain ?? DOMAIN;
  return {
    account: { address: w.address.toRawString(), publicKey: kp.publicKey.toString("hex"), walletStateInit: stateInit.toBoc().toString("base64") },
    proof: { timestamp: ts, domain: { lengthBytes: Buffer.byteLength(domain), value: domain }, payload, signature: signProof(w, kp, payload, ts, domain) },
  };
}

describe("link tokens and proof payloads", () => {
  it("round-trip, and reject tampering, another bot's token, and expiry", () => {
    const t = makeLinkToken(TOKEN, "424242");
    expect(readLinkToken(TOKEN, t)).toBe("424242");
    expect(readLinkToken(TOKEN, t.replace("424242", "424243"))).toBeNull();
    expect(readLinkToken("999999:OTHER", t)).toBeNull();
    expect(readLinkToken(TOKEN, t, Date.now() + 31 * 60_000)).toBeNull();
    const p = makeProofPayload(TOKEN, "424242");
    expect(p.length).toBeLessThanOrEqual(128);
    expect(readProofPayload(TOKEN, p)).toBe("424242");
    expect(readProofPayload(TOKEN, p, Date.now() + 16 * 60_000)).toBeNull();
    expect(readProofPayload(TOKEN, "1.2.3.4")).toBeNull();
  });
});

describe("ton_proof verification", () => {
  it("accepts a genuine proof from a real wallet key and returns the wallet address", async () => {
    const r = await request();
    const res = verifyTonProof(r, { domain: DOMAIN });
    expect(res.ok).toBe(true);
  });
  it("rejects a wrong domain, an old proof, a tampered payload, and another wallet's key", async () => {
    expect(verifyTonProof(await request({ domain: "evil.example" }), { domain: DOMAIN }).ok).toBe(false);
    expect(verifyTonProof(await request({ ts: Math.floor(Date.now() / 1000) - 3600 }), { domain: DOMAIN }).ok).toBe(false);
    const r = await request();
    expect(verifyTonProof({ ...r, proof: { ...r.proof, payload: r.proof.payload + "0" } }, { domain: DOMAIN }).ok).toBe(false);
    const other = await request();
    // a valid signature but claiming someone else's address
    expect(verifyTonProof({ account: { ...r.account, address: other.account.address }, proof: r.proof }, { domain: DOMAIN }).ok).toBe(false);
    // a signature by a different key than the one in the wallet state
    expect(verifyTonProof({ account: { ...r.account, publicKey: other.account.publicKey }, proof: r.proof }, { domain: DOMAIN }).ok).toBe(false);
    expect(verifyTonProof({ account: r.account, proof: { ...r.proof, signature: other.proof.signature } }, { domain: DOMAIN }).ok).toBe(false);
    expect(verifyTonProof({ account: {} as any, proof: {} as any }, { domain: DOMAIN }).ok).toBe(false);
  });
});

describe("passport metadata", () => {
  const site = "https://ttbik.vercel.app";
  const day = 86400000;
  it("picks the stage picture from the holder's days", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const at = (d: number) => passportMetadata({ index: 3, joinedAt: new Date(now.getTime() - d * day), now }, site);
    expect(at(2).image).toBe(`${site}/zenobia/stage-1-child.jpg`);
    expect(at(10).image).toBe(`${site}/zenobia/stage-2-queen.jpg`);
    expect(at(30).image).toBe(`${site}/zenobia/stage-3-warrior.jpg`);
    expect(at(30).attributes.find((a) => a.trait_type === "Stage")!.value).toBe("Warrior");
  });
  it("shows captive and legend, with a name and both languages in the description", () => {
    expect(passportMetadata({ index: 1, joinedAt: new Date(), soldAll: true }, site).image).toMatch(/stage-4-captive/);
    const m = passportMetadata({ index: 1, joinedAt: new Date(), burned: true, soldAll: true }, site);
    expect(m.image).toMatch(/stage-5-legend/);
    expect(m.name).toBe("Caravan Passport #1");
    expect(m.description).toMatch(/Soulbound/); expect(m.description).toMatch(/جواز قافلة زنوبيا/);
  });
  it("an unknown holder is a Child, and file names are parsed strictly", () => {
    expect(passportMetadata({ index: 0 }, site).image).toMatch(/stage-1-child/);
    expect(parsePassportFile("12.json")).toBe(12);
    for (const bad of ["x.json", "12", "12.json/", "-1.json", "1.json.exe", "../1.json"]) expect(parsePassportFile(bad)).toBeNull();
  });
});
