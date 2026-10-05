import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { Cell, toNano } from "@ton/core";
import { setup, openSeason, itemOf, S1_START, DELAY } from "./helpers";
import { ruleTier, TIER } from "../lib/rules";

// The collection can be corrected in place (owner's decision): the admin proposes new code, it waits the public notice period, anyone can read
// its hash meanwhile, it can be cancelled; the address, the tokens' addresses and all data stay. The "new version" here is the real source with
// two small changes (a version getter and a different royalty), compiled by the real compiler.
const find = (from: number, tier: number, n = 1) => { const out: number[] = []; for (let i = from; out.length < n && i < from + 6000; i++) if (ruleTier(i) === tier) out.push(i); return out; };

let variantCode: Cell;
beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athar-variant-"));
  fs.cpSync(path.join(__dirname, "../contracts"), path.join(tmp, "contracts"), { recursive: true });
  const f = path.join(tmp, "contracts/collection.tact");
  let src = fs.readFileSync(f, "utf8");
  src = src.replace("get fun total_minted(): Int { return self.minted; }", "get fun total_minted(): Int { return self.minted; }\n    get fun version(): Int { return 2; }");
  src = src.replace("royaltyNum: Int as uint16 = 500;", "royaltyNum: Int as uint16 = 300;");   // only for new deployments: the stored value of a running collection must stay
  src = src.replace("return RoyaltyParams{ numerator: self.royaltyNum,", "return RoyaltyParams{ numerator: self.royaltyNum + 1,");        // a logic change that a running collection will show
  fs.writeFileSync(f, src);
  fs.writeFileSync(path.join(tmp, "tact.config.json"), JSON.stringify({ projects: [{ name: "athar", path: "./contracts/athar.tact", output: "./build", options: { debug: false } }] }));
  execSync(`${path.join(__dirname, "../node_modules/.bin/tact")} --config tact.config.json`, { cwd: tmp, stdio: "pipe" });
  variantCode = Cell.fromBoc(fs.readFileSync(path.join(tmp, "build/athar_AtharCollection.code.boc")))[0];
}, 180000);

describe("collection code upgrade", () => {
  it("proposal, public notice, cancel and apply; address, tokens and data survive; the new logic is live", async () => {
    const ctx = await setup(); await openSeason(ctx);
    const { bc, admin, alice, collection, minter } = ctx;
    const [d1, d2] = find(S1_START, TIER.COMMON, 2);
    await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(d1), recipient: null, occasion: 0n, mediaRef: 0n, style: 0n });
    const itemAddr = (await collection.getGetNftAddressByIndex(BigInt(d1))).toString();
    const royaltyBefore = (await collection.getRoyaltyParams()).numerator;
    expect(royaltyBefore).toBe(500n);

    // only the admin proposes
    let r = await collection.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "ProposeCode", code: variantCode });
    expect(r.transactions).toHaveTransaction({ to: collection.address, success: false });
    // nothing applies without a proposal
    r = await collection.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "ApplyCode" });
    expect(r.transactions).toHaveTransaction({ to: collection.address, success: false });
    // proposal is public, with its hash
    r = await collection.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "ProposeCode", code: variantCode });
    expect(r.transactions).toHaveTransaction({ to: collection.address, success: true });
    expect((await collection.getCodeProposal()).pending).toBe(true);
    expect(await collection.getPendingCodeHash()).toBe(BigInt("0x" + variantCode.hash().toString("hex")));
    // the notice period must pass
    r = await collection.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "ApplyCode" });
    expect(r.transactions).toHaveTransaction({ to: collection.address, success: false });
    await expect(bc.runGetMethod(collection.address, "version")).rejects.toThrow();                 // the old code has no such getter
    // cancel, then propose again
    await collection.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "CancelCode" });
    expect((await collection.getCodeProposal()).pending).toBe(false);
    await collection.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "ProposeCode", code: variantCode });
    bc.now = bc.now! + DELAY + 5;
    // only the admin applies
    r = await collection.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "ApplyCode" });
    expect(r.transactions).toHaveTransaction({ to: collection.address, success: false });
    r = await collection.send(admin.getSender(), { value: toNano("0.1") }, { $$type: "ApplyCode" });
    expect(r.transactions).toHaveTransaction({ to: collection.address, success: true });

    // the new logic is live...
    const v = await bc.runGetMethod(collection.address, "version");
    expect(v.exitCode).toBe(0);
    expect(Number((v.stack[0] as any).value)).toBe(2);
    expect((await collection.getRoyaltyParams()).numerator).toBe(501n);                              // 500 stored + 1 added by the new code
    // ...and everything else is as it was: the tokens' addresses, the registry, the payout, the minters, the minted count
    expect((await collection.getGetNftAddressByIndex(BigInt(d1))).toString()).toBe(itemAddr);
    expect(await collection.getTotalMinted()).toBe(1n);
    expect((await collection.getPayoutAddress())!.equals(ctx.payout.address)).toBe(true);
    expect((await collection.getCodeProposal()).pending).toBe(false);
    // selling and the token still work with the upgraded collection
    r = await minter.send(alice.getSender(), { value: toNano("1") }, { $$type: "Buy", index: BigInt(d2), recipient: null, occasion: 0n, mediaRef: 0n, style: 0n });
    expect(r.transactions).toHaveTransaction({ from: minter.address, to: collection.address, success: true });
    expect(await collection.getTotalMinted()).toBe(2n);
    const item2 = await itemOf(ctx, d2);
    expect((await item2.getGetNftData()).ownerAddress.equals(alice.address)).toBe(true);
    const old = await itemOf(ctx, d1);
    const t = await old.send(alice.getSender(), { value: toNano("0.1") }, { $$type: "Transfer", queryId: 1n, newOwner: ctx.bob.address, responseDestination: alice.address, customPayload: null, forwardAmount: 0n, forwardPayload: new Cell().asSlice() });
    expect(t.transactions).toHaveTransaction({ to: old.address, success: true });
    // an engraving goes through the upgraded collection to the old token
    const e = await collection.send(ctx.bob.getSender(), { value: toNano("0.4") }, { $$type: "EngraveReq", index: BigInt(d1), text: "after the upgrade" });
    expect(e.transactions).toHaveTransaction({ from: collection.address, to: old.address, success: true });
  }, 120000);
});
