import { Address, beginCell } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import {
  BondingCurveMasterV2,
  deployMaster,
  launchOptions,
  toTonConnect,
  deployment,
} from '../../sdk/dist/index.js';
import { client, sdk, OWNER, $, loadConfig, retry, parseUnits } from './common';
import { onchainMetadata } from './metadata';

const NANO = 1_000_000_000n;
const SALT = 1_000_001n;
const CONFIG = {
  supplyTokens: 9_000_000_000 as const,
  creatorFeeBps: 150 as const,
  graduationTon: 1000 as const,
  reserveRatio: 5 as const,
};

const ui = new TonConnectUI({
  manifestUrl: location.origin + '/zenobia/tonconnect-manifest.json',
  buttonRootId: 'connect',
  actionsConfiguration: { twaReturnUrl: 'https://t.me/PalmyraLaunchBot' as `${string}://${string}` },
});

const say = (m: string) => ($('log').textContent = m);

function wallet(): Address | null {
  return ui.account ? Address.parse(ui.account.address) : null;
}
function guard(): Address {
  const w = wallet();
  if (!w) throw new Error('Connect the wallet first');
  if (!w.equals(OWNER)) throw new Error('This page only works with the owner wallet');
  return w;
}
const send = (tx: any) =>
  ui.sendTransaction(toTonConnect(tx, { validUntil: Math.floor(Date.now() / 1000) + 600, network: '-239' }));

async function masterAddress(): Promise<Address> {
  const m = deployMaster(OWNER, OWNER);
  return m.to;
}

async function refresh() {
  try {
    const bal = await retry(() => client.getBalance(OWNER));
    $('bal').textContent = (Number(bal) / 1e9).toFixed(2) + ' TON';
    $('balWarn').textContent = bal < 4n * NANO ? 'Low: the launch needs about 3 TON plus your optional first buy and fees; keep at least 4 TON. · الرصيد قليل: يلزم نحو 3 TON على الأقل (احتفظ بـ4).' : '';
  } catch { $('bal').textContent = '—'; }
  const mAddr = await masterAddress();
  $('master').textContent = mAddr.toString({ bounceable: true });
  const st = await retry(() => client.getContractState(mAddr));
  $('masterState').textContent = st.state === 'active' ? 'deployed ✅' : 'not deployed yet';
  if (st.state === 'active') {
    try {
      const curve = await retry(() =>
        sdk.getLaunchAddress(mAddr, OWNER, SALT, { ...CONFIG, devBuyAmount: devBuy() }),
      );
      $('curve').textContent = curve.toString({ bounceable: true });
      const cs = await retry(() => client.getContractState(curve));
      $('curveState').textContent = cs.state === 'active' ? 'launched ✅' : 'not launched yet';
    } catch (e) {
      $('curve').textContent = '—';
    }
  }
}

function devBuy(): bigint {
  const v = ($('dev') as HTMLInputElement).value || '0';
  return parseUnits(v);
}

$('deploy').onclick = async () => {
  try {
    guard();
    await send(deployMaster(OWNER, OWNER, 2n * NANO));
    say('Master deployment sent. Wait ~30 seconds then press Refresh.');
  } catch (e: any) {
    say('Error: ' + (e.message || e));
  }
};

$('create').onclick = async () => {
  try {
    guard();
    const mAddr = await masterAddress();
    const dev = devBuy();
    const options = launchOptions({ ...CONFIG, devBuyAmount: dev });
    const body = BondingCurveMasterV2.createCellOfCreateLaunch({
      queryId: 0n,
      salt: SALT,
      options: { ref: options } as any,
      metadata: onchainMetadata(),
    });
    await send({ to: mAddr, value: dev + NANO, body, bounce: true });
    say('Launch sent. Wait ~1 minute then press Refresh.');
  } catch (e: any) {
    say('Error: ' + (e.message || e));
  }
};

$('refresh').onclick = () => refresh().catch((e) => say('Error: ' + (e.message || e)));
refresh().catch(() => {});
