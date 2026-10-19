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
let opened = false;
let creatorAddr = '';

const ui = new TonConnectUI({ manifestUrl: location.origin + '/zenobia/tonconnect-manifest.json', buttonRootId: 'connect', actionsConfiguration: { twaReturnUrl: 'https://t.me/PalmyraLaunchBot' as `${string}://${string}` } });
const say = (m: string) => ($('log').textContent = m);
const send = (tx: any) => ui.sendTransaction(toTonConnect(tx, { validUntil: Math.floor(Date.now() / 1000) + 300, network: '-239' }));

async function loadMarket() {
  if (!curve) return;
  const d = await retry(() => sdk.getCurveData(curve!));
  minter = d.jettonMinter ?? null;
  const raised = d.realTonReserve;
  setCurveState(d);
  const pct = Number((raised * 10000n) / thresholdTon) / 100;
  $('raised').textContent = fmt(raised, 9, 2) + ' / ' + fmt(thresholdTon, 9, 0) + ' GRAM (' + Math.min(pct, 100).toFixed(1) + '%)';
  ($('bar') as HTMLElement).style.width = Math.min(pct, 100) + '%';
  const status = await retry(() => sdk.getLaunchStatus(curve!));
  $('status').textContent = status === 1n ? 'Trading on the curve' : status >= 2n ? 'Graduated: trade on DeDust' : 'Starting…';
  if (status >= 2n && minter) $('status').innerHTML = 'Graduated: trade on <a href="https://dedust.io/swap/TON/' + minter.toString({ bounceable: true, urlSafe: true }) + '" target="_blank" rel="noopener">DeDust</a>';
  const q = await retry(() => sdk.quoteBuy(curve!, 1_000_000_000n));
  $('price').textContent = '1 GRAM ≈ ' + fmt(q, 9, 0) + ' ' + $('sym').textContent;
  const live = status === 1n;
  $('openBuy').style.display = $('openSell').style.display = live ? '' : 'none';
  const dd = $('ddBtn') as HTMLAnchorElement;
  if (status >= 2n && minter) { dd.href = 'https://dedust.io/swap/TON/' + minter.toString({ bounceable: true, urlSafe: true }); dd.style.display = ''; }
  if (live && !opened && new URLSearchParams(location.search).get('buy') === '1') { opened = true; openSheet('buy'); }
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

function showCreator() {
  let mine = false;
  try { mine = !!me && !!creatorAddr && Address.parse(creatorAddr).equals(me); } catch {}
  $('creatorCard').style.display = mine ? '' : 'none';
}
// tabs, and the Buy / Sell sheets that slide up from the bottom bar
document.querySelectorAll('#tabs button').forEach((b) => ((b as HTMLElement).onclick = () => {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'p-' + (b as HTMLElement).dataset.p));
}));
function closeSheet() { for (const id of ['scrim', 'buySheet', 'sellSheet']) $(id).style.display = 'none'; }
function openSheet(w: 'buy' | 'sell') { closeSheet(); $('scrim').style.display = ''; $(w === 'buy' ? 'buySheet' : 'sellSheet').style.display = ''; }
$('openBuy').onclick = () => openSheet('buy');
$('openSell').onclick = () => openSheet('sell');
$('scrim').onclick = closeSheet;
const slip = () => Number((document.getElementById('slipSel') as HTMLSelectElement | null)?.value || 300);

