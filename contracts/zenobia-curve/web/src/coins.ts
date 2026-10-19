import { Address } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { toTonConnect, flushFees, withdrawProtocolFees } from '../../sdk/dist/index.js';
import { client, sdk, OWNER, $, loadConfig, fmt } from './common';
import { scanCoins, hiddenSet, Coin } from './registry';

interface Row extends Coin { features?: { shape: number; maxBuyBps: number; buyback: boolean; split: boolean }; minter?: string; state?: number; raisedNano?: string; thresholdNano?: string; tokensPerTon?: string; chg24?: number | null; raised24?: string | null; mcTon?: number | null }
type Sort = 'new' | 'progress' | 'raised';
const WATCH = 'znbt-watch-v1';
const watch = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(WATCH) || '[]')); } catch { return new Set(); } };
const saveWatch = (w: Set<string>) => { try { localStorage.setItem(WATCH, JSON.stringify([...w])); } catch {} };
let rows: Row[] = [];
let reports = new Map<string, { n: number; reason: string }>();
let q = '';
let sort: Sort = 'new';
let featured = new Set<string>();
async function loadFeatured() {
  try {
    const j = await (await fetch('/api/zenobia/coins/featured')).json();
    featured = new Set((j.featured || []).map((f: any) => { try { return Address.parse(f.curve).toString({ bounceable: true, urlSafe: true }); } catch { return ''; } }));
  } catch { featured = new Set(); }
}
let filter: 'all' | 'curve' | 'grad' | 'watch' = 'all';
let watched = watch();
let official = '';   // ZNBt's own curve, pinned first

const admin = location.hash === '#admin';
const ui = new TonConnectUI({ manifestUrl: location.origin + '/zenobia/tonconnect-manifest.json', buttonRootId: 'connect', actionsConfiguration: { twaReturnUrl: 'https://t.me/PalmyraLaunchBot' as `${string}://${string}` } });
let proofReq: any = null;
let hidden = new Set<string>();
let coins: Coin[] = [];
let master: Address | null = null;
const say = (m: string) => ($('log').textContent = m);
const key = (c: Coin) => Address.parse(c.curve).toString({ bounceable: true, urlSafe: true });

