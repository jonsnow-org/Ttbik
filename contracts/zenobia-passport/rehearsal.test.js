const fs = require("fs");
const { compileFunc } = require("@ton-community/func-js");
const { Blockchain } = require("@ton/sandbox");
const { Cell, beginCell, Address, toNano, Dictionary } = require("@ton/core");

const src = (f) => fs.readFileSync("src/" + f, "utf8");
async function compile(main) {
  const r = await compileFunc({ targets: ["stdlib.fc", "params.fc", "op-codes.fc", main], sources: { "stdlib.fc": src("stdlib.fc"), "params.fc": src("params.fc"), "op-codes.fc": src("op-codes.fc"), [main]: src(main) } });
  if (r.status === "error") throw new Error(r.message);
  return Cell.fromBase64(r.codeBoc);
}
const str = (s) => beginCell().storeBuffer(Buffer.from(s)).endCell();
const content = (s) => beginCell().storeUint(0, 8).storeBuffer(Buffer.from(s)).endCell();

jest.setTimeout(120000);
test("caravan passport rehearsal (local emulator, no money)", async () => {
  const itemCode = await compile("sbt-item.fc");
  const colCode = await compile("nft-collection-editable.fc");
  const chain = await Blockchain.create();
  const admin = await chain.treasury("admin");
  const alice = await chain.treasury("alice");
  const bob = await chain.treasury("bob");

  const collContent = beginCell().storeRef(content("https://ttbik.vercel.app/api/zenobia/collection.json")).storeRef(str("https://ttbik.vercel.app/api/zenobia/passport/")).endCell();
  const royalty = beginCell().storeUint(0, 16).storeUint(100, 16).storeAddress(admin.address).endCell();
  const data = beginCell().storeAddress(admin.address).storeUint(0, 64).storeRef(collContent).storeRef(itemCode).storeRef(royalty).endCell();
  const init = { code: colCode, data };
  const collAddr = require("@ton/core").contractAddress(0, init);
  const dep = await admin.send({ to: collAddr, value: toNano("0.05"), init, body: beginCell().endCell() });
  const collState = await chain.getContract(collAddr);
  expect(collState.accountState.type).toBe("active");

  async function mint(index, owner) {
    const itemContent = beginCell().storeBuffer(Buffer.from(index + ".json")).endCell();
    const nftContent = beginCell().storeAddress(owner).storeRef(itemContent).storeAddress(null).endCell(); // no authority: nobody can revoke
    const body = beginCell().storeUint(1, 32).storeUint(0, 64).storeUint(index, 64).storeCoins(toNano("0.02")).storeRef(nftContent).endCell();
    return admin.send({ to: collAddr, value: toNano("0.05"), body });
  }
  const itemAddr = async (i) => (await chain.runGetMethod(collAddr, "get_nft_address_by_index", [{ type: "int", value: BigInt(i) }])).stackReader.readAddress();

  await mint(0, alice.address);
  const a0 = await itemAddr(0);
  const st = await chain.getContract(a0);
  expect(st.accountState.type).toBe("active");
  const d = (await chain.runGetMethod(a0, "get_nft_data")).stackReader;
  expect(d.readNumber()).toBe(-1); // inited
  expect(d.readNumber()).toBe(0);  // index
  d.readAddress();                  // collection
  expect(d.readAddress().equals(alice.address)).toBe(true);
  console.log("minted passport 0 for alice; item balance:", Number(st.balance) / 1e9, "TON");

  // metadata the wallet will fetch: tag 1 + common prefix, with the item's own "0.json"
  const full = (await chain.runGetMethod(collAddr, "get_nft_content", [{ type: "int", value: 0n }, { type: "cell", cell: beginCell().storeBuffer(Buffer.from("0.json")).endCell() }])).stackReader.readCell();
  const sl = full.beginParse();
  expect(sl.loadUint(8)).toBe(1);
  expect(sl.loadBuffer(sl.remainingBits / 8).toString()).toBe("https://ttbik.vercel.app/api/zenobia/passport/");

  // 1. transfer must fail (non-transferable)
  const tx = await alice.send({ to: a0, value: toNano("0.05"), body: beginCell().storeUint(0x5fcc3d14, 32).storeUint(0, 64).storeAddress(bob.address).storeAddress(alice.address).storeBit(0).storeCoins(0).storeBit(0).endCell() });
  const failed = tx.transactions.find((t) => t.inMessage?.info.dest?.equals?.(a0));
  expect(failed.description.computePhase.exitCode).toBe(413);
  const still = (await chain.runGetMethod(a0, "get_nft_data")).stackReader; still.readNumber(); still.readNumber(); still.readAddress();
  expect(still.readAddress().equals(alice.address)).toBe(true);
  console.log("transfer rejected with exit 413: OK");

  // 2. a stranger cannot destroy it
  const bad = await bob.send({ to: a0, value: toNano("0.05"), body: beginCell().storeUint(0x1f04537a, 32).storeUint(0, 64).endCell() });
  expect(bad.transactions.find((t) => t.inMessage?.info.dest?.equals?.(a0)).description.computePhase.exitCode).toBe(401);

  // 3. the issuer cannot revoke (no authority set)
  const rv = await admin.send({ to: a0, value: toNano("0.05"), body: beginCell().storeUint(0x6f89f5e3, 32).storeUint(0, 64).endCell() });
  expect(rv.transactions.find((t) => t.inMessage?.info.dest?.equals?.(a0)).description.computePhase.exitCode).toBe(401);
  console.log("stranger destroy and issuer revoke both rejected (401): OK");

  // 4. the holder burns it: owner becomes null -> Legend stage
  await alice.send({ to: a0, value: toNano("0.05"), body: beginCell().storeUint(0x1f04537a, 32).storeUint(0, 64).endCell() });
  const b = (await chain.runGetMethod(a0, "get_nft_data")).stackReader; b.readNumber(); b.readNumber(); b.readAddress();
  expect(b.readAddressOpt()).toBeNull();
  console.log("holder burn: owner is now null (detectable): OK");

  // 5. issuer changes the base URL of the collection (editable) without redeploying
  const newContent = beginCell().storeRef(content("https://example.org/c.json")).storeRef(str("https://example.org/p/")).endCell();
  await admin.send({ to: collAddr, value: toNano("0.05"), body: beginCell().storeUint(4, 32).storeUint(0, 64).storeRef(newContent).storeRef(royalty).endCell() });
  const full2 = (await chain.runGetMethod(collAddr, "get_nft_content", [{ type: "int", value: 0n }, { type: "cell", cell: beginCell().storeBuffer(Buffer.from("0.json")).endCell() }])).stackReader.readCell().beginParse();
  full2.loadUint(8);
  expect(full2.loadBuffer(full2.remainingBits / 8).toString()).toBe("https://example.org/p/");
  // 6. a stranger cannot change it
  const bad2 = await bob.send({ to: collAddr, value: toNano("0.05"), body: beginCell().storeUint(4, 32).storeUint(0, 64).storeRef(newContent).storeRef(royalty).endCell() });
  expect(bad2.transactions.find((t) => t.inMessage?.info.dest?.equals?.(collAddr)).description.computePhase.exitCode).toBe(401);
  console.log("issuer base-URL change works, stranger rejected: OK");
});
