import { Address } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { toTonConnect, flushFees, withdrawProtocolFees } from '../../sdk/dist/index.js';
import { client, sdk, OWNER, $, loadConfig, fmt } from './common';
import { scanCoins, hiddenSet, Coin } from './registry';

interface Row extends Coin { state?: number; raisedNano?: string; thresholdNano?: string; tokensPerTon?: string }
type Sort = 'new' | 'progress' | 'raised';
const WATCH = 'znbt-watch-v1';
const watch = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(WATCH) || '[]')); } catch { return new Set(); } };
const saveWatch = (w: Set<string>) => { try { localStorage.setItem(WATCH, JSON.stringify([...w])); } catch {} };
let rows: Row[] = [];
let reports = new Map<string, { n: number; reason: string }>();
let q = '';
let sort: Sort = 'new';
let filter: 'all' | 'curve' | 'grad' | 'watch' = 'all';
let watched = watch();

const admin = location.hash === '#admin';
const ui = new TonConnectUI({ manifestUrl: location.origin + '/zenobia/tonconnect-manifest.json', buttonRootId: 'connect' });
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
  const input = el('input', { type: 'search', placeholder: 'Search name, symbol, address · بحث', value: q, ariaLabel: 'Search' }) as HTMLInputElement;
  input.oninput = () => { q = input.value; render(); };
  const sel = el('select', { ariaLabel: 'Sort' }) as HTMLSelectElement;
  for (const [v, t] of [['new', 'Newest · الأحدث'], ['progress', 'Closest to graduation · الأقرب للتخرّج'], ['raised', 'Most raised · الأكثر جمعاً']]) sel.append(el('option', { value: v, textContent: t, selected: v === sort }));
  sel.onchange = () => { sort = sel.value as Sort; render(); };
  const chips = el('div', { className: 'chips' });
  for (const [v, t] of [['all', 'All'], ['curve', 'On the curve'], ['grad', 'Graduated'], ['watch', '★ Watchlist']] as const) {
    chips.append(el('button', { className: 'chip' + (filter === v ? ' on' : ''), textContent: t, onclick: () => { filter = v; toolbar(); render(); } }));
  }
  box.append(input, sel, chips);
}

function render() {
  const box = $('list');
  box.textContent = '';
  const shown = visible();
  $('count').textContent = shown.length + (shown.length === 1 ? ' coin' : ' coins') + ' · ' + shown.length + ' عملة';
  if (!shown.length) box.append(el('div', { className: 'card mut', textContent: rows.length ? 'Nothing matches. / لا نتائج.' : 'No coins yet. / لا توجد عملات بعد.' }));
  for (const c of shown) {
    const k = key(c);
    const isHidden = hidden.has(k);
    const card = el('div', { className: 'card' + (isHidden ? ' dim' : '') });
    if (c.image) {
      const img = el('img', { className: 'thumb', alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' }) as HTMLImageElement;
      img.src = c.image;
      img.onerror = () => img.remove();
      card.append(img);
    }
    const star = el('button', { className: 'star' + (watched.has(k) ? ' on' : ''), textContent: watched.has(k) ? '★' : '☆', title: 'Watchlist', ariaLabel: 'Watchlist', onclick: () => { watched.has(k) ? watched.delete(k) : watched.add(k); saveWatch(watched); render(); } });
    card.append(star, el('div', { className: 'ctitle', textContent: (c.name || '(no name)') + ' · ' + (c.symbol || '?') }));
    const badges = el('div', { className: 'badges' });
    if (Date.now() / 1000 - c.createdAt < 86400) badges.append(el('span', { className: 'badge new', textContent: 'NEW' }));
    if ((c.state ?? 1) >= 2) badges.append(el('span', { className: 'badge grad', textContent: 'Graduated · DeDust' }));
    badges.append(el('span', { className: 'badge', textContent: 'creator fee ' + (c.creatorFeeBps / 100).toFixed(2).replace(/\.?0+$/, '') + '%' }));
    const rep = reports.get(k);
    if (admin && rep) badges.append(el('span', { className: 'badge warn', textContent: '⚑ ' + rep.n + ' report' + (rep.n > 1 ? 's' : '') + ' · ' + rep.reason }));
    card.append(badges, el('div', { className: 'mut', textContent: c.description }));
    const p = pct(c);
    if (p !== null) {
      const bar = el('div', { className: 'bar', style: 'margin:8px 0 4px' }, el('div', { style: 'width:' + p + '%' }));
      const tpt = c.tokensPerTon && c.tokensPerTon !== '0' ? ' · 1 TON ≈ ' + fmt(BigInt(c.tokensPerTon), 9, 0) + ' ' + (c.symbol || '') : '';
      card.append(bar, el('div', { className: 'mut', textContent: 'Raised ' + fmt(BigInt(c.raisedNano!), 9, 2) + ' / ' + fmt(BigInt(c.thresholdNano!), 9, 0) + ' TON (' + p.toFixed(1) + '%)' + tpt }));
    }
    card.append(el('div', { className: 'mut', textContent: `Supply ${fmt(c.supply, 9, 0)} · by ${c.creator.slice(0, 6)}…${c.creator.slice(-4)} · ${new Date(c.createdAt * 1000).toISOString().slice(0, 10)}` }));
    const links = el('div', { className: 'links' });
    links.append(el('a', { className: 'btn', textContent: 'Open · افتح', href: '/zenobia/trade.html?c=' + encodeURIComponent(c.curve) }));
    links.append(el('a', { className: 'btn alt', textContent: 'Share', href: tgShare(c), target: '_blank', rel: 'noopener' }));
    card.append(links);
    if (admin) {
      const row = el('div', { className: 'row' });
      const reason = el('input', { placeholder: 'reason (optional)', value: '' }) as HTMLInputElement;
      row.append(reason);
      row.append(el('button', { textContent: isHidden ? 'Unhide' : 'Hide', onclick: () => setHidden(c, !isHidden, reason.value) }));
      row.append(el('button', { className: 'alt', textContent: 'Collect platform fees', onclick: () => collect(c) }));
      card.append(row);
    }
    box.append(card);
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
      say('Withdrawal sent: ' + fmt(d.feesBalance, 9, 3) + ' TON.');
    } catch (e: any) { say('Error: ' + (e.message || e)); }
  };
  $('balance').onclick = async () => {
    try {
      const d = await sdk.master(master!).getMasterData();
      say('Platform fees waiting in the master: ' + fmt(d.feesBalance, 9, 3) + ' TON · launches: ' + d.totalLaunches);
    } catch (e: any) { say('Error: ' + (e.message || e)); }
  };
}

(async () => {
  const cfg = await loadConfig();
  master = Address.parse(cfg.master);
  if (admin) await setupAdmin();
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
  render();
})().catch((e) => say('Error: ' + (e.message || e)));
void client;
