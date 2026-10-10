import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Address, beginCell, Cell, Dictionary, toNano } from "@ton/core";
import { AtharCollection } from "../build/athar_AtharCollection";
import { AtharItem } from "../build/athar_AtharItem";
import { AtharMinter } from "../build/athar_AtharMinter";
import { indexOf } from "../lib/rules";

export const DELAY = 3600;
export const S1_START = indexOf(2000, 1, 1);
export const S1_END = indexOf(2007, 12, 31);

export async function setup(delay = DELAY) {
  const bc = await Blockchain.create();
  bc.now = 1_800_000_000;
  const admin = await bc.treasury("admin");
  const payout = await bc.treasury("payout");
  const alice = await bc.treasury("alice");
  const bob = await bc.treasury("bob");
  const collection = bc.openContract(await AtharCollection.fromInit(admin.address, "https://athar.test/collection.json", BigInt(delay)));
  const dep = await collection.send(admin.getSender(), { value: toNano("0.5") }, { $$type: "ProposePayout", payout: payout.address });
  expect(dep.transactions).toHaveTransaction({ from: admin.address, to: collection.address, success: true, deploy: true });
  await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeBaseUri", uri: "https://athar.test/m/" });
  const minter = bc.openContract(await AtharMinter.fromInit(collection.address, admin.address, 1n, BigInt(S1_START), BigInt(S1_END)));
  return { bc, admin, payout, alice, bob, collection, minter };
}

export const ID = (kind: number, date: number) => BigInt(kind * 65536 + date);
export const CURVES = [
  { startPrice: "0.5", floor: "0.25", cap: "8", maxSupply: 36525, specialFee: "1", photoFee: "0.15", walletMax: 0 },
  { startPrice: "1.5", floor: "0.75", cap: "24", maxSupply: 900, specialFee: "3", photoFee: "0.3", walletMax: 0 },
  { startPrice: "5", floor: "2.5", cap: "80", maxSupply: 300, specialFee: "10", photoFee: "0.6", walletMax: 0 },
];
export const CLASS_CAPS = [100, 80, 60, 40, 10];       // bronze, rare, purple, diamond, legendary

export async function configureKinds(ctx: Awaited<ReturnType<typeof setup>>) {
  const { admin, minter } = ctx;
  for (let k = 0; k < 3; k++) {
    const c = CURVES[k];
    await minter.send(admin.getSender(), { value: toNano("0.1") }, {
      $$type: "Configure", kind: BigInt(k), startPrice: toNano(c.startPrice), floor: toNano(c.floor), cap: toNano(c.cap), bumpBps: 16n, decayBps: 1500n,
      maxSupply: BigInt(c.maxSupply), specialFee: toNano(c.specialFee), photoFee: toNano(c.photoFee), walletMax: BigInt(c.walletMax) });
  }
  for (let k = 3; k < 8; k++) await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "SetCap", kind: BigInt(k), cap: BigInt(CLASS_CAPS[k - 3]) });
}

export async function openSeason(ctx: Awaited<ReturnType<typeof setup>>, opts?: { walletCap?: number; start?: number }) {
  const { bc, admin, collection, minter } = ctx;
  await configureKinds(ctx);
  await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Open", startAt: BigInt(opts?.start ?? bc.now!), walletDailyCap: BigInt(opts?.walletCap ?? 0) });
  await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeMinter", minter: minter.address });
  bc.now = bc.now! + 1;     // the first minter needs no waiting
}

export async function itemOf(ctx: Awaited<ReturnType<typeof setup>>, index: number): Promise<SandboxContract<AtharItem>> {
  const addr = await ctx.collection.getGetNftAddressByIndex(BigInt(index));
  return ctx.bc.openContract(AtharItem.fromAddress(addr));
}
