// The whole life of Edition 2 as the site would live it, in the sandbox: the owner's launch (the exact wallet requests of the panel), a buyer's purchase
// (the site's own request builders), a purchase with a photo, an engraving, a picture change, the owner's stock (AdminMint through the site's builder),
// a plain transfer with the least a wallet attaches, and a sale on Getgems' real sale contract. No test network is needed for any of it.
process.env.NEXT_PUBLIC_SITE_URL = "https://athar.example.com";
import fs from "fs";
import path from "path";
import { compileFunc } from "@ton-community/func-js";
import { Blockchain } from "@ton/sandbox";
import { Address, beginCell, Cell, contractAddress, loadStateInit, toNano, TupleReader } from "@ton/core";
import { launchSteps } from "../web/lib/launch";
import { SEASON_1 } from "../web/lib/seasons";
import { ruleTier, TIER } from "../web/lib/dates";
import { idOf } from "../web/lib/kinds";
import { adminMintMsg, ADMIN_MINT_VALUE, buyMsg, engraveMsg, mediaMsg, Msg } from "../web/lib/tx";
import { pickDates, planBatches } from "../web/lib/bulk";
import { AtharCollection } from "../build/athar_AtharCollection";
import { AtharMinter } from "../build/athar_AtharMinter";
import { AtharItem } from "../build/athar_AtharItem";

const D = path.join(__dirname, "getgems");
async function saleCode(): Promise<Cell> {
  const rd = (f: string) => fs.readFileSync(path.join(D, f), "utf8");
  const r: any = await compileFunc({ targets: ["nft-fixprice-sale-v4r1.fc"], sources: { "nft-fixprice-sale-v4r1.fc": rd("nft-fixprice-sale-v4r1.fc"), "op-codes.fc": rd("op-codes.fc"), "imports/stdlib.fc": rd("imports/stdlib.fc") } });
  if (r.status !== "ok") throw new Error(r.message);
  return Cell.fromBase64(r.codeBoc);
}
const ton = (n: bigint) => Number(n) / 1e9;

