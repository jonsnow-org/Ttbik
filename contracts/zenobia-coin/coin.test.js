const fs = require("fs");
const { compileFunc } = require("@ton-community/func-js");
const { Blockchain } = require("@ton/sandbox");
const { Cell, beginCell, Address, toNano, contractAddress, Dictionary } = require("@ton/core");
const { sha256_sync } = require("@ton/crypto");
const src = (f) => fs.readFileSync("src/" + f, "utf8");
const FILES = ["stdlib.fc", "params.fc", "op-codes.fc", "jetton-utils.fc", "discovery-params.fc"];
async function compile(main) {
  const sources = {}; for (const f of [...FILES, main]) sources[f] = src(f);
  const r = await compileFunc({ targets: [...FILES, main], sources });
  if (r.status === "error") throw new Error(r.message);
  return Cell.fromBase64(r.codeBoc);
}
const DAY = 86400;
jest.setTimeout(180000);
test("ZNB coin: standard jetton behaviour + on-chain journey", async () => {
  const walletCode = await compile("jetton-wallet.fc");
  const minterCode = await compile("jetton-minter.fc");
  const chain = await Blockchain.create();
  chain.now = 1_800_000_000;
  const admin = await chain.treasury("admin"), alice = await chain.treasury("alice"), bob = await chain.treasury("bob");
  const key = (k) => BigInt("0x" + sha256_sync(k).toString("hex"));
  const dict = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
  const val = (s) => beginCell().storeUint(0, 8).storeStringTail(s).endCell();
  dict.set(key("name"), val("Zenobia")); dict.set(key("symbol"), val("ZNB")); dict.set(key("decimals"), val("9"));
  const content = beginCell().storeUint(0, 8).storeDict(dict).endCell();
  const data = beginCell().storeCoins(0).storeAddress(admin.address).storeRef(content).storeRef(walletCode).endCell();
  const init = { code: minterCode, data };
  const minter = contractAddress(0, init);
  await admin.send({ to: minter, value: toNano("0.1"), init, body: beginCell().endCell() });

  const SUPPLY = toNano("1000000000");
  const mintBody = (to, amount) => beginCell().storeUint(21, 32).storeUint(0, 64).storeAddress(to).storeCoins(toNano("0.05"))
    .storeRef(beginCell().storeUint(0x178d4519, 32).storeUint(0, 64).storeCoins(amount).storeAddress(null).storeAddress(admin.address).storeCoins(0).storeUint(0, 1).endCell()).endCell();
  let r = await admin.send({ to: minter, value: toNano("0.2"), body: mintBody(admin.address, SUPPLY) });
  const walletOf = async (o) => (await chain.runGetMethod(minter, "get_wallet_address", [{ type: "slice", cell: beginCell().storeAddress(o).endCell() }])).stackReader.readAddress();
  const bal = async (o) => { const w = await walletOf(o); const st = await chain.getContract(w); if (st.accountState?.type !== "active") return 0n; return (await chain.runGetMethod(w, "get_wallet_data")).stackReader.readBigNumber(); };
  const journey = async (o) => { const s = (await chain.runGetMethod(await walletOf(o), "get_journey")).stackReader; return { stage: s.readNumber(), since: s.readNumber(), days: s.readNumber(), mark: s.readNumber() }; };
  expect(await bal(admin.address)).toBe(SUPPLY);
  expect((await chain.runGetMethod(minter, "get_jetton_data")).stackReader.readBigNumber()).toBe(SUPPLY);

  // a second mint is refused forever
  r = await admin.send({ to: minter, value: toNano("0.2"), body: mintBody(alice.address, 1n) });
  expect(r.transactions.some((t) => t.description.computePhase?.exitCode === 75)).toBe(true);
  // content cannot be changed (op 4 has no handler)
  r = await admin.send({ to: minter, value: toNano("0.05"), body: beginCell().storeUint(4, 32).storeUint(0, 64).storeRef(content).endCell() });
  expect(r.transactions.some((t) => t.description.computePhase?.exitCode === 0xffff)).toBe(true);

  async function send(fromTreasury, to, amount) {
    const w = await walletOf(fromTreasury.address);
    const body = beginCell().storeUint(0xf8a7ea5, 32).storeUint(0, 64).storeCoins(amount).storeAddress(to).storeAddress(fromTreasury.address).storeUint(0, 1).storeCoins(0).storeUint(0, 1).endCell();
    return fromTreasury.send({ to: w, value: toNano("0.1"), body });
  }
  // nobody holds yet
  expect((await journey(admin.address)).stage).toBe(1); // the issuer's own wallet started at mint
  await send(admin, alice.address, toNano("1000"));
  expect(await bal(alice.address)).toBe(toNano("1000"));
  expect(await bal(admin.address)).toBe(SUPPLY - toNano("1000"));
  let j = await journey(alice.address);
  expect(j.stage).toBe(1); expect(j.since).toBe(1_800_000_000);

  chain.now += 8 * DAY; j = await journey(alice.address); expect(j.stage).toBe(2); expect(j.days).toBe(8);
  chain.now += 14 * DAY; j = await journey(alice.address); expect(j.stage).toBe(3);

  // partial sell keeps the clock; selling everything stops it (captive)
  await send(alice, bob.address, toNano("400"));
  j = await journey(alice.address); expect(j.stage).toBe(3);
  await send(alice, bob.address, toNano("600"));
  expect(await bal(alice.address)).toBe(0n);
  j = await journey(alice.address); expect(j.stage).toBe(4);
  expect(await bal(bob.address)).toBe(toNano("1000"));
  expect((await journey(bob.address)).stage).toBe(1); // bob's clock began now

  // coming back restarts as a child
  chain.now += DAY; await send(bob, alice.address, toNano("5"));
  j = await journey(alice.address); expect(j.stage).toBe(1);

  // burning everything = legend
  const wb = await walletOf(bob.address);
  await bob.send({ to: wb, value: toNano("0.1"), body: beginCell().storeUint(0x595f07bc, 32).storeUint(0, 64).storeCoins(toNano("995")).storeAddress(bob.address).endCell() });
  expect(await bal(bob.address)).toBe(0n);
  expect((await journey(bob.address)).stage).toBe(5);
  expect((await chain.runGetMethod(minter, "get_jetton_data")).stackReader.readBigNumber()).toBe(SUPPLY - toNano("995"));

  // a stranger cannot move someone else's coins
  const w = await walletOf(alice.address);
  r = await bob.send({ to: w, value: toNano("0.1"), body: beginCell().storeUint(0xf8a7ea5, 32).storeUint(0, 64).storeCoins(1n).storeAddress(bob.address).storeAddress(bob.address).storeUint(0, 1).storeCoins(0).storeUint(0, 1).endCell() });
  expect(r.transactions.some((t) => t.description.computePhase?.exitCode === 705)).toBe(true);
});