$('buy').onclick = async () => {
  try {
    if (!curve || !me) throw new Error('Connect your wallet first');
    const ton = parseUnits(($('buyAmt') as HTMLInputElement).value);
    if (ton < 100_000_000n) throw new Error('Minimum 0.1 GRAM');
    const { transaction } = await sdk.prepareBuy(curve, ton, slip());
    await send(transaction); (window as any).ZJ?.done('trade');
    closeSheet();
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
    await send(transaction); (window as any).ZJ?.done('trade');
    closeSheet();
    say('Sell sent. GRAM arrives in about a minute.');
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
  showCreator();
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
    creatorAddr = coin.creator; showCreator();
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
  ($('cardLink') as HTMLAnchorElement).href = '/api/zenobia/card?c=' + encodeURIComponent(curve.toString({ bounceable: true, urlSafe: true }));
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
  chips(buy, ['0.5', '1', '5', '10'].map((v) => [v + ' GRAM', () => { buy.value = v; }] as [string, () => void]));
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
    if (c.mcTon) parts.push('Market cap ≈ ' + (c.mcTon >= 1000 ? (c.mcTon / 1000).toFixed(1) + 'K' : c.mcTon.toFixed(0)) + ' GRAM');
    if (typeof c.chg24 === 'number') parts.push('24h ' + (c.chg24 > 0 ? '+' : '') + c.chg24.toFixed(1) + '%');
    if (c.raised24 && BigInt(c.raised24) > 0n) parts.push('+' + fmt(BigInt(c.raised24), 9, 2) + ' GRAM raised in 24h');
    $('stat').textContent = parts.join(' · ');
  } catch {}
}
// ---- Curve Map: the coin's own bonding curve with its journey on it, and the money flowing in and out ----
// Price on this curve is a function of the TON raised, so the map needs no price feed: it is drawn from the chain, the index only adds the trail.
let cs = { r: 0, T: 0, V: 0 };
let trail: { ts: number; raised: number; p: number }[] = [];
let chartMode: 'curve' | 'price' = 'price';
let tf = 3600;
const curveMult = (x: number) => Math.pow((cs.V + x) / cs.V, 2);
function setCurveState(d: any) {
  const T = Number(thresholdTon) / 1e9, r = Number(d.realTonReserve) / 1e9;
  const vt = d.virtualTonReserve !== undefined ? Number(d.virtualTonReserve) / 1e9 : 0;
  let best = 5, bd = Infinity;
  if (vt > 0) for (const k of [3, 5, 8]) { const v = T / k, e = Math.min(Math.abs(vt - v), Math.abs(vt - r - v)); if (e < bd) { bd = e; best = k; } }
  cs = { r, T, V: T / best };
  drawMap();
}
function curveHtml(): string {
  if (!(cs.T > 0)) return '';
  const W = 320, H = 212, L = 12, R = 308, top = 24, bot = 118, mid = 172;
  const maxM = curveMult(cs.T), lm = Math.log(maxM);
  const X = (x: number) => L + (Math.min(Math.max(x, 0), cs.T) / cs.T) * (R - L);
  const Y = (x: number) => bot - (Math.log(curveMult(Math.min(x, cs.T))) / lm) * (bot - top);
  const path = (to: number, n = 48) => Array.from({ length: n + 1 }, (_, i) => { const x = (to * i) / n; return (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(x).toFixed(1); }).join(' ');
  const r = Math.min(cs.r, cs.T);
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block" role="img" aria-label="Bonding curve map">'
    + '<defs><linearGradient id="cm1" x1="0" x2="1"><stop offset="0" stop-color="#3ddc84"/><stop offset="1" stop-color="#4da3ff"/></linearGradient>'
    + '<linearGradient id="cm2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4da3ff" stop-opacity=".30"/><stop offset="1" stop-color="#4da3ff" stop-opacity="0"/></linearGradient></defs>';
  svg += '<line x1="' + L + '" y1="' + bot + '" x2="' + R + '" y2="' + bot + '" stroke="#ffffff22"/>';
  svg += '<path d="' + path(cs.T) + '" fill="none" stroke="#ffffff30" stroke-width="2" stroke-dasharray="3 4"/>';
  if (r > 0) svg += '<path d="' + path(r) + ' L' + X(r).toFixed(1) + ' ' + bot + ' L' + L + ' ' + bot + ' Z" fill="url(#cm2)"/>'
    + '<path d="' + path(r) + '" fill="none" stroke="url(#cm1)" stroke-width="3" stroke-linecap="round"/>';
  trail.forEach((t, i) => { const o = 0.15 + 0.7 * ((i + 1) / trail.length); svg += '<circle cx="' + X(t.raised).toFixed(1) + '" cy="' + Y(t.raised).toFixed(1) + '" r="1.8" fill="#fff" opacity="' + o.toFixed(2) + '"/>'; });
  svg += '<g><text x="' + (R - 2) + '" y="' + (top - 8) + '" text-anchor="end" fill="#4da3ff" font-size="10" font-weight="700">🎓 ×' + maxM.toFixed(0) + ' at graduation</text></g>';
  svg += '<text x="' + L + '" y="' + (bot + 12) + '" fill="#8a8fa0" font-size="9">launch</text><text x="' + R + '" y="' + (bot + 12) + '" text-anchor="end" fill="#8a8fa0" font-size="9">' + cs.T.toFixed(0) + ' GRAM</text>';
  const amt = Number((document.getElementById('buyAmt') as HTMLInputElement | null)?.value) || 0;
  if (amt > 0 && r < cs.T) {
    const x2 = Math.min(cs.T, r + amt * 0.965), pct = (curveMult(x2) / curveMult(r) - 1) * 100;
    const gx = X(x2), gy = Y(x2), lx = Math.min(R - 52, Math.max(L + 52, gx));
    svg += '<line x1="' + X(r).toFixed(1) + '" y1="' + Y(r).toFixed(1) + '" x2="' + gx.toFixed(1) + '" y2="' + gy.toFixed(1) + '" stroke="#4da3ff" stroke-dasharray="2 3"/>'
      + '<circle cx="' + gx.toFixed(1) + '" cy="' + gy.toFixed(1) + '" r="4" fill="#0a0a12" stroke="#4da3ff" stroke-width="2"/>'
      + '<text x="' + lx.toFixed(1) + '" y="' + (gy - 9).toFixed(1) + '" text-anchor="middle" fill="#4da3ff" font-size="9.5" font-weight="700">price +' + (pct < 10 ? pct.toFixed(1) : pct.toFixed(0)) + '% after your buy</text>';
  }
  svg += '<circle cx="' + X(r).toFixed(1) + '" cy="' + Y(r).toFixed(1) + '" r="4" fill="#3ddc84"><animate attributeName="r" values="4;11;4" dur="2.2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".5;0;.5" dur="2.2s" repeatCount="indefinite"/></circle>'
    + '<circle cx="' + X(r).toFixed(1) + '" cy="' + Y(r).toFixed(1) + '" r="4.5" fill="#fff" stroke="#3ddc84" stroke-width="2"/>';
  // money in / out between index points: up = TON bought in, down = TON sold out
  const d: number[] = [];
  for (let i = 1; i < trail.length; i++) d.push(trail[i].raised - trail[i - 1].raised);
  svg += '<text x="' + L + '" y="' + (mid - 28) + '" fill="#8a8fa0" font-size="9">Money in ↑ / out ↓ (GRAM, 7 days)</text><line x1="' + L + '" y1="' + mid + '" x2="' + R + '" y2="' + mid + '" stroke="#ffffff18"/>';
  if (d.length) {
    const n = Math.min(40, d.length), per = d.length / n, bw = (R - L) / n;
    const bk = Array.from({ length: n }, (_, i) => d.slice(Math.floor(i * per), Math.floor((i + 1) * per) || undefined).reduce((a, b) => a + b, 0));
    const mx = Math.max(1e-9, ...bk.map((v) => Math.abs(v)));
    bk.forEach((v, i) => { const h = Math.max(1.5, (Math.abs(v) / mx) * 24); svg += '<rect x="' + (L + i * bw + 0.6).toFixed(1) + '" y="' + (v >= 0 ? mid - h : mid).toFixed(1) + '" width="' + Math.max(1, bw - 1.2).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.2" fill="' + (v >= 0 ? '#3ddc84' : '#ff5d5d') + '" opacity=".85"/>'; });
  } else svg += '<text x="' + ((L + R) / 2) + '" y="' + (mid + 4) + '" text-anchor="middle" fill="#8a8fa0" font-size="9">fills in as the coin trades</text>';
  svg += '</svg>';
  const now = curveMult(r), pctDone = (r / cs.T) * 100;
  return svg + '<div class="mut" style="margin-top:4px">×' + now.toFixed(2) + ' since launch · ' + pctDone.toFixed(1) + '% of the way to graduation. The price only depends on how much GRAM the curve holds, so this map is exact, not an estimate.</div>';
}

const fmtP = (p: number) => (p === 0 ? '0' : p >= 1 ? p.toFixed(3) : p >= 0.001 ? p.toFixed(5) : p.toExponential(2));
function priceHtml(): string {
  const pts = trail.filter((t) => t.p > 0);
  if (pts.length < 2) return '<div class="mut" style="padding:28px 0;text-align:center">The price chart fills in as the coin trades.</div>';
  const W = 320, H = 200, L = 6, R = 314, top = 12, bot = 142, vb = 188;
  const buckets = new Map<number, { o: number; c: number; h: number; l: number; v: number; prevRaised: number }>();
  let prev = pts[0].raised;
  for (const t of pts) {
    const k = Math.floor(t.ts / tf);
    const b = buckets.get(k);
    const dv = Math.abs(t.raised - prev); prev = t.raised;
    if (!b) buckets.set(k, { o: t.p, c: t.p, h: t.p, l: t.p, v: dv, prevRaised: t.raised });
    else { b.c = t.p; b.h = Math.max(b.h, t.p); b.l = Math.min(b.l, t.p); b.v += dv; }
  }
  const cs2 = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).slice(-40);
  const hi = Math.max(...cs2.map((c) => c.h)), lo = Math.min(...cs2.map((c) => c.l)), span = Math.max(hi - lo, hi * 1e-6);
  const vmax = Math.max(1e-9, ...cs2.map((c) => c.v));
  const Y = (v: number) => bot - ((v - lo) / span) * (bot - top);
  const w = (R - L) / cs2.length;
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block" role="img" aria-label="Price chart">';
  for (let i = 0; i <= 3; i++) { const y = top + ((bot - top) * i) / 3; svg += '<line x1="' + L + '" x2="' + R + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#ffffff12"/>'; }
  cs2.forEach((c, i) => {
    const x = L + i * w + w / 2, up = c.c >= c.o, col = up ? '#2ee59d' : '#ff4d6a';
    const yo = Y(c.o), yc = Y(c.c), bh = Math.max(2, Math.abs(yo - yc));
    svg += '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + Y(c.h).toFixed(1) + '" y2="' + Y(c.l).toFixed(1) + '" stroke="' + col + '" stroke-width="1.2"/>'
      + '<rect x="' + (x - w * 0.32).toFixed(1) + '" y="' + Math.min(yo, yc).toFixed(1) + '" width="' + (w * 0.64).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1.5" fill="' + col + '"/>'
      + '<rect x="' + (x - w * 0.32).toFixed(1) + '" y="' + (H - 4 - (c.v / vmax) * 34).toFixed(1) + '" width="' + (w * 0.64).toFixed(1) + '" height="' + Math.max(1, (c.v / vmax) * 34).toFixed(1) + '" rx="1" fill="' + col + '" opacity=".35"/>';
  });
  const last = cs2[cs2.length - 1].c, first = cs2[0].o;
  const chg = (last / first - 1) * 100;
  svg += '<text x="' + R + '" y="' + (top - 2) + '" text-anchor="end" font-size="10" fill="#8b8aa0">high ' + fmtP(hi) + '</text><text x="' + R + '" y="' + (bot + 12) + '" text-anchor="end" font-size="10" fill="#8b8aa0">low ' + fmtP(lo) + '</text></svg>';
  return '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><b style="font-size:18px">' + fmtP(last) + ' GRAM</b><b class="' + (chg >= 0 ? 'up' : 'down') + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%</b></div>' + svg + '<div class="mut" style="margin-top:2px">Candles from the platform index. Bars show GRAM traded in each period.</div>';
}
function drawMap() {
  const box = $('chartBox');
  box.textContent = '';
  const bar = document.createElement('div'); bar.className = 'chips'; bar.style.marginBottom = '10px';
  const mk = (t: string, on: boolean, f: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (on ? ' on' : ''); b.textContent = t; b.onclick = f; bar.append(b); };
  mk('Price', chartMode === 'price', () => { chartMode = 'price'; drawMap(); });
  mk('Curve', chartMode === 'curve', () => { chartMode = 'curve'; drawMap(); });
  if (chartMode === 'price') for (const [t, v] of [['1h', 3600], ['4h', 14400], ['1d', 86400]] as const) mk(t, tf === v, () => { tf = v; drawMap(); });
  const body = document.createElement('div');
  body.innerHTML = chartMode === 'price' ? priceHtml() : curveHtml();
  box.append(bar, body);
}
async function loadChart(curveStr: string) {
  try {
    const j = await (await fetch('/api/zenobia/coins/ticks?c=' + encodeURIComponent(curveStr) + '&days=7')).json();
    trail = (j.ticks || []).map((t: any) => ({ ts: t.ts, raised: Number(t.raised) / 1e9, p: Number(t.tpt) > 0 ? 1e9 / Number(t.tpt) : 0 })).filter((t: any) => Number.isFinite(t.raised));
  } catch { trail = []; }
  drawMap();
}
async function loadTrust(curveStr: string) {
  const box = $('trust');
  const items: [string, string, string][] = [];   // [mark, text, tone]
  let coin: any = null;
  try {
    const j = await (await fetch('/api/zenobia/coins/index', { cache: 'no-store' })).json();
    coin = (j.coins || []).find((c: any) => c.curve === curveStr || Address.parse(c.curve).equals(Address.parse(curveStr)));
  } catch {}
  let hold: any = null;
  try { const h = await (await fetch('/api/zenobia/coins/holders?c=' + encodeURIComponent(curveStr))).json(); if (h.ok) hold = h; } catch {}
  if (!coin) { box.textContent = 'Trust check is not available for this coin yet.'; return; }
  items.push(['✅', 'The creator gets no free coins: any creator holding was bought with their own money, like everyone else.', 'ok']);
  const fee = coin.creatorFeeBps / 100;
  items.push([fee > 1 ? '⚠️' : '✅', 'Creator fee ' + fee.toFixed(2).replace(/\.?0+$/, '') + '% per trade (platform fee 1.5%).', fee > 1 ? 'warn' : 'ok']);
  if (coin.features?.maxBuyBps) items.push(['✅', 'Anti-whale: one buy is capped at ' + coin.features.maxBuyBps / 100 + '% of the supply.', 'ok']);
  const ageH = (Date.now() / 1000 - coin.createdAt) / 3600;
  if (ageH < 24) items.push(['⚠️', 'Very new coin (' + Math.max(1, Math.floor(ageH)) + 'h old): little history to judge by.', 'warn']);
  if (hold) {
    let top = 0, creator = 0;
    hold.holders.forEach((h: any, i: number) => { if (!h.isCurve && i < 10) top += h.bps; if (h.isCreator) creator += h.bps; });
    items.push([creator > 2000 ? '⚠️' : '✅', 'Creator holds ' + (creator / 100).toFixed(1) + '% of the supply.', creator > 2000 ? 'warn' : 'ok']);
    items.push([top > 4000 ? '⚠️' : '✅', 'Top 10 wallets (without the curve) hold ' + (top / 100).toFixed(1) + '%.', top > 4000 ? 'warn' : 'ok']);
    items.push(['ℹ️', hold.total + ' holders.', 'info']);
  }
  items.push(['⚠️', 'Unaudited experimental contract: you can lose everything you put in.', 'warn']);
  box.textContent = '';
  for (const [m, tx] of items) {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;gap:8px;padding:6px 0;border-top:1px solid var(--line)';
    const a = document.createElement('span'); a.textContent = m;
    const b = document.createElement('span'); b.textContent = tx;
    r.append(a, b); box.append(r);
  }
  const n = document.createElement('div'); n.className = 'mut'; n.style.marginTop = '6px';
  n.textContent = 'This check reads public data. It is not advice and does not predict price.';
  box.append(n);
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
  void loadStats(c); void loadChart(c); void loadHolders(c); void loadTrust(c); void initEngage(c);
})();

document.getElementById('buyAmt')?.addEventListener('input', () => drawMap());


// ---- community reactions and bot alerts (opt-in; no money moves) ----
const initData = (): string => (window as any).Telegram?.WebApp?.initData || '';
const pageLang = (): string => { try { const l = new URLSearchParams(location.search).get('lang') || localStorage.getItem('znbtLang') || 'en'; return /^(en|ru|ar)$/.test(l) ? l : 'en'; } catch { return 'en'; } };
const RX: [string, string, string][] = [['star', '⭐', 'Like'], ['fire', '🔥', 'Hot'], ['broken', '💔', 'Not for me']];
const RX_KEY = 'znbt-react-v1';
const myReacts = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(RX_KEY) || '{}'); } catch { return {}; } };