it("launch, sell, engrave, change the picture, stock, transfer and list on a market", async () => {
  const bc = await Blockchain.create(); bc.now = 1_800_000_000;
  const admin = await bc.treasury("admin", { balance: toNano("500") });
  const alice = await bc.treasury("alice", { balance: toNano("50") }), bob = await bc.treasury("bob", { balance: toNano("50") }), carol = await bc.treasury("carol", { balance: toNano("50") });
  const payout = await bc.treasury("payout");
  const startAt = bc.now + 600;
  const send = async (from: any, m: Msg) => from.send({ to: Address.parse(m.address), value: BigInt(m.amount), bounce: true,
    init: m.stateInit ? loadStateInit(Cell.fromBase64(m.stateInit).beginParse()) : undefined, body: m.payload ? Cell.fromBase64(m.payload) : undefined });

  // 1. the owner's launch button
  const { steps, collection, minter } = await launchSteps(admin.address, payout.address, SEASON_1, { startAt });
  for (const s of steps) for (const m of s.messages) {
    const r = await send(admin, m);
    const bad = r.transactions.filter((t) => (t.description as any).computePhase?.type === "vm" && !(t.description as any).computePhase.success);
    if (bad.length) throw new Error(`launch step "${s.title}" failed with exit ${(bad[0].description as any).computePhase.exitCode}`);
  }
  const col = bc.openContract(AtharCollection.fromAddress(Address.parse(collection)));
  const min = bc.openContract(AtharMinter.fromAddress(Address.parse(minter)));
  bc.now = startAt + 10;
  const itemOf = async (i: number) => bc.openContract(AtharItem.fromAddress(await col.getGetNftAddressByIndex(BigInt(i))));
  const specials = new Set(SEASON_1.specials.map((x) => Date.UTC(x.y, x.m - 1, x.d) / 86400000 - Date.UTC(1950, 0, 1) / 86400000));
  const free: number[] = []; for (let i = 18262; free.length < 400; i++) if (ruleTier(i) === TIER.COMMON && !specials.has(i)) free.push(i);   // plain dates of the 2000s
  const [A, B] = [free[3], free[4]];

  // 2. alice buys with the site's request: default art
  const price = ton(await min.getPriceOf(BigInt(A)));
  let r = await send(alice, buyMsg(minter, A, price));
  expect((await (await itemOf(A)).getGetNftData()).ownerAddress.equals(alice.address)).toBe(true);
  // 3. bob buys with his own photo: the photo fee is paid on top and reaches the payout wallet
  const fees = await min.getKindInfo(0n);
  const price2 = ton(await min.getPriceOf(BigInt(B)));
  const pBefore = await payout.getBalance();
  await send(bob, buyMsg(minter, B, price2, undefined, 0, 777n, 1, ton(fees.photo)));
  const st = await (await itemOf(B)).getAthar();
  expect(st.mediaRef).toBe(777n);
  expect((await payout.getBalance()) - pBefore).toBeGreaterThan(toNano(price2) + fees.photo - toNano("0.002"));
  // 3b. the same date again, in silver and in gold (bob) and as a class minted by the owner: each is its own token
  const A_silver = idOf(1, A), A_gold = idOf(2, A);
  await send(bob, buyMsg(minter, A_silver, ton(await min.getPriceOf(BigInt(A_silver)))));
  await send(bob, buyMsg(minter, A_gold, ton(await min.getPriceOf(BigInt(A_gold)))));
  await send(admin, adminMintMsg(minter, idOf(5, A)));
  for (const [id, who] of [[A_silver, bob], [A_gold, bob], [idOf(5, A), admin]] as const) expect((await (await itemOf(id)).getGetNftData()).ownerAddress.equals(who.address)).toBe(true);
  expect((await (await itemOf(idOf(5, A))).getAthar()).tier).toBe(5n);
  // 4. alice engraves, then adds a picture and changes it (the change costs more)
  const itemsFees = await col.getItemFees();
  await send(alice, engraveMsg(collection, A, "for my daughter", ton(itemsFees.engrave)));
  expect((await (await itemOf(A)).getAthar()).engravings.length ?? 1).toBeGreaterThan(0);
  await send(alice, mediaMsg(collection, A, 2, 888n, ton(itemsFees.media)));
  expect((await (await itemOf(A)).getAthar()).mediaRef).toBe(888n);
  await send(alice, mediaMsg(collection, A, 2, 999n, ton(itemsFees.change)));
  expect((await (await itemOf(A)).getAthar()).mediaRef).toBe(999n);

  // 5. the owner's stock through the panel's own planning and builder
  const priceBefore = await min.getPrice(0n), sold0 = await min.getSoldCount();
  const stockDates = pickDates(free.slice(10), 6, "spread");
  const batches = planBatches(stockDates, 4, await admin.getBalance(), ADMIN_MINT_VALUE);
  expect(batches.flat().length).toBe(6);
  for (const b of batches) for (const d of b) await send(admin, adminMintMsg(minter, d));
  for (const d of stockDates) expect((await (await itemOf(d)).getGetNftData()).ownerAddress.equals(admin.address)).toBe(true);
  expect(await min.getPrice(0n)).toBe(priceBefore);
  expect(await min.getSoldCount()).toBe(sold0 + 6n);

  // 6. a plain wallet transfer with the least a wallet attaches (0.06), then the new owner is bob
  const aItem = await itemOf(A);
  const t = await aItem.send(alice.getSender(), { value: toNano("0.06") }, { $$type: "Transfer", queryId: 1n, newOwner: bob.address, responseDestination: alice.address, customPayload: null, forwardAmount: 1n, forwardPayload: beginCell().storeUint(0, 1).endCell().asSlice() });
  expect(t.transactions).toHaveTransaction({ to: aItem.address, success: true });
  expect((await aItem.getGetNftData()).ownerAddress.equals(bob.address)).toBe(true);

  // 7. the owner lists a stock token on the real Getgems sale contract, carol buys it, the royalty reaches the payout wallet
  const stock = await itemOf(stockDates[0]);
  const salePrice = toNano("2");
  const statics = beginCell().storeAddress(admin.address).storeAddress(payout.address).storeUint(5000, 17).storeUint(5000, 17).storeAddress(stock.address).storeUint(bc.now!, 32).endCell();
  const data = beginCell().storeUint(0, 1).storeAddress(admin.address).storeAddress(null).storeCoins(salePrice).storeUint(0, 32).storeUint(0, 64).storeRef(statics).storeDict(null).storeBit(0).endCell();
  const init = { code: await saleCode(), data };
  const sale = contractAddress(0, init);
  await admin.send({ to: sale, value: toNano("0.05"), init, body: beginCell().storeUint(0x664c0905, 32).storeUint(0, 64).endCell() });
  const l = await stock.send(admin.getSender(), { value: toNano("0.3") }, { $$type: "Transfer", queryId: 3n, newOwner: sale, responseDestination: admin.address, customPayload: null, forwardAmount: toNano("0.1"), forwardPayload: beginCell().storeUint(0, 1).endCell().asSlice() });
  expect(l.transactions).toHaveTransaction({ from: stock.address, to: admin.address });          // the unused value comes back
  const royaltyBefore = await payout.getBalance();
  await bc.sendMessage({ info: { type: "internal", ihrDisabled: true, bounce: true, bounced: false, src: carol.address, dest: sale, value: { coins: salePrice + toNano("0.2") }, ihrFee: 0n, forwardFee: 0n, createdLt: 0n, createdAt: 0 }, body: new Cell() } as any);
  expect((await stock.getGetNftData()).ownerAddress.equals(carol.address)).toBe(true);
  expect((await payout.getBalance()) - royaltyBefore).toBeGreaterThan(toNano("0.09"));               // 5% of 2 TON
  expect(TupleReader).toBeDefined();
}, 240000);
