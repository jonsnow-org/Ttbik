import { Address } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { BondingCurveMasterV2, launchOptions, toTonConnect } from '../../sdk/dist/index.js';
import { client, sdk, $, loadConfig, retry, parseUnits } from './common';
import { beginCell, Dictionary } from '@ton/core';
import { sha256_sync } from '@ton/crypto';

const NANO = 1_000_000_000n;
const ui = new TonConnectUI({ manifestUrl: 'https://ttbik.vercel.app/zenobia/tonconnect-manifest.json', buttonRootId: 'connect' });
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

$('go').onclick = async () => {
  try {
    if (!ui.account) throw new Error('Connect your wallet first / اربط محفظتك أولاً');
    const creator = Address.parse(ui.account.address);
    const name = val('name'), symbol = val('symbol'), description = val('desc'), image = val('image');
    if (name.length < 2 || name.length > 32) throw new Error('Name: 2 to 32 characters');
    if (!/^[A-Za-z0-9]{2,10}$/.test(symbol)) throw new Error('Symbol: 2 to 10 letters or digits');
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