function el(tag: string, props: Record<string, any> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

const pct = (c: Row) => (c.raisedNano && c.thresholdNano && BigInt(c.thresholdNano) > 0n ? Math.min(100, Number((BigInt(c.raisedNano) * 10000n) / BigInt(c.thresholdNano)) / 100) : null);
const tgShare = (c: Row) => 'https://t.me/share/url?url=' + encodeURIComponent(location.origin + '/zenobia/trade.html?c=' + c.curve) + '&text=' + encodeURIComponent((c.name || 'Coin') + ' · ' + (c.symbol || ''));

function visible(): Row[] {
  const term = q.trim().toLowerCase();
  let list = rows.filter((c) => admin || !hidden.has(key(c)));
  if (term) list = list.filter((c) => (c.name + ' ' + c.symbol + ' ' + c.description + ' ' + c.curve + ' ' + c.creator).toLowerCase().includes(term));
  if (filter === 'curve') list = list.filter((c) => c.state === undefined || c.state === 1);
  if (filter === 'grad') list = list.filter((c) => (c.state ?? 1) >= 2);
  if (filter === 'watch') list = list.filter((c) => watched.has(key(c)));
  if (sort === 'progress') list = [...list].sort((a, b) => (pct(b) ?? -1) - (pct(a) ?? -1));
  if (sort === 'raised') list = [...list].sort((a, b) => Number(BigInt(b.raisedNano || '0') - BigInt(a.raisedNano || '0')));
  return list;
}

function toolbar() {
  const box = $('tools');
  box.textContent = '';
  const chips = el('div', { className: 'chips' });
  for (const [v, t] of [['all', 'All · الكل'], ['curve', '🔥 On the curve'], ['grad', '🎓 Graduated'], ['watch', '★ Watchlist']] as const) {
    chips.append(el('button', { className: 'chip' + (filter === v ? ' on' : ''), textContent: t, onclick: () => { filter = v; toolbar(); render(); } }));
  }
  const sorts = el('div', { className: 'chips' });
  for (const [v, t] of [['new', '🆕 Newest'], ['progress', '🎯 Closest to graduation'], ['raised', '💰 Most raised']] as const) {
    sorts.append(el('button', { className: 'chip' + (sort === v ? ' on' : ''), textContent: t, onclick: () => { sort = v as Sort; toolbar(); render(); } }));
  }
  const input = el('input', { type: 'search', placeholder: '🔍 Search name, symbol or address · بحث', value: q, ariaLabel: 'Search' }) as HTMLInputElement;
  input.oninput = () => { q = input.value; render(); };
  box.append(input, chips, sorts);
}

const sign = (n: number) => (n > 0 ? '+' : '') + n.toFixed(Math.abs(n) >= 100 ? 0 : 1) + '%';
function mini(c: Row, note: string, cls = '') {
  const a = el('a', { className: 'mini', href: '/zenobia/trade.html?c=' + encodeURIComponent(c.curve) });
  const ph = el('div', { className: 'ph', textContent: (c.symbol || '?').slice(0, 1) });
  if (c.image) { const img = el('img', { alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' }) as HTMLImageElement; img.src = c.image; img.onerror = () => img.remove(); ph.append(img); }
  a.append(ph, el('b', { textContent: c.symbol || '?' }), el('span', { className: cls, textContent: note }));
  return a;
}
function sections() {
  const box = $('sections');
  box.textContent = '';
  const live = rows.filter((c) => (admin || !hidden.has(key(c))) && (c.state ?? 1) === 1);
  const king = [...live].sort((a, b) => (pct(b) ?? -1) - (pct(a) ?? -1))[0];
  const hot = [...live].filter((c) => c.raised24 && BigInt(c.raised24) > 0n).sort((a, b) => Number(BigInt(b.raised24!) - BigInt(a.raised24!))).slice(0, 8);
  if (king && (pct(king) ?? 0) > 0) {
    box.append(el('h2', { className: 'sec', textContent: '👑 King of the hill' }));
    box.append(el('a', { className: 'king', href: '/zenobia/trade.html?c=' + encodeURIComponent(king.curve) }, el('b', { textContent: (king.name || king.symbol) + ' · ' + king.symbol }), el('span', { textContent: (pct(king) ?? 0).toFixed(1) + '% to graduation · ' + fmt(BigInt(king.raisedNano!), 9, 2) + ' GRAM raised' })));
  }
  if (hot.length) {
    box.append(el('h2', { className: 'sec', textContent: '🔥 Trending now' }));
    const strip = el('div', { className: 'strip' });
    for (const c of hot) strip.append(mini(c, '+' + fmt(BigInt(c.raised24!), 9, 2) + ' GRAM', 'up'));
    box.append(strip);
  }
}

function stats() {
  const shown = rows.filter((c) => admin || !hidden.has(key(c)));
  let raised = 0n;
  for (const c of shown) raised += BigInt(c.raisedNano || '0');
  const box = $('stats');
  box.textContent = '';
  for (const [v, l] of [[String(shown.length), 'Coins · عملات'], [fmt(raised, 9, 1), 'GRAM raised'], ['1.5%+≤2%', 'Fees']]) box.append(el('div', { className: 'stat' }, el('b', { textContent: v }), el('span', { textContent: l })));
}

function render() {
  const box = $('list');
  box.textContent = '';
  let shown = visible();
  shown = [...shown.filter((c) => featured.has(key(c))), ...shown.filter((c) => !featured.has(key(c)))];   // sponsored coins next
  if (official) shown = [...shown.filter((c) => key(c) === official), ...shown.filter((c) => key(c) !== official)];   // our own coin first
  $('count').textContent = shown.length + (shown.length === 1 ? ' coin' : ' coins') + ' · ' + shown.length + ' عملة';
  if (!shown.length) box.append(el('div', { className: 'card mut', textContent: rows.length ? 'Nothing matches. / لا نتائج.' : 'No coins yet. / لا توجد عملات بعد.' }));
  for (const c of shown) {
    const k = key(c);
    const isHidden = hidden.has(k);
    const row = el('a', { className: 'coin' + (k === official ? ' official' : '') + (isHidden ? ' dim' : ''), href: '/zenobia/trade.html?c=' + encodeURIComponent(c.curve) });
    const ph = el('div', { className: 'ph', textContent: (c.symbol || '?').slice(0, 1) });
    if (c.image) {
      const img = el('img', { alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' }) as HTMLImageElement;
      img.src = c.image;
      img.onerror = () => img.remove();
      ph.append(img);
    }
    const body = el('div', { className: 'body' });
    const t = el('div', { className: 't' }, c.name || '(no name)', el('span', { className: 'sym', textContent: c.symbol || '?' }));
    const badges = el('div', { className: 'badges' });
    if (k === official) badges.append(el('span', { className: 'badge off', textContent: 'OFFICIAL' }));
    if (featured.has(k)) badges.append(el('span', { className: 'badge', textContent: 'SPONSORED' }));
    if (Date.now() / 1000 - c.createdAt < 86400) badges.append(el('span', { className: 'badge new', textContent: 'NEW' }));
    if ((c.state ?? 1) >= 2) badges.append(el('span', { className: 'badge grad', textContent: 'Graduated' }));
    if (c.features?.maxBuyBps) badges.append(el('span', { className: 'badge', textContent: '🐋 max buy ' + (c.features.maxBuyBps / 100) + '%' }));
    if (c.features?.buyback) badges.append(el('span', { className: 'badge', textContent: '🔥 buyback & burn' }));
    if (c.features?.split) badges.append(el('span', { className: 'badge', textContent: '🤝 fee split' }));
    const rep = reports.get(k);
    if (admin && rep) badges.append(el('span', { className: 'badge warn', textContent: '⚑ ' + rep.n + ' · ' + rep.reason }));
    body.append(t);
    if (badges.childElementCount) body.append(badges);
    body.append(el('div', { className: 'd', textContent: c.description }));
    const p = pct(c);
    if (p !== null) {
      body.append(el('div', { className: 'bar' }, el('div', { style: 'width:' + p + '%' })));
      body.append(el('div', { className: 'm' }, el('span', { textContent: fmt(BigInt(c.raisedNano!), 9, 2) + ' / ' + fmt(BigInt(c.thresholdNano!), 9, 0) + ' GRAM' }), el('b', { textContent: p.toFixed(1) + '%' })));
      const extra = [c.mcTon ? 'MC ' + (c.mcTon >= 1000 ? (c.mcTon / 1000).toFixed(1) + 'K' : c.mcTon.toFixed(0)) + ' GRAM' : '', typeof c.chg24 === 'number' ? sign(c.chg24) + ' 24h' : ''].filter(Boolean);
      if (extra.length) body.append(el('div', { className: 'm' }, el('span', { textContent: extra[0] }), el('span', { className: typeof c.chg24 === 'number' ? (c.chg24 >= 0 ? 'up' : 'down') : '', textContent: extra[1] || '' })));
    } else {
      body.append(el('div', { className: 'm' }, el('span', { textContent: 'creator fee ' + (c.creatorFeeBps / 100).toFixed(2).replace(/\.?0+$/, '') + '%' }), el('span', { textContent: new Date(c.createdAt * 1000).toISOString().slice(0, 10) })));
    }
    const star = el('button', { className: 'star' + (watched.has(k) ? ' on' : ''), textContent: watched.has(k) ? '★' : '☆', title: 'Watchlist', ariaLabel: 'Watchlist', onclick: (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); if (watched.has(k)) watched.delete(k); else watched.add(k); saveWatch(watched); render(); } });
    row.append(ph, body, star);
    box.append(row);
    if (admin) {
      const adm = el('div', { className: 'card', style: 'margin-top:-4px' });
      const reason = el('input', { placeholder: 'reason (optional)', value: '' }) as HTMLInputElement;
      adm.append(reason);
      adm.append(el('button', { textContent: isHidden ? 'Unhide' : 'Hide', onclick: () => setHidden(c, !isHidden, reason.value) }));
      const days = el('input', { placeholder: 'sponsor days (1-30, 0 = remove)', value: '7', inputMode: 'numeric' }) as HTMLInputElement;
      adm.append(days, el('button', { className: 'alt', textContent: featured.has(k) ? 'Update / remove sponsorship' : 'Sponsor this coin', onclick: () => setFeatured(c, Number(days.value)) }));
      adm.append(el('button', { className: 'alt', textContent: 'Collect platform fees', onclick: () => collect(c) }));
      box.append(adm);
    }
  }
}

async function setHidden(c: Coin, hide: boolean, reason: string) {
  try {
    if (!proofReq) throw new Error('Connect the owner wallet first');
    const r = await fetch('/api/zenobia/coins/hidden', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...proofReq, curve: c.curve, hidden: hide, reason }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'failed');
    hidden = await hiddenSet();
    render();
    say(hide ? 'Hidden from the lists.' : 'Visible again.');
  } catch (e: any) { say('Error: ' + (e.message || e)); }
}

async function setFeatured(c: Coin, days: number) {
  try {
    if (!proofReq) throw new Error('Connect the owner wallet first');
    const r = await fetch('/api/zenobia/coins/featured', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...proofReq, curve: c.curve, days }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'failed');
    await loadFeatured();
    render();
    say(days === 0 ? 'Sponsorship removed.' : 'Sponsored for ' + days + ' days.');
  } catch (e: any) { say('Error: ' + (e.message || e)); }
}

async function collect(c: Coin) {
  try {
    if (!ui.account || !Address.parse(ui.account.address).equals(OWNER)) throw new Error('Owner wallet only');
    await ui.sendTransaction(toTonConnect(flushFees(Address.parse(c.curve)), { validUntil: Math.floor(Date.now() / 1000) + 300, network: '-239' }));
    say('Sent. After a minute the platform fees of this coin are in the master; then press "Withdraw platform fees".');
  } catch (e: any) { say('Error: ' + (e.message || e)); }
}

async function setupAdmin() {
  $('adminBox').style.display = 'block';
  ui.setConnectRequestParameters({ state: 'loading' });
  const r = await fetch('/api/zenobia/coins/hidden/challenge', { method: 'POST' });
  const j = await r.json();
  ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: j.payload } });
  ui.onStatusChange((w: any) => {
    const proof = w?.connectItems?.tonProof?.proof;
    if (proof && w.account) { proofReq = { account: w.account, proof }; say('Owner wallet connected.'); }
  });
  $('withdraw').onclick = async () => {
    try {
      if (!master || !ui.account || !Address.parse(ui.account.address).equals(OWNER)) throw new Error('Owner wallet only');
      const d = await sdk.master(master).getMasterData();
      if (d.feesBalance <= 0n) throw new Error('No platform fees in the master yet');
      await ui.sendTransaction(toTonConnect(withdrawProtocolFees(master, d.feesBalance), { validUntil: Math.floor(Date.now() / 1000) + 300, network: '-239' }));
      say('Withdrawal sent: ' + fmt(d.feesBalance, 9, 3) + ' GRAM.');
    } catch (e: any) { say('Error: ' + (e.message || e)); }
  };
  $('balance').onclick = async () => {
    try {
      const d = await sdk.master(master!).getMasterData();
      say('Platform fees waiting in the master: ' + fmt(d.feesBalance, 9, 3) + ' GRAM · launches: ' + d.totalLaunches);
    } catch (e: any) { say('Error: ' + (e.message || e)); }
  };
}

