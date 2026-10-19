// Portfolio: the coins the connected wallet holds on the platform (read from the public index, nothing here moves money),
// plus a "Creator" card only for wallets that launched a coin and an "Owner" card only for the owner wallet.
import { Address } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { OWNER, $, fmt } from './common';

const ui = new TonConnectUI({ manifestUrl: location.origin + '/zenobia/tonconnect-manifest.json', buttonRootId: 'connect', actionsConfiguration: { twaReturnUrl: 'https://t.me/PalmyraLaunchBot' as `${string}://${string}` } });
const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);
function el(tag: string, props: Record<string, any> = {}, ...kids: (Node | string)[]) { const e = document.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; }
let seq = 0;

async function load() {
  const my = ++seq;
  const sum = $('sum'), hold = $('hold'), cr = $('creator'), ow = $('owner');
  hold.textContent = ''; cr.style.display = ow.style.display = 'none';
  if (!ui.account) { sum.textContent = ''; sum.append(el('div', { className: 'mut', textContent: 'Connect your wallet to see the coins you hold here.' })); return; }
  const w = Address.parse(ui.account.address);
  sum.textContent = '';
  sum.append(el('div', { className: 'mut', textContent: 'Wallet ' + short(w.toString({ bounceable: false })) }), el('div', { className: 'big sk', textContent: '···' }));
  let holdings: any[] = [], coins: any[] = [];
  try { const j = await (await fetch('/api/zenobia/portfolio?w=' + encodeURIComponent(w.toString({ bounceable: false })), { cache: 'no-store' })).json(); if (j.ok) holdings = j.holdings || []; } catch {}
  try { const j = await (await fetch('/api/zenobia/coins/index', { cache: 'no-store' })).json(); coins = j.coins || []; } catch {}
  if (my !== seq) return;
  const total = holdings.reduce((a, h) => a + (h.valueTon || 0), 0);
  sum.textContent = '';
  sum.append(el('div', { className: 'mut', textContent: 'Wallet ' + short(w.toString({ bounceable: false })) }), el('div', { className: 'big', textContent: '≈ ' + total.toFixed(2) + ' GRAM' }), el('div', { className: 'mut', textContent: holdings.length ? 'Estimated value of ' + holdings.length + (holdings.length === 1 ? ' coin' : ' coins') + ' at the current curve price.' : 'You do not hold any platform coin yet. Open Explore to find one.' }));
  if (!holdings.length) hold.append(el('a', { className: 'btn', href: '/zenobia/coins.html', textContent: 'Explore coins' }));
  for (const h of holdings) {
    const ph = el('div', { className: 'ph', textContent: (h.symbol || '?').slice(0, 1) });
    if (h.image) { const img = el('img', { alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' }) as HTMLImageElement; img.src = h.image; img.onerror = () => img.remove(); ph.append(img); }
    const body = el('div', { className: 'body' }, el('div', { className: 't' }, el('span', { className: 'nm', textContent: h.name || h.symbol })), el('div', { className: 'd', textContent: fmt(BigInt(h.balance), 9, 2) + ' ' + h.symbol }));
    const side = el('div', { className: 'side' }, el('span', { className: 'chg', textContent: h.valueTon != null ? '≈ ' + h.valueTon.toFixed(2) + ' GRAM' : '–' }));
    side.append(el('button', { className: 'qb sell', textContent: 'Sell', onclick: (ev: Event) => { ev.preventDefault(); location.href = '/zenobia/trade.html?c=' + encodeURIComponent(h.curve); } }));
    hold.append(el('a', { className: 'coin', href: '/zenobia/trade.html?c=' + encodeURIComponent(h.curve) }, ph, body, side));
  }
  // creator card: only for a wallet that launched at least one coin
  const mine = coins.filter((c) => { try { return Address.parse(c.creator).equals(w); } catch { return false; } });
  if (mine.length) {
    let raised = 0n; for (const c of mine) raised += BigInt(c.raisedNano || '0');
    cr.style.display = ''; cr.textContent = '';
    cr.append(el('h2', { textContent: 'Your coins · عملاتك' }), el('div', { className: 'mut', textContent: 'You launched ' + mine.length + (mine.length === 1 ? ' coin' : ' coins') + ' that raised ' + fmt(raised, 9, 2) + ' GRAM in total. You earn your creator fee on every trade of your coins.' }), el('a', { className: 'btn', href: '/zenobia/earnings.html', textContent: 'Collect my creator fees' }));
  }
  // owner card: only for the platform owner wallet
  if (w.equals(OWNER)) {
    ow.style.display = ''; ow.textContent = '';
    ow.append(el('h2', { textContent: 'Platform owner · المالك' }), el('div', { className: 'mut', textContent: 'Platform fees and the owner tools are here.' }), el('a', { className: 'btn', href: '/zenobia/earnings.html', textContent: 'Collect platform fees' }), el('a', { className: 'btn alt', href: '/zenobia/coins.html#admin', textContent: 'Owner tools' }));
  }
}
ui.onStatusChange(() => { void load(); });
void load();
