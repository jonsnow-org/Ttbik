const fs = require("fs");
const { compileFunc } = require("@ton-community/func-js");
const { Blockchain } = require("@ton/sandbox");
const { Cell, beginCell, toNano, contractAddress, Address } = require("@ton/core");
const src = (f) => fs.readFileSync("src/" + f, "utf8");
async function compile(main) {
  const r = await compileFunc({ targets: ["stdlib.fc", "params.fc", "op-codes.fc", main], sources: { "stdlib.fc": src("stdlib.fc"), "params.fc": src("params.fc"), "op-codes.fc": src("op-codes.fc"), [main]: src(main) } });
  if (r.status === "error") throw new Error(r.message);
  return Cell.fromBase64(r.codeBoc);
}
const DAY = 86400;
jest.setTimeout(120000);
test("Silk Road Passport: locked 30 days, then transferable; royalty 7%", async () => {
  const itemCode = await compile("nft-item.fc");
  const colCode = await compile("nft-collection-editable.fc");
  const chain = await Blockchain.create();
  chain.now = 1_800_000_000;
  const admin = await chain.treasury("admin"), alice = await chain.treasury("alice"), bob = await chain.treasury("bob"), stranger = await chain.treasury("stranger");
  const content = (s) => beginCell().storeUint(0, 8).storeBuffer(Buffer.from(s)).endCell();
  const collContent = beginCell().storeRef(content("https://x/collection.json")).storeRef(beginCell().storeBuffer(Buffer.from("https://x/silk/")).endCell()).endCell();
  const royalty = beginCell().storeUint(7, 16).storeUint(100, 16).storeAddress(admin.address).endCell();
  const data = beginCell().storeAddress(admin.address).storeUint(0, 64).storeRef(collContent).storeRef(itemCode).storeRef(royalty).endCell();
  const init = { code: colCode, data };
  const coll = contractAddress(0, init);
  await admin.send({ to: coll, value: toNano("0.05"), init, body: beginCell().endCell() });
  const rp = (await chain.runGetMethod(coll, "royalty_params")).stackReader;
  expect([rp.readNumber(), rp.readNumber()]).toEqual([7, 100]);

  async function mint(index, owner) {
    const itemContent = beginCell().storeBuffer(Buffer.from(index + ".json")).endCell();
    const nftContent = beginCell().storeAddress(owner).storeRef(itemContent).endCell();
    return admin.send({ to: coll, value: toNano("0.05"), body: beginCell().storeUint(1, 32).storeUint(0, 64).storeUint(index, 64).storeCoins(toNano("0.02")).storeRef(nftContent).endCell() });
  }
  const itemAddr = async (i) => (await chain.runGetMethod(coll, "get_nft_address_by_index", [{ type: "int", value: BigInt(i) }])).stackReader.readAddress();
  const owner = async (a) => { const r = (await chain.runGetMethod(a, "get_nft_data")).stackReader; r.readNumber(); r.readNumber(); r.readAddress(); return r.readAddress(); };
  const transfer = (from, item, to) => from.send({ to: item, value: toNano("0.05"), body: beginCell().storeUint(0x5fcc3d14, 32).storeUint(0, 64).storeAddress(to).storeAddress(from.address).storeBit(0).storeCoins(0).storeBit(0).endCell() });
  const exit = (r, a) => r.transactions.find((t) => t.inMessage?.info.dest?.equals?.(a))?.description.computePhase?.exitCode;

  await mint(0, alice.address);
  const i0 = await itemAddr(0);
  expect((await owner(i0)).equals(alice.address)).toBe(true);
  expect(await (async () => Number((await chain.runGetMethod(i0, "get_unlock_at")).stackReader.readBigNumber()))()).toBe(1_800_000_000 + 30 * DAY);

  // day 0 and day 29: the owner cannot move it, nor can anyone else
  expect(exit(await transfer(alice, i0, bob.address), i0)).toBe(413);
  chain.now += 29 * DAY;
  expect(exit(await transfer(alice, i0, bob.address), i0)).toBe(413);
  expect((await owner(i0)).equals(alice.address)).toBe(true);
  // day 30: a stranger still cannot, the owner can
  chain.now += DAY;
  expect(exit(await transfer(stranger, i0, bob.address), i0)).toBe(401);
  expect(exit(await transfer(alice, i0, bob.address), i0)).toBe(0);
  expect((await owner(i0)).equals(bob.address)).toBe(true);
  // the new owner can pass it on again, and can retire it to the dead address (the Legend stage)
  const dead = Address.parseRaw("0:" + "0".repeat(64));
  expect(exit(await transfer(bob, i0, dead), i0)).toBe(0);
  expect((await owner(i0)).equals(dead)).toBe(true);
  // a later mint gets its own, fresh lock
  await mint(1, bob.address);
  const i1 = await itemAddr(1);
  expect(exit(await transfer(bob, i1, alice.address), i1)).toBe(413);
  // only the issuer can mint
  const r = await stranger.send({ to: coll, value: toNano("0.05"), body: beginCell().storeUint(1, 32).storeUint(0, 64).storeUint(2, 64).storeCoins(toNano("0.02")).storeRef(beginCell().storeAddress(stranger.address).storeRef(content("2.json")).endCell()).endCell() });
  expect(r.transactions.some((t) => t.description.computePhase?.exitCode === 401)).toBe(true);
});
