// "Swap": trade the main coins (TON, USDT, STON) and any coin that has a DEX pool, through STON.fi's open DEX. Non-custodial: the wallet signs the
// swap itself and nothing is ever held here. A small platform fee (REF_BPS) is attached as STON.fi's referral fee and accrues to the owner's vault
// (withdrawn from the Earnings page). The fee is part of the quote the user sees before confirming.
import { Address } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { StonApiClient } from '@ston-fi/api';
import { dexFactory } from '@ston-fi/sdk';
import { toTonConnect } from '../../sdk/dist/index.js';
import { client, OWNER, $, loadConfig, fmt, parseUnits } from './common';

const REF_BPS = 30;   // 0.30% platform fee (STON.fi DEX v2 allows 0.01% to 1%)
const NATIVE = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
type Tok = { sym: string; addr: string; dec: number; custom?: boolean };
const BASE: Tok[] = [
  { sym: 'GRAM', addr: NATIVE, dec: 9 },
  { sym: 'USDT', addr: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', dec: 6 },
  { sym: 'STON', addr: 'EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmwG9T6bO', dec: 9 },
];
const ui = new TonConnectUI({ manifestUrl: location.origin + '/zenobia/tonconnect-manifest.json', buttonRootId: 'connect', actionsConfiguration: { twaReturnUrl: 'https://t.me/PalmyraLaunchBot' as `${string}://${string}` } });
const api = new StonApiClient();
let toks: Tok[] = [...BASE];
let from = BASE[0], to = BASE[1];
let slip = '0.01';
let sim: any = null;
let seq = 0, busy = false, timer: any = null;

const say = (m: string) => ($('log').textContent = m);
const same = (a: string, b: string) => { try { return Address.parse(a).equals(Address.parse(b)); } catch { return false; } };
const wallet = () => (ui.account ? Address.parse(ui.account.address) : null);

function fillSelects() {
  for (const [id, cur] of [['fromSel', from], ['toSel', to]] as const) {
    const s = $(id) as HTMLSelectElement;
    s.innerHTML = '';
    toks.forEach((t, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = t.sym + (t.custom ? ' (unverified)' : ''); if (t.addr === cur.addr) o.selected = true; s.appendChild(o); });
  }
}
async function addCustom(addrStr: string) {
  let a: Address;
  try { a = Address.parse(addrStr.trim()); } catch { say('That is not a valid token address.'); return null; }
  const key = a.toString({ bounceable: true, urlSafe: true });
  const have = toks.find((t) => same(t.addr, key));
  if (have) return have;
  try {
    const info: any = await api.getAsset(key);
    const t: Tok = { sym: String(info.symbol || 'TOKEN').slice(0, 12), addr: key, dec: Number(info.decimals ?? 9), custom: true };
    toks.push(t);
    return t;
  } catch { say('No trading pool was found for that token yet.'); return null; }
}

async function balanceText() {
  const w = wallet();
  if (!w) return;
  try {
    if (from.addr === NATIVE) { $('bal').textContent = 'Balance: ' + fmt(await client.getBalance(w), 9, 3) + ' GRAM'; return; }
    const info: any = await api.getWalletAsset({ walletAddress: w.toString(), assetAddress: from.addr });
    $('bal').textContent = 'Balance: ' + fmt(BigInt(info?.balance ?? '0'), from.dec, 3) + ' ' + from.sym;
  } catch { $('bal').textContent = ''; }
}

async function quote() {
  const my = ++seq;
  sim = null;
  const out = $('out');
  ($('go') as HTMLButtonElement).disabled = true;
  const raw = (($('amt') as HTMLInputElement).value || '').trim();
  if (!raw || Number(raw) <= 0 || from.addr === to.addr) { out.textContent = ''; return; }
  let units: bigint;
  try { units = parseUnits(raw, from.dec); } catch { out.textContent = 'Enter a valid amount.'; return; }
  out.textContent = 'Getting the best price…';
  try {
    const s: any = await api.simulateSwap({ offerAddress: from.addr, askAddress: to.addr, offerUnits: units.toString(), slippageTolerance: slip, referralAddress: OWNER.toString({ bounceable: false }), referralFeeBps: String(REF_BPS), dexVersion: ['2'] });
    if (my !== seq) return;
    sim = s;
    const impact = Number(s.priceImpact) * 100;
    const fee = Number(s.feePercent) * 100;
    out.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:6px"><span>You receive (about)</span><b>' + fmt(BigInt(s.askUnits), to.dec, 4) + ' ' + to.sym + '</b></div>'
      + '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:6px"><span>At least (after slippage)</span><b>' + fmt(BigInt(s.minAskUnits), to.dec, 4) + ' ' + to.sym + '</b></div>'
      + '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:6px"><span>Price impact</span><b style="color:' + (impact > 5 ? '#ff5d5d' : 'inherit') + '">' + impact.toFixed(2) + '%</b></div>'
      + '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:6px"><span>Total fees (pool + platform ' + (REF_BPS / 100).toFixed(2) + '%)</span><b>' + fee.toFixed(2) + '%</b></div>'
      + (impact > 5 ? '<div class="mut" style="color:#ff5d5d">High price impact: you would get much less than the market price. Try a smaller amount.</div>' : '')
      + (from.custom || to.custom ? '<div class="mut" style="color:#ff9f43">Unverified token: anyone can create a token with any name. Check the address before you swap.</div>' : '');
    ($('go') as HTMLButtonElement).disabled = !wallet() || busy;
  } catch (e: any) {
    if (my !== seq) return;
    out.textContent = 'No route was found for this pair or amount.';
  }
}
const later = () => { clearTimeout(timer); timer = setTimeout(quote, 450); };

async function swap() {
  const w = wallet();
  if (!w || !sim || busy) return;
  busy = true; ($('go') as HTMLButtonElement).disabled = true;
  try {
    const r = sim.router;
    const dex: any = dexFactory(r);
    const router: any = client.open(dex.Router.create(r.address));
    const proxyTon: any = dex.pTON.create(r.ptonMasterAddress);
    const base = { userWalletAddress: w.toString(), offerAmount: sim.offerUnits, minAskAmount: sim.minAskUnits, referralAddress: OWNER.toString(), referralValue: REF_BPS };
    let p: any;
    if (from.addr === NATIVE) p = await router.getSwapTonToJettonTxParams({ ...base, proxyTon, askJettonAddress: sim.askAddress });
    else if (to.addr === NATIVE) p = await router.getSwapJettonToTonTxParams({ ...base, proxyTon, offerJettonAddress: sim.offerAddress });
    else p = await router.getSwapJettonToJettonTxParams({ ...base, offerJettonAddress: sim.offerAddress, askJettonAddress: sim.askAddress });
    const msg = toTonConnect(p, { validUntil: Math.floor(Date.now() / 1000) + 600, network: '-239' });
    say('Confirm in your wallet…');
    await ui.sendTransaction(msg); (window as any).ZJ?.done('swap');
    say('Sent. It usually settles within a minute; your balance updates after that.');
    setTimeout(balanceText, 20000);
  } catch (e: any) { say('Not sent: ' + String(e?.message || e).slice(0, 160)); }
  busy = false; ($('go') as HTMLButtonElement).disabled = !sim || !wallet();
}

async function init() {
  const q = new URLSearchParams(location.search);
  for (const k of ['from', 'to']) { const v = q.get(k); if (v) { const t = await addCustom(v); if (t) { if (k === 'from') from = t; else to = t; } } }
  try { const c = await loadConfig(); if (c.open !== false) { /* ZNBt appears here once it has a DEX pool (after graduation) */ } } catch {}
  fillSelects();
  ($('fromSel') as HTMLSelectElement).onchange = (e: any) => { from = toks[Number(e.target.value)]; if (from.addr === to.addr) { to = toks.find((t) => t.addr !== from.addr)!; fillSelects(); } balanceText(); later(); };
  ($('toSel') as HTMLSelectElement).onchange = (e: any) => { to = toks[Number(e.target.value)]; if (from.addr === to.addr) { from = toks.find((t) => t.addr !== to.addr)!; fillSelects(); } later(); };
  $('flip').onclick = () => { [from, to] = [to, from]; fillSelects(); balanceText(); later(); };
  ($('amt') as HTMLInputElement).oninput = later;
  document.querySelectorAll('#slip button').forEach((b) => ((b as HTMLElement).onclick = () => { slip = (b as HTMLElement).dataset.s!; document.querySelectorAll('#slip button').forEach((x) => x.classList.toggle('on', x === b)); later(); }));
  $('addTok').onclick = async () => { const v = ($('tokAddr') as HTMLInputElement).value; if (!v.trim()) return; const t = await addCustom(v); if (t) { to = t.addr === from.addr ? to : t; fillSelects(); say(''); later(); } };
  $('go').onclick = swap;
  ui.onStatusChange(() => { balanceText(); ($('go') as HTMLButtonElement).disabled = !sim || !wallet() || busy; });
  balanceText();
  later();
}
init();