async function mine() {
  const show = async () => {
    const box = $('mine');
    box.textContent = '';
    if (!ui.account) return;
    try {
      const r = await fetch('/api/zenobia/portfolio?w=' + encodeURIComponent(ui.account.address), { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok || !j.holdings.length) return;
      box.append(el('h2', { className: 'sec', textContent: '💼 Your coins' }));
      let total = 0;
      for (const h of j.holdings) {
        total += h.valueTon || 0;
        box.append(el('a', { className: 'coin', href: '/zenobia/trade.html?c=' + encodeURIComponent(h.curve) }, el('div', { className: 'ph', textContent: (h.symbol || '?').slice(0, 1) }), el('div', { className: 'body' }, el('div', { className: 't' }, h.name || h.symbol, el('span', { className: 'sym', textContent: h.symbol })), el('div', { className: 'm' }, el('span', { textContent: fmt(BigInt(h.balance), 9, 2) + ' ' + h.symbol }), el('b', { textContent: h.valueTon != null ? '≈ ' + h.valueTon.toFixed(2) + ' GRAM' : '' })))));
      }
      box.append(el('div', { className: 'mut', textContent: 'Estimated value at the current curve price: ' + total.toFixed(2) + ' GRAM' }));
    } catch {}
  };
  ui.onStatusChange(() => { void show(); });
  await show();
}

(async () => {
  const cfg = await loadConfig();
  master = Address.parse(cfg.master);
  if (cfg.curve) { try { official = Address.parse(cfg.curve).toString({ bounceable: true, urlSafe: true }); } catch {} }
  if (admin) await setupAdmin();
  await loadFeatured();
  // the server index first (fast, carries live numbers); the chain itself only when the index is missing or old
  let usedIndex = false;
  try {
    const r = await fetch('/api/zenobia/coins/index', { cache: 'no-store' });
    const j = await r.json();
    hidden = new Set<string>(j.hidden || []);
    if (!j.stale && Array.isArray(j.coins)) {
      rows = j.coins.map((c: any) => ({ ...c, supply: BigInt(c.supply) }));
      usedIndex = true;
    }
  } catch {}
  if (!usedIndex) {
    hidden = await hiddenSet();
    rows = (await scanCoins(master)).sort((a, b) => b.createdAt - a.createdAt);
    say('Showing coins read directly from the chain (live numbers are on each coin page).');
  }
  if (admin) {
    try {
      const r = await fetch('/api/zenobia/coins/report', { cache: 'no-store' });
      if (r.ok) for (const x of (await r.json()).reports || []) reports.set(x.curve, { n: x.n, reason: x.reason });
    } catch {}
  }
  toolbar();
  stats();
  sections();
  render();
  mine();
})().catch((e) => say('Error: ' + (e.message || e)));
void client;
