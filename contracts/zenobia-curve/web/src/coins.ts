import { Address } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { toTonConnect, flushFees, withdrawProtocolFees } from '../../sdk/dist/index.js';
import { client, sdk, OWNER, $, loadConfig, fmt } from './common';
import { scanCoins, hiddenSet, Coin } from './registry';

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

function render() {
  const box = $('list');
  box.textContent = '';
  const shown = coins.filter((c) => admin || !hidden.has(key(c)));
  if (!shown.length) box.append(el('div', { className: 'card mut', textContent: 'No coins yet. / لا توجد عملات بعد.' }));
  for (const c of shown) {
    const isHidden = hidden.has(key(c));
    const card = el('div', { className: 'card' + (isHidden ? ' dim' : '') });
    if (c.image) {
      const img = el('img', { className: 'thumb', alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' }) as HTMLImageElement;
      img.src = c.image;
      img.onerror = () => img.remove();
      card.append(img);
    }
    card.append(el('div', { className: 'ctitle', textContent: (c.name || '(no name)') + ' · ' + (c.symbol || '?') }));
    card.append(el('div', { className: 'mut', textContent: c.description }));
    card.append(el('div', { className: 'mut', textContent: `Supply ${fmt(c.supply, 9, 0)} · creator fee ${(c.creatorFeeBps / 100).toFixed(2).replace(/\.?0+$/, '')}% · by ${c.creator.slice(0, 6)}…${c.creator.slice(-4)} · ${new Date(c.createdAt * 1000).toISOString().slice(0, 10)}` }));
    const a = el('a', { className: 'btn', textContent: 'Open · افتح', href: '/zenobia/trade.html?c=' + encodeURIComponent(c.curve) }) as HTMLAnchorElement;
    card.append(a);
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
  hidden = await hiddenSet();
  if (admin) await setupAdmin();
  coins = (await scanCoins(master)).sort((a, b) => b.createdAt - a.createdAt);
  render();
})().catch((e) => say('Error: ' + (e.message || e)));
void client;
