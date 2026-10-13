import { Address, TupleReader } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { toTonConnect, flushCreatorFees, claimFees } from '../../sdk/dist/index.js';
import { client, sdk, $, loadConfig, retry, fmt, parseUnits } from './common';
import { readMeta, hiddenSet } from './registry';

const STAGES = ['No journey yet', 'Child · طفل', 'Queen · ملكة', 'Warrior · محارب', 'Captive · أسير', 'Legend · أسطورة'];
const NAMES = ['', 'stage-1-child', 'stage-2-queen', 'stage-3-warrior', 'stage-4-captive', 'stage-5-legend'];
const EMBLEMS = ['', 'emblem-1-child', 'emblem-2-queen', 'emblem-3-warrior', 'emblem-4-captive', 'emblem-5-legend'];
let curve: Address | null = null;
let minter: Address | null = null;
let me: Address | null = null;
let thresholdTon = 1000n * 1_000_000_000n;
let isZnbt = false;

const ui = new TonConnectUI({ manifestUrl: 'https://ttbik.vercel.app/zenobia/tonconnect-manifest.json', buttonRootId: 'connect' });
const say = (m: string) => ($('log').textContent = m);
const send = (tx: any) => ui.sendTransaction(toTonConnect(tx, { validUntil: Math.floor(Date.now() / 1000) + 300, network: '-239' }));

async function loadMarket() {
  if (!curve) return;
  const d = await retry(() => sdk.getCurveData(curve!));
  minter = d.jettonMinter ?? null;
  const raised = d.realTonReserve;
  const pct = Number((raised * 10000n) / thresholdTon) / 100;
  $('raised').textContent = fmt(raised, 9, 2) + ' / ' + fmt(thresholdTon, 9, 0) + ' TON (' + Math.min(pct, 100).toFixed(1) + '%)';
  ($('bar') as HTMLElement).style.width = Math.min(pct, 100) + '%';
  const status = await retry(() => sdk.getLaunchStatus(curve!));
  $('status').textContent = status === 1n ? 'Trading on the curve' : status >= 2n ? 'Graduated: trade on DeDust' : 'Starting…';
  const q = await retry(() => sdk.quoteBuy(curve!, 1_000_000_000n));
  $('price').textContent = '1 TON ≈ ' + fmt(q, 9, 0) + ' ' + $('sym').textContent;
}

async function loadIdentity() {
  if (!minter) return;
  try {
    const jd = await retry(() => sdk.minter(minter!).getJettonData());
    const meta = readMeta(jd.jettonContent as any);
    if (meta.name) { $('title').textContent = meta.name + ' · ' + meta.symbol; document.title = meta.symbol + ' · Zenobia platform'; }
    if (meta.symbol) $('sym').textContent = meta.symbol;
    if (meta.description) $('desc').textContent = meta.description;
    if (!isZnbt && meta.image) { const i = $('coinImg') as HTMLImageElement; i.referrerPolicy = 'no-referrer'; i.src = meta.image; i.style.display = 'block'; }
    const th = (await retry(() => sdk.getCurveData(curve!)));
    void th;
  } catch {}
}

async function loadMe() {
  if (!me || !minter) return;
  const w = await retry(() => sdk.minter(minter!).getWalletAddress(me!));
  let bal = 0n;
  try { bal = (await retry(() => sdk.wallet(w).getWalletData())).jettonBalance; } catch {}
  $('balance').textContent = fmt(bal, 9, 2) + ' ' + $('sym').textContent;
  const v = $('stageVideo') as HTMLVideoElement;
  const im = $('stageImg') as HTMLImageElement;
  v.style.display = im.style.display = 'none';
  let stage = 0;
  try {
    const r = await client.provider(w).get('get_journey', []);
    const t: TupleReader = r.stack;
    stage = t.readNumber();
    t.readNumber();
    const days = t.readNumber();
    $('stage').textContent = STAGES[stage] + (stage >= 1 && stage <= 3 ? ' · day ' + days : '');
  } catch { $('stage').textContent = STAGES[0]; }
  $('stageNote').textContent = stage === 1 ? 'Queen at day 7, Warrior at day 21.' : stage === 4 ? 'You sold everything. Buy again to start a new journey.' : '';
  if (stage >= 1) {
    if (isZnbt) {
      if (!v.src.endsWith(NAMES[stage] + '.mp4')) v.src = '/zenobia/anim/' + NAMES[stage] + '.mp4';
      v.style.display = 'block';
      v.play().catch(() => {});
    } else {
      im.src = '/zenobia/' + EMBLEMS[stage] + '.svg';
      im.style.display = 'block';
    }
  }
}

const slip = () => 300;

$('buy').onclick = async () => {
  try {
    if (!curve || !me) throw new Error('Connect your wallet first');
    const ton = parseUnits(($('buyAmt') as HTMLInputElement).value);
    if (ton < 100_000_000n) throw new Error('Minimum 0.1 TON');
    const { transaction } = await sdk.prepareBuy(curve, ton, slip());
    await send(transaction);
    say('Buy sent. Your balance updates in about a minute.');
    setTimeout(() => loadMe().catch(() => {}), 45000);
  } catch (e: any) { say('Error: ' + (e.message || e)); }
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
  } catch (e: any) { say('Error: ' + (e.message || e)); }
};

$('flush').onclick = async () => {
  try {
    if (!curve || !me) throw new Error('Connect your wallet first');
    await send(flushCreatorFees(curve));
    say('Step 1 sent. Wait about a minute, then press step 2.');
  } catch (e: any) { say('Error: ' + (e.message || e)); }
};
$('claim').onclick = async () => {
  try {
    if (!curve || !me) throw new Error('Connect your wallet first');
    const splitter = await sdk.getFeeManagerAddress(curve);
    await send(claimFees(splitter, false));
    say('Step 2 sent. Your creator fees arrive in about a minute.');
  } catch (e: any) { say('Error: ' + (e.message || e)); }
};

ui.onStatusChange(() => {
  me = ui.account ? Address.parse(ui.account.address) : null;
  loadMe().catch(() => {});
});

(async () => {
  const cfg = await loadConfig();
  const param = new URLSearchParams(location.search).get('c');
  const target = param || cfg.curve;
  if (!target) { $('pre').style.display = 'block'; $('app').style.display = 'none'; return; }
  try { curve = Address.parse(target); } catch { $('pre').style.display = 'block'; $('app').style.display = 'none'; return; }
  isZnbt = !!cfg.curve && Address.parse(cfg.curve).equals(curve);
  if (isZnbt) {
    ($('hero') as HTMLElement).style.display = 'block';
    ($('coinImg') as HTMLImageElement).src = '/zenobia/znbt-coin.webp';
    ($('coinImg') as HTMLElement).style.display = 'block';
  }
  const hid = await hiddenSet();
  if (hid.has(curve.toString({ bounceable: true, urlSafe: true }))) $('hiddenNote').style.display = 'block';
  $('addr').textContent = curve.toString({ bounceable: true });
  await loadMarket();
  await loadIdentity();
  setInterval(() => loadMarket().catch(() => {}), 30000);
})().catch((e) => say('Error: ' + (e.message || e)));