async function initEngage(c: string) {
  const row = document.getElementById('reactRow');
  if (row) {
    const draw = (counts: Record<string, number>) => {
      row.textContent = '';
      const mine = myReacts();
      for (const [k, emoji, label] of RX) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'rx' + (mine[c + k] ? ' on' : ''); b.setAttribute('aria-label', label);
        b.innerHTML = `<span>${emoji}</span><b>${counts[k] || 0}</b>`;
        b.onclick = async () => {
          b.disabled = true;
          try {
            const r = await (await fetch('/api/zenobia/react', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ c, kind: k, initData: initData() }) })).json();
            if (r.counts) { const m = myReacts(); m[c + k] = !!r.mine; try { localStorage.setItem(RX_KEY, JSON.stringify(m)); } catch {} if (r.mine) (window as any).ZJ?.done('react'); draw(r.counts); }
          } catch {} finally { b.disabled = false; }
        };
        row.append(b);
      }
    };
    draw({});
    try { const j = await (await fetch('/api/zenobia/react?c=' + encodeURIComponent(c))).json(); if (j.counts) draw(j.counts); } catch {}
  }
  const box = document.getElementById('alertBox');
  if (!box) return;
  if (!initData()) { box.innerHTML = '<div class="mut">Open this coin from the Telegram bot to get alerts there.</div>'; return; }
  const hdr = { 'content-type': 'application/json', 'x-tg-init': initData() };
  let on = new Set<string>();
  try { const j = await (await fetch('/api/zenobia/alerts?c=' + encodeURIComponent(c), { headers: hdr })).json(); on = new Set((j.alerts || []).map((a: any) => a.kind)); } catch {}
  box.textContent = '';
  for (const [k, label] of [['near', 'Near graduation (90%)'], ['grad', 'Graduated to DeDust'], ['move', 'Price moves 20% from now']]) {
    const l = document.createElement('label'); l.className = 'chk';
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = on.has(k);
    i.onchange = async () => {
      i.disabled = true;
      try {
        const r = await (await fetch('/api/zenobia/alerts', { method: 'POST', headers: hdr, body: JSON.stringify({ c, kind: k, on: i.checked, lang: pageLang() }) })).json();
        if (r.error) { i.checked = !i.checked; say(r.error); } else if (i.checked) (window as any).ZJ?.done('alert');
      } catch { i.checked = !i.checked; } finally { i.disabled = false; }
    };
    l.append(i, ' ' + label); box.append(l);
  }
}
