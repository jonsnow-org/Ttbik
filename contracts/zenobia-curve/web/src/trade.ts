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
  setCurveState(d);
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
// ---- Curve Map: the coin's own bonding curve with its journey on it, and the money flowing in and out ----
// Price on this curve is a function of the TON raised, so the map needs no price feed: it is drawn from the chain, the index only adds the trail.
let cs = { r: 0, T: 0, V: 0 };
let trail: { ts: number; raised: number }[] = [];
const curveMult = (x: number) => Math.pow((cs.V + x) / cs.V, 2);
function setCurveState(d: any) {
  const T = Number(thresholdTon) / 1e9, r = Number(d.realTonReserve) / 1e9;
  const vt = d.virtualTonReserve !== undefined ? Number(d.virtualTonReserve) / 1e9 : 0;
  let best = 5, bd = Infinity;
  if (vt > 0) for (const k of [3, 5, 8]) { const v = T / k, e = Math.min(Math.abs(vt - v), Math.abs(vt - r - v)); if (e < bd) { bd = e; best = k; } }
  cs = { r, T, V: T / best };
  drawMap();
}
function drawMap() {
  const box = $('chartBox');
  if (!(cs.T > 0)) return;
  const W = 320, H = 212, L = 12, R = 308, top = 24, bot = 118, mid = 172;
  const maxM = curveMult(cs.T), lm = Math.log(maxM);
  const X = (x: number) => L + (Math.min(Math.max(x, 0), cs.T) / cs.T) * (R - L);
  const Y = (x: number) => bot - (Math.log(curveMult(Math.min(x, cs.T))) / lm) * (bot - top);
  const path = (to: number, n = 48) => Array.from({ length: n + 1 }, (_, i) => { const x = (to * i) / n; return (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(x).toFixed(1); }).join(' ');
  const r = Math.min(cs.r, cs.T);
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block" role="img" aria-label="Bonding curve map">'
    + '<defs><linearGradient id="cm1" x1="0" x2="1"><stop offset="0" stop-color="#3ddc84"/><stop offset="1" stop-color="#f6b73c"/></linearGradient>'
    + '<linearGradient id="cm2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b73c" stop-opacity=".30"/><stop offset="1" stop-color="#f6b73c" stop-opacity="0"/></linearGradient></defs>';
  svg += '<line x1="' + L + '" y1="' + bot + '" x2="' + R + '" y2="' + bot + '" stroke="#ffffff22"/>';
  svg += '<path d="' + path(cs.T) + '" fill="none" stroke="#ffffff30" stroke-width="2" stroke-dasharray="3 4"/>';
  if (r > 0) svg += '<path d="' + path(r) + ' L' + X(r).toFixed(1) + ' ' + bot + ' L' + L + ' ' + bot + ' Z" fill="url(#cm2)"/>'
    + '<path d="' + path(r) + '" fill="none" stroke="url(#cm1)" stroke-width="3" stroke-linecap="round"/>';
  trail.forEach((t, i) => { const o = 0.15 + 0.7 * ((i + 1) / trail.length); svg += '<circle cx="' + X(t.raised).toFixed(1) + '" cy="' + Y(t.raised).toFixed(1) + '" r="1.8" fill="#fff" opacity="' + o.toFixed(2) + '"/>'; });
  svg += '<g><text x="' + (R - 2) + '" y="' + (top - 8) + '" text-anchor="end" fill="#f6b73c" font-size="10" font-weight="700">🎓 ×' + maxM.toFixed(0) + ' at graduation</text></g>';
  svg += '<text x="' + L + '" y="' + (bot + 12) + '" fill="#8a8fa0" font-size="9">launch</text><text x="' + R + '" y="' + (bot + 12) + '" text-anchor="end" fill="#8a8fa0" font-size="9">' + cs.T.toFixed(0) + ' TON</text>';
  const amt = Number((document.getElementById('buyAmt') as HTMLInputElement | null)?.value) || 0;
  if (amt > 0 && r < cs.T) {
    const x2 = Math.min(cs.T, r + amt * 0.965), pct = (curveMult(x2) / curveMult(r) - 1) * 100;
    const gx = X(x2), gy = Y(x2), lx = Math.min(R - 52, Math.max(L + 52, gx));
    svg += '<line x1="' + X(r).toFixed(1) + '" y1="' + Y(r).toFixed(1) + '" x2="' + gx.toFixed(1) + '" y2="' + gy.toFixed(1) + '" stroke="#f6b73c" stroke-dasharray="2 3"/>'
      + '<circle cx="' + gx.toFixed(1) + '" cy="' + gy.toFixed(1) + '" r="4" fill="#0a0a12" stroke="#f6b73c" stroke-width="2"/>'
      + '<text x="' + lx.toFixed(1) + '" y="' + (gy - 9).toFixed(1) + '" text-anchor="middle" fill="#f6b73c" font-size="9.5" font-weight="700">price +' + (pct < 10 ? pct.toFixed(1) : pct.toFixed(0)) + '% after your buy</text>';
  }
  svg += '<circle cx="' + X(r).toFixed(1) + '" cy="' + Y(r).toFixed(1) + '" r="4" fill="#3ddc84"><animate attributeName="r" values="4;11;4" dur="2.2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".5;0;.5" dur="2.2s" repeatCount="indefinite"/></circle>'
    + '<circle cx="' + X(r).toFixed(1) + '" cy="' + Y(r).toFixed(1) + '" r="4.5" fill="#fff" stroke="#3ddc84" stroke-width="2"/>';
  // money in / out between index points: up = TON bought in, down = TON sold out
  const d: number[] = [];
  for (let i = 1; i < trail.length; i++) d.push(trail[i].raised - trail[i - 1].raised);
  svg += '<text x="' + L + '" y="' + (mid - 28) + '" fill="#8a8fa0" font-size="9">Money in ↑ / out ↓ (TON, 7 days)</text><line x1="' + L + '" y1="' + mid + '" x2="' + R + '" y2="' + mid + '" stroke="#ffffff18"/>';
  if (d.length) {
    const n = Math.min(40, d.length), per = d.length / n, bw = (R - L) / n;
    const bk = Array.from({ length: n }, (_, i) => d.slice(Math.floor(i * per), Math.floor((i + 1) * per) || undefined).reduce((a, b) => a + b, 0));
    const mx = Math.max(1e-9, ...bk.map((v) => Math.abs(v)));
    bk.forEach((v, i) => { const h = Math.max(1.5, (Math.abs(v) / mx) * 24); svg += '<rect x="' + (L + i * bw + 0.6).toFixed(1) + '" y="' + (v >= 0 ? mid - h : mid).toFixed(1) + '" width="' + Math.max(1, bw - 1.2).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.2" fill="' + (v >= 0 ? '#3ddc84' : '#ff5d5d') + '" opacity=".85"/>'; });
  } else svg += '<text x="' + ((L + R) / 2) + '" y="' + (mid + 4) + '" text-anchor="middle" fill="#8a8fa0" font-size="9">fills in as the coin trades</text>';
  svg += '</svg>';
  const now = curveMult(r), pctDone = (r / cs.T) * 100;
  box.innerHTML = svg + '<div class="mut" style="margin-top:4px">×' + now.toFixed(2) + ' since launch · ' + pctDone.toFixed(1) + '% of the way to graduation. The price only depends on how much TON the curve holds, so this map is exact, not an estimate.</div>';
}
async function loadChart(curveStr: string) {
  try {
    const j = await (await fetch('/api/zenobia/coins/ticks?c=' + encodeURIComponent(curveStr) + '&days=7')).json();
    trail = (j.ticks || []).map((t: any) => ({ ts: t.ts, raised: Number(t.raised) / 1e9 })).filter((t: any) => Number.isFinite(t.raised));
  } catch { trail = []; }
  drawMap();
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

document.getElementById('buyAmt')?.addEventListener('input', () => drawMap());

