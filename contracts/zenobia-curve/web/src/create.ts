import { Address } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { BondingCurveMasterV2, launchOptions, toTonConnect } from '../../sdk/dist/index.js';
import { client, sdk, $, loadConfig, retry, parseUnits } from './common';
import { beginCell, Dictionary } from '@ton/core';
import { sha256_sync } from '@ton/crypto';

const NANO = 1_000_000_000n;
const ui = new TonConnectUI({ manifestUrl: location.origin + '/zenobia/tonconnect-manifest.json', buttonRootId: 'connect' });
const val = (id: string) => (($(id) as HTMLInputElement).value || '').trim();
const say = (m: string) => ($('log').textContent = m);

function snake(data: Buffer) {
  const MAX = 127;
  const parts: Buffer[] = [Buffer.concat([Buffer.from([0]), data.subarray(0, MAX - 1)])];
  for (let i = MAX - 1; i < data.length; i += MAX) parts.push(data.subarray(i, i + MAX));
  let cell: any = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const b = beginCell().storeBuffer(parts[i]);
    if (cell) b.storeRef(cell);
    cell = b.endCell();
  }
  return cell;
}
function metadata(name: string, symbol: string, description: string, image: string) {
  const d = Dictionary.empty(Dictionary.Keys.Buffer(32), Dictionary.Values.Cell());
  const set = (k: string, v: string) => d.set(sha256_sync(k), snake(Buffer.from(v, 'utf8')));
  set('name', name); set('symbol', symbol); set('decimals', '9'); set('description', description);
  if (image) set('image', image);
  return beginCell().storeUint(0, 8).storeDict(d).endCell();
}

function totalFee() {
  const c = Number(val('fee'));
  $('total').textContent = ((150 + c) / 100).toFixed(2).replace(/\.?0+$/, '') + '%';
}
($('fee') as HTMLElement).onchange = totalFee;
totalFee();

