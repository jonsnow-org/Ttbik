import { Address, TupleReader } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { toTonConnect } from '../../sdk/dist/index.js';
import { client, sdk, $, loadConfig, retry, fmt, parseUnits } from './common';

const THRESHOLD = 1000n * 1_000_000_000n;
const STAGES = ['No journey yet', 'Child · طفل', 'Queen · ملكة', 'Warrior · محارب', 'Captive · أسير', 'Legend · أسطورة'];
let curve: Address | null = null;
let minter: Address | null = null;
let me: Address | null = null;

const ui = new TonConnectUI({
  manifestUrl: 'https://ttbik.vercel.app/zenobia/tonconnect-manifest.json',
  buttonRootId: 'connect',
});
const say = (m: string) => ($('log').textContent = m);
const send = (tx: any) =>
  ui.sendTransaction(toTonConnect(tx, { validUntil: Math.floor(Date.now() / 1000) + 300, network: '-239' }));

async function loadMarket() {
  if (!curve) return;
  const d = await retry(() => sdk.getCurveData(curve!));
  minter = d.jettonMinter ?? null;
  const raised = d.realTonReserve;
  const pct = Number((raised * 10000n) / THRESHOLD) / 100;
  $('raised').textContent = fmt(raised, 9, 2) + ' / 1,000 TON (' + Math.min(pct, 100).toFixed(1) + '%)';
  ($('bar') as HTMLElement).style.width = Math.min(pct, 100) + '%';
  const status = await retry(() => sdk.getLaunchStatus(curve!));
  $('status').textContent =
    status === 1n ? 'Trading on the curve' : status >= 2n ? 'Graduated: trade on DeDust' : 'Starting…';
  const q = await retry(() => sdk.quoteBuy(curve!, 1_000_000_000n));
  $('price').textContent = '1 TON ≈ ' + fmt(q, 9, 0) + ' ZNBt';
}

async function loadMe() {
  if (!me || !minter) return;
  const w = await retry(() => sdk.minter(minter!).getWalletAddress(me!));
  let bal = 0n;
  try {
    bal = (await retry(() => sdk.wallet(w).getWalletData())).jettonBalance;
  } catch {}
  $('balance').textContent = fmt(bal, 9, 2) + ' ZNBt';
  try {
    const r = await client.provider(w).get('get_journey', []);
    const t: TupleReader = r.stack;
    const stage = t.readNumber();
    const since = t.readNumber();
    const days = t.readNumber();
    $('stage').textContent = STAGES[stage] + (stage >= 1 && stage <= 3 ? ' · day ' + days : '');
    $('stageNote').textContent =
      stage === 1 ? 'Queen at day 7, Warrior at day 21.' : stage === 4 ? 'You sold everything. Buy again to start a new journey.' : '';
  } catch {
    $('stage').textContent = STAGES[0];
  }
}

function slip() {
  return 300;
}

$('buy').onclick = async () => {
  try {
    if (!curve || !me) throw new Error('Connect your wallet first');
    const ton = parseUnits(($('buyAmt') as HTMLInputElement).value);
    if (ton < 100_000_000n) throw new Error('Minimum 0.1 TON');
    const { transaction } = await sdk.prepareBuy(curve, ton, slip());
    await send(transaction);
    say('Buy sent. Your balance updates in about a minute.');
    setTimeout(() => loadMe().catch(() => {}), 45000);
  } catch (e: any) {
    say('Error: ' + (e.message || e));
  }
};

$('sell').onclick = async () => {
  try {
    if (!curve || !me) throw new Error('Connect your wallet first');
    let amt = parseUnits(($('sellAmt') as HTMLInputElement).value);
    const max = await sdk.getMaxSafeSell(curve);
    if (amt > max) amt = max;
    const { transaction } = await sdk.prepareSell(curve, me, amt, slip());
    await send(transaction);
    say('Sell sent. TON arrives in about a minute.');
    setTimeout(() => loadMe().catch(() => {}), 45000);
  } catch (e: any) {
    say('Error: ' + (e.message || e));
  }
};

ui.onStatusChange(() => {
  me = ui.account ? Address.parse(ui.account.address) : null;
  loadMe().catch(() => {});
});

(async () => {
  const cfg = await loadConfig();
  if (!cfg.curve) {
    $('pre').style.display = 'block';
    $('app').style.display = 'none';
    return;
  }
  curve = Address.parse(cfg.curve);
  $('addr').textContent = cfg.curve;
  await loadMarket();
  setInterval(() => loadMarket().catch(() => {}), 30000);
})().catch((e) => say('Error: ' + (e.message || e)));
