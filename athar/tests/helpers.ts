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

export async function openSeason(ctx: Awaited<ReturnType<typeof setup>>, opts?: { walletCap?: number; start?: number }) {
  const { bc, admin, collection, minter } = ctx;
  const dep = await minter.send(admin.getSender(), { value: toNano("0.2") }, {
    $$type: "Configure", tier: 0n, startPrice: toNano("0.5"), floor: toNano("0.25"), cap: toNano("8"), bumpBps: 16n, decayBps: 1500n });
  expect(dep.transactions).toHaveTransaction({ to: minter.address, success: true, deploy: true });
  await minter.send(admin.getSender(), { value: toNano("0.05") }, {
    $$type: "Configure", tier: 1n, startPrice: toNano("3"), floor: toNano("1.5"), cap: toNano("40"), bumpBps: 200n, decayBps: 1500n });
  await minter.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "Open", startAt: BigInt(opts?.start ?? bc.now!), walletDailyCap: BigInt(opts?.walletCap ?? 0) });
  await collection.send(admin.getSender(), { value: toNano("0.05") }, { $$type: "ProposeMinter", minter: minter.address });
  bc.now = bc.now! + DELAY + 1;
}

export async function itemOf(ctx: Awaited<ReturnType<typeof setup>>, index: number): Promise<SandboxContract<AtharItem>> {
  const addr = await ctx.collection.getGetNftAddressByIndex(BigInt(index));
  return ctx.bc.openContract(AtharItem.fromAddress(addr));
}