// live preview, symbol hygiene and a warning when the symbol is already taken or imitates a well-known one
const RESERVED = new Set(['TON', 'USDT', 'USDC', 'BTC', 'ETH', 'NOT', 'DOGS', 'HMSTR', 'CATI', 'STON', 'DUST', 'ZNB', 'ZNBT', 'TELEGRAM', 'DURGER', 'GRAM']);
let takenSymbols = new Map<string, string>();
fetch('/api/zenobia/coins/index').then((r) => r.json()).then((j) => { for (const c of j.coins || []) takenSymbols.set(String(c.symbol).toUpperCase(), c.curve); }).catch(() => {});
function preview() {
  const sym = val('symbol').toUpperCase();
  $('pvTitle').textContent = (val('name') || 'Your coin · عملتك') + (sym ? ' · ' + sym : '');
  $('pvDesc').textContent = val('desc') || '…';
  const img = $('pvImg') as HTMLImageElement, u = val('image');
  if (/^https:\/\/[^\s"'<>]{4,200}$/.test(u)) { img.referrerPolicy = 'no-referrer'; img.onerror = () => { img.style.display = 'none'; $('symWarn').textContent = 'The image link could not be loaded. · تعذّر تحميل الصورة'; }; img.onload = () => { $('symWarn').textContent = ''; }; img.src = u; img.style.display = 'block'; } else img.style.display = 'none';
  const w = RESERVED.has(sym) ? 'This symbol imitates a well-known coin and will be hidden. · الرمز يحاكي عملة معروفة وسيُخفى.' : takenSymbols.has(sym) ? 'A coin with this symbol already exists. Choose another to avoid confusion. · الرمز مستخدم.' : '';
  if (w || !$('symWarn').textContent.startsWith('The image')) $('symWarn').textContent = w;
}
for (const id of ['name', 'symbol', 'desc', 'image']) ($(id) as HTMLElement).oninput = preview;
($('symbol') as HTMLInputElement).addEventListener('input', (e) => { const t = e.target as HTMLInputElement; t.value = t.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

$('go').onclick = async () => {
  try {
    const cfgOpen = await loadConfig();
    if (!(cfgOpen as any).open) throw new Error('Launches are not open yet / الإطلاق غير مفتوح بعد');
    if (!ui.account) throw new Error('Connect your wallet first / اربط محفظتك أولاً');
    const creator = Address.parse(ui.account.address);
    const name = val('name'), symbol = val('symbol'), description = val('desc'), image = val('image');
    if (name.length < 2 || name.length > 32) throw new Error('Name: 2 to 32 characters');
    if (!/^[A-Za-z0-9]{2,10}$/.test(symbol)) throw new Error('Symbol: 2 to 10 letters or digits');
    if (RESERVED.has(symbol.toUpperCase())) throw new Error('This symbol imitates a well-known coin. Choose another. / الرمز يحاكي عملة معروفة');
    if (description.length > 300) throw new Error('Description: at most 300 characters');
    if (image && !/^https:\/\/[^\s"'<>]{4,200}$/.test(image)) throw new Error('Image must be an https link');
    if (!($('agree') as HTMLInputElement).checked) throw new Error('Please accept the notice / وافق على التنبيه');
    const cfg: any = {
      supplyTokens: Number(val('supply')),
      creatorFeeBps: Number(val('fee')),
      graduationTon: Number(val('threshold')),
      reserveRatio: 5,
      devBuyAmount: parseUnits(val('dev') || '0'),
    };
    const options = launchOptions(cfg);
    const cfgJson = await loadConfig();
    const master = Address.parse(cfgJson.master);
    const rnd = crypto.getRandomValues(new Uint32Array(2));
    const salt = (BigInt(rnd[0]) << 32n) | BigInt(rnd[1]);
    const body = BondingCurveMasterV2.createCellOfCreateLaunch({
      queryId: 0n, salt, options: { ref: options } as any, metadata: metadata(name, symbol, description, image),
    });
    const curve = await retry(() => sdk.getLaunchAddress(master, creator, salt, cfg));
    await ui.sendTransaction(toTonConnect({ to: master, value: cfg.devBuyAmount + NANO, body, bounce: true }, { validUntil: Math.floor(Date.now() / 1000) + 600, network: '-239' }));
    $('result').style.display = 'block';
    const link = `/zenobia/trade.html?c=${encodeURIComponent(curve.toString({ bounceable: true }))}`;
    ($('resultLink') as HTMLAnchorElement).href = link;
    $('resultAddr').textContent = curve.toString({ bounceable: true });
    say('Sent. The coin appears in about a minute. / أُرسل الطلب، تظهر العملة خلال دقيقة تقريباً.');
  } catch (e: any) {
    say('Error: ' + (e.message || e));
  }
};
void client;

loadConfig().then((c) => { if (!c.open) { $('closed').style.display = 'block'; ($('go') as HTMLButtonElement).disabled = true; } }).catch(() => {});


// ---- what the creator gets: the curve sells every token (there is no free allocation); the creator's share is the first buy, at the lowest price ----
let estTimer: ReturnType<typeof setTimeout> | undefined;
async function estimate() {
  const box = document.getElementById('est');
  if (!box) return;
  try {
    const cfgJson = await loadConfig();
    const cfg: any = { supplyTokens: Number(val('supply')), creatorFeeBps: Number(val('fee')), graduationTon: Number(val('threshold')), reserveRatio: 5, devBuyAmount: 0n };
    const pv = await retry(() => sdk.getLaunchPreview(Address.parse(cfgJson.master), cfg));
    const price = Number(pv.initialPriceNanoPerBillion);            // nano TON per billion tokens at launch
    const grad = Number(pv.graduationPriceNanoPerBillion);
    const dev = Number(val('dev') || '0');
    const perTon = price > 0 ? 1e18 / price : 0;   // the preview prices are nano TON per billion tokens
    const supply = Number(val('supply'));
    const mine = dev * perTon;
    const lines = [
      'Starting price: 1 TON ≈ ' + Math.round(perTon).toLocaleString('en-US') + ' tokens · price at graduation is about ' + (price > 0 ? (grad / price).toFixed(0) : '?') + '× higher.',
      dev > 0 ? 'Your first buy of ' + dev + ' TON gets you ≈ ' + Math.round(mine).toLocaleString('en-US') + ' tokens (≈ ' + (supply > 0 ? ((mine / supply) * 100).toFixed(2) : '0') + '% of the supply) at the lowest price the curve ever offers.' : 'First buy is 0: you will hold none of your own coin until you buy it on its page. Every token is sold by the curve; there is no free allocation.',
    ];
    box.textContent = lines.join('\n');
  } catch { box.textContent = ''; }
}
for (const id of ['supply', 'fee', 'threshold', 'dev']) ($(id) as HTMLElement).addEventListener('input', () => { clearTimeout(estTimer); estTimer = setTimeout(estimate, 700); });
for (const id of ['supply', 'fee', 'threshold']) ($(id) as HTMLElement).addEventListener('change', () => { clearTimeout(estTimer); estTimer = setTimeout(estimate, 300); });
setTimeout(estimate, 500);
