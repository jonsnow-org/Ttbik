// Post-launch check of the ZNBt coin straight from the chain. Usage: node verify.cjs <coin address> [master address]
import { Address } from '@ton/core';
import { client, sdk, OWNER, retry, fmt } from './common';
import { readMeta } from './registry';

const ok = (b: boolean) => (b ? 'OK  ' : 'FAIL');
let failed = 0;
const check = (name: string, good: boolean, detail = '') => { if (!good) failed++; console.log(`${ok(good)} ${name}${detail ? ' : ' + detail : ''}`); };

async function main() {
  const curve = Address.parse(process.argv[2]);
  const master = Address.parse(process.argv[3] || 'EQAagBm1wghWIl9mtEYclWgS6vtYuy9NiekxAXM1ArjsDCh-');
  const m = await retry(() => client.getContractState(master));
  check('master is deployed', m.state === 'active');
  const md = await retry(() => sdk.master(master).getMasterData());
  check('master admin is the owner wallet', md.admin.equals(OWNER));
  check('master treasury is the owner wallet', md.treasury.equals(OWNER));
  console.log('     launches on the master:', md.totalLaunches.toString(), '| platform fees waiting:', fmt(md.feesBalance, 9, 3), 'TON');
  const c = await retry(() => client.getContractState(curve));
  check('coin curve is deployed', c.state === 'active');
  const status = await retry(() => sdk.getLaunchStatus(curve));
  check('coin is trading (status 1)', status === 1n, 'status ' + status);
  const d = await retry(() => sdk.getCurveData(curve));
  check('minter exists', !!d.jettonMinter);
  const rates = await retry(() => sdk.curve(curve).getFeeRates());
  check('platform fee is 1.5%', Number(rates.curveProtocolBps) === 150, 'protocol bps ' + rates.curveProtocolBps);
  check('creator fee is 1.5%', Number(rates.curveCreatorBps) === 150, 'creator bps ' + rates.curveCreatorBps);
  if (d.jettonMinter) {
    const jd = await retry(() => sdk.minter(d.jettonMinter!).getJettonData());
    check('total supply is 9,000,000,000', jd.totalSupply === 9_000_000_000n * 1_000_000_000n, fmt(jd.totalSupply, 9, 0));
    const meta = readMeta(jd.jettonContent as any);
    check('name and symbol', meta.name === 'Zenobia of Tadmor' && meta.symbol === 'ZNBt', `${meta.name} / ${meta.symbol}`);
    check('icon points to the age-badge endpoint', meta.image === 'https://ttbik-gate.jonsnowx1r.workers.dev/api/zenobia/znbt/icon', meta.image);
    console.log('     minter:', d.jettonMinter.toString({ bounceable: true }));
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('error:', e.message || e); process.exit(2); });
