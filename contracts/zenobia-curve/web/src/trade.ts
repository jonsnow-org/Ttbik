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
let myBal = 0n;

const ui = new TonConnectUI({ manifestUrl: location.origin + '/zenobia/tonconnect-manifest.json', buttonRootId: 'connect', actionsConfiguration: { twaReturnUrl: 'https://t.me/PalmyraLaunchBot' as `${string}://${string}` } });
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
  myBal = bal;
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
      if (!v.src.endsWith(NAMES[stage] + '.mp4')) v.src = '/zenobia/znbt/art/' + NAMES[stage] + '.mp4';
      v.style.display = 'block';
      v.play().catch(() => {});
    } else {
      im.src = '/zenobia/' + EMBLEMS[stage] + '.svg';
      im.style.display = 'block';
    }
  }
}

const slip = () => Number((document.getElementById('slipSel') as HTMLSelectElement | null)?.value || 300);

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

async function loadFacts() {
  const box = $('facts');
  const row = (k: string, v: string | Node) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.append(v); box.append(dt, dd); };
  box.textContent = '';
  let coin: any = null;
  try {
    const j = await (await fetch('/api/zenobia/coins/index', { cache: 'no-store' })).json();
    coin = (j.coins || []).find((c: any) => c.curve === curve!.toString({ bounceable: true }) || Address.parse(c.curve).equals(curve!));
  } catch {}
  const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);
  const link = (a: string, t: string) => { const x = document.createElement('a'); x.href = 'https://tonviewer.com/' + a; x.target = '_blank'; x.rel = 'noopener'; x.textContent = t; return x; };
  if (coin) {
    row('Creator', link(coin.creator, short(coin.creator)));
    row('Created', new Date(coin.createdAt * 1000).toISOString().slice(0, 10));
    row('Supply', fmt(BigInt(coin.supply), 9, 0));
    row('Creator fee', (coin.creatorFeeBps / 100).toFixed(2).replace(/\.?0+$/, '') + '% per trade');
    if (coin.features) {
      const f = [coin.features.maxBuyBps ? 'Anti-whale: a single buy is capped at ' + coin.features.maxBuyBps / 100 + '% of the supply' : '', coin.features.buyback ? 'Buyback & burn: creator fees buy the coin back and burn it' : '', coin.features.split ? 'Creator fee is shared between several wallets' : ''].filter(Boolean);
      if (f.length) row('Features', f.join(' · '));
    }
  }
  row('Platform fee', '1.5% per trade');
  row('Contract', link(curve!.toString({ bounceable: true }), short(curve!.toString({ bounceable: true }))));
  row('Audit', 'None (experimental fork)');
}

$('copyLink').onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); say('Link copied.'); } catch { say(location.href); }
};
$('repSend').onclick = async () => {
  try {
    if (!curve) return;
    const r = await fetch('/api/zenobia/coins/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ curve: curve.toString({ bounceable: true }), reason: ($('repReason') as HTMLSelectElement).value, details: ($('repDetails') as HTMLInputElement).value }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'failed');
    say('Thank you. The platform owner will review your report.');
    ($('repDetails') as HTMLInputElement).value = '';
  } catch (e: any) { say('Error: ' + (e.message || e)); }
};

(async () => {
  const cfg = await loadConfig();
  const param = new URLSearchParams(location.search).get('c');
  const target = param || cfg.curve;
  if (!target) { $('pre').style.display = 'block'; $('app').style.display = 'none'; return; }
  try { curve = Address.parse(target); } catch { $('pre').style.display = 'block'; $('app').style.display = 'none'; return; }
  isZnbt = !!cfg.curve && Address.parse(cfg.curve).equals(curve);
  if (isZnbt) {
    ($('hero') as HTMLElement).style.display = 'block';
    ($('coinImg') as HTMLImageElement).src = '/api/zenobia/znbt/icon';   // the coin with its age badge
    ($('coinImg') as HTMLElement).style.display = 'block';
  }
  const hid = await hiddenSet();
  if (hid.has(curve.toString({ bounceable: true, urlSafe: true }))) $('hiddenNote').style.display = 'block';
  $('addr').textContent = curve.toString({ bounceable: true });
  ($('tgShare') as HTMLAnchorElement).href = 'https://t.me/share/url?url=' + encodeURIComponent(location.href);
  await loadMarket();
  await loadIdentity();
  loadFacts().catch(() => {});
  setInterval(() => loadMarket().catch(() => {}), 30000);
})().catch((e) => say('Error: ' + (e.message || e)));


// ---- extras: price chart, market stats, holders, quick amounts (read from our own index; nothing here moves money) ----
const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);
function chips(box: HTMLElement, items: [string, () => void][]) {
  const row = document.createElement('div');
  row.className = 'chips';
  row.style.margin = '2px 0 6px';
  for (const [t, f] of items) { const b = document.createElement('button'); b.className = 'chip'; b.textContent = t; b.onclick = f; row.append(b); }
  box.after(row);
}
function quickAmounts() {
  const buy = $('buyAmt') as HTMLInputElement;
  chips(buy, ['0.5', '1', '5', '10'].map((v) => [v + ' TON', () => { buy.value = v; }] as [string, () => void]));
  const sell = $('sellAmt') as HTMLInputElement;
  chips(sell, [25, 50, 75, 100].map((p) => [p + '%', () => { sell.value = fmtExact(myBal * BigInt(p) / 100n); }] as [string, () => void]));
  const sel = document.createElement('select');
  sel.id = 'slipSel'; sel.ariaLabel = 'Slippage';
  for (const [v, t] of [['100', 'Slippage 1%'], ['300', 'Slippage 3% (default)'], ['500', 'Slippage 5%']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === '300') o.selected = true; sel.append(o); }
  $('buy').before(sel);
}
const fmtExact = (n: bigint) => { const s = n.toString().padStart(10, '0'); const w = s.slice(0, -9), f = s.slice(-9).replace(/0+$/, ''); return f ? w + '.' + f : w; };

