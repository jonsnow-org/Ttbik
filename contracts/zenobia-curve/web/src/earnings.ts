// "Earnings": everything a creator (and the platform owner) can collect, in one button. The wallet signs twice: first the fees are moved out of the coins,
// then (after the chain has settled, found by polling) they are sent to the wallet. Nothing here can send money anywhere but to the connected wallet.
import { Address } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { toTonConnect, flushFees, flushCreatorFees, claimFees, withdrawProtocolFees } from '../../sdk/dist/index.js';
import { sdk, OWNER, $, loadConfig, retry, fmt, sleep } from './common';

const ui = new TonConnectUI({ manifestUrl: location.origin + '/zenobia/tonconnect-manifest.json', buttonRootId: 'connect' });
const say = (m: string) => ($('log').textContent = m);
type Row = { curve: string; creator: string; name: string; symbol: string };
type Found = { coin: Row; creator: boolean; accrued: bigint; splitter: Address | null; claimable: bigint };
let master: Address;
let found: Found[] = [];
let masterFees = 0n;
let isOwner = false;
let busy = false;

const wallet = () => (ui.account ? Address.parse(ui.account.address) : null);
const exp = () => Math.floor(Date.now() / 1000) + 600;
async function send(txs: any[]) {
  for (let i = 0; i < txs.length; i += 4) {   // most wallets accept a few messages per confirmation
    const chunk = txs.slice(i, i + 4).map((t) => toTonConnect(t, { validUntil: exp(), network: '-239' }));
    await ui.sendTransaction({ ...chunk[0], messages: chunk.flatMap((c) => c.messages) });
  }
}

async function scan() {
  const w = wallet();
  const box = $('summary');
  box.textContent = '';
  found = []; masterFees = 0n; isOwner = false;
  if (!w) { box.textContent = 'Connect your wallet to see what you can collect.'; ($('collect') as HTMLButtonElement).disabled = true; return; }
  isOwner = w.equals(OWNER);
  say('Reading the chain…');
  const idx = await (await fetch('/api/zenobia/coins/index', { cache: 'no-store' })).json();
  const rows: Row[] = idx.coins || [];
  const mine = rows.filter((c) => { try { return Address.parse(c.creator).equals(w); } catch { return false; } });
  const targets = isOwner ? rows : mine;
  for (const c of targets.slice(0, 12)) {
    const curve = Address.parse(c.curve);
    const d = await retry(() => sdk.getCurveData(curve));
    const creator = mine.includes(c);
    let splitter: Address | null = null, claimable = 0n;
    if (creator) {
      try { splitter = await retry(() => sdk.getFeeManagerAddress(curve)); claimable = (await retry(() => sdk.getFeeBalance(splitter!, w, false))).tonAmount; } catch {}
    }
    found.push({ coin: c, creator, accrued: d.feeAccrued, splitter, claimable });
  }
  if (isOwner) { try { masterFees = (await retry(() => sdk.master(master).getMasterData())).feesBalance; } catch {} }
  render();
  say('');
}

function render() {
  const box = $('summary');
  box.textContent = '';
  const line = (k: string, v: string) => { const r = document.createElement('div'); r.style.cssText = 'display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-top:1px solid var(--line)'; const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; r.append(a, b); box.append(r); };
  let waiting = 0n, claimable = 0n;
  for (const f of found) { waiting += f.accrued; claimable += f.claimable; }
  if (!found.length && !isOwner) { box.textContent = 'This wallet has not launched a coin here yet.'; ($('collect') as HTMLButtonElement).disabled = true; return; }
  line('Fees waiting inside your coins', fmt(waiting, 9, 3) + ' TON');
  line('Ready to claim (creator fees)', fmt(claimable, 9, 3) + ' TON');
  if (isOwner) line('Platform fees in the master', fmt(masterFees, 9, 3) + ' TON');
  for (const f of found) line('· ' + (f.coin.symbol || f.coin.name), fmt(f.accrued, 9, 3) + ' waiting · ' + fmt(f.claimable, 9, 3) + ' claimable');
  ($('collect') as HTMLButtonElement).disabled = false;
}

async function collect() {
  if (busy) return;
  busy = true;
  try {
    const w = wallet();
    if (!w) throw new Error('Connect your wallet first');
    await scan();
    const step1: any[] = [];
    for (const f of found) {
      if (f.accrued <= 0n) continue;
      const curve = Address.parse(f.coin.curve);
      if (isOwner) step1.push(flushFees(curve));          // platform fees to the master
      if (f.creator) step1.push(flushCreatorFees(curve)); // creator fees to the claim box
    }
    const before = { master: masterFees, claim: found.reduce((a, f) => a + f.claimable, 0n) };
    if (step1.length) {
      say('Step 1 of 2: confirm in your wallet to move the fees out of your coins…');
      await send(step1);
      say('Waiting for the chain (about a minute)…');
      for (let i = 0; i < 12; i++) {
        await sleep(15000);
        await scan();
        if (masterFees > before.master || found.reduce((a, f) => a + f.claimable, 0n) > before.claim) break;
      }
    }
    const step2: any[] = [];
    if (isOwner && masterFees > 0n) step2.push(withdrawProtocolFees(master, masterFees));
    for (const f of found) if (f.creator && f.splitter && f.claimable > 0n) step2.push(claimFees(f.splitter, false));
    if (!step2.length) { say('Nothing to collect yet. Fees appear here as people trade your coins.'); return; }
    say('Step 2 of 2: confirm to send everything to your wallet…');
    await send(step2);
    say('Done. The TON arrives in your wallet in about a minute.');
    setTimeout(() => { void scan(); }, 60000);
  } catch (e: any) { say('Error: ' + (e.message || e)); }
  finally { busy = false; }
}

$('collect').onclick = collect;
ui.onStatusChange(() => { void scan().catch((e) => say('Error: ' + (e.message || e))); });
void (async () => { master = Address.parse((await loadConfig()).master); await scan(); })().catch((e) => say('Error: ' + (e.message || e)));