async function loadStats(curveStr: string) {
  try {
    const j = await (await fetch('/api/zenobia/coins/index', { cache: 'no-store' })).json();
    const c = (j.coins || []).find((x: any) => x.curve === curveStr || Address.parse(x.curve).equals(Address.parse(curveStr)));
    if (!c) return;
    const parts: string[] = [];
    if (c.mcTon) parts.push('Market cap ≈ ' + (c.mcTon >= 1000 ? (c.mcTon / 1000).toFixed(1) + 'K' : c.mcTon.toFixed(0)) + ' TON');
    if (typeof c.chg24 === 'number') parts.push('24h ' + (c.chg24 > 0 ? '+' : '') + c.chg24.toFixed(1) + '%');
    if (c.raised24 && BigInt(c.raised24) > 0n) parts.push('+' + fmt(BigInt(c.raised24), 9, 2) + ' TON raised in 24h');
    $('stat').textContent = parts.join(' · ');
  } catch {}
}
async function loadChart(curveStr: string) {
  const box = $('chartBox');
  try {
    const j = await (await fetch('/api/zenobia/coins/ticks?c=' + encodeURIComponent(curveStr) + '&days=7')).json();
    const pts = (j.ticks || []).map((t: any) => ({ ts: t.ts, p: Number(t.tpt) > 0 ? 1e9 / Number(t.tpt) : 0 })).filter((t: any) => t.p > 0);
    if (pts.length < 2) { box.textContent = 'The chart fills in as the coin trades.'; return; }
    const lo = Math.min(...pts.map((t: any) => t.p)), hi = Math.max(...pts.map((t: any) => t.p));
    const t0 = pts[0].ts, t1 = pts[pts.length - 1].ts, span = Math.max(1, hi - lo);
    const W = 300, H = 90;
    const xy = pts.map((t: any) => [((t.ts - t0) / Math.max(1, t1 - t0)) * W, H - 6 - ((t.p - lo) / span) * (H - 14)]);
    const line = xy.map((a: number[], i: number) => (i ? 'L' : 'M') + a[0].toFixed(1) + ' ' + a[1].toFixed(1)).join(' ');
    const up = pts[pts.length - 1].p >= pts[0].p;
    const col = up ? '#3ddc84' : '#ff5d5d';
    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:110px;display:block"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + col + '" stop-opacity=".35"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs><path d="' + line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="url(#g)"/><path d="' + line + '" fill="none" stroke="' + col + '" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="mut" style="display:flex;justify-content:space-between"><span>7d low ' + lo.toPrecision(3) + ' TON</span><span>high ' + hi.toPrecision(3) + ' TON</span></div>';
  } catch { box.textContent = ''; }
}
async function loadHolders(curveStr: string) {
  const box = $('holders');
  try {
    const j = await (await fetch('/api/zenobia/coins/holders?c=' + encodeURIComponent(curveStr))).json();
    if (!j.ok) { box.textContent = 'Holder data is not available right now.'; return; }
    box.textContent = '';
    const total = document.createElement('div');
    total.textContent = j.total + ' holders';
    box.append(total);
    let top = 0, creator = 0;
    j.holders.forEach((h: any, i: number) => {
      if (!h.isCurve && i < 10) top += h.bps;
      if (h.isCreator) creator += h.bps;
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid var(--line)';
      const a = document.createElement('a'); a.href = 'https://tonviewer.com/' + h.owner; a.target = '_blank'; a.rel = 'noopener'; a.textContent = (i + 1) + '. ' + short(h.owner) + (h.isCurve ? ' · bonding curve' : '') + (h.isCreator ? ' · creator' : '');
      const p = document.createElement('b'); p.textContent = (h.bps / 100).toFixed(2) + '%';
      r.append(a, p); box.append(r);
    });
    const note = document.createElement('div');
    note.className = 'mut'; note.style.marginTop = '8px';
    note.textContent = 'Creator holds ' + (creator / 100).toFixed(2) + '% of the supply. Top 10 wallets (without the curve) hold ' + (top / 100).toFixed(1) + '%.' + (top > 4000 ? ' ⚠️ Concentrated: a few wallets can move the price.' : '');
    box.append(note);
  } catch { box.textContent = ''; }
}
quickAmounts();
void (async () => {
  const cfg = await loadConfig();
  const param = new URLSearchParams(location.search).get('c');
  const t = param || cfg.curve;
  if (!t) return;
  let c: string; try { c = Address.parse(t).toString({ bounceable: true }); } catch { return; }
  void loadStats(c); void loadChart(c); void loadHolders(c);
})();
