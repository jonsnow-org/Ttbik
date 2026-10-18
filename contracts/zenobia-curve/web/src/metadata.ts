import { beginCell, Builder, Cell, Dictionary } from '@ton/core';
import { sha256_sync } from '@ton/crypto';
// @ts-ignore
import smallIcon from '../../../../public/zenobia/znbt-coin-small.webp';

export const COIN = {
  name: 'Zenobia of Tadmor',
  symbol: 'ZNBt',
  decimals: '9',
  description:
    'Zenobia of Tadmor (ZNBt): a coin that remembers your journey. Hold it and grow from Child to Queen to Warrior; sell everything and you become a Captive; burn it all and you become a Legend. Stored on-chain. أول عملة تحمل رحلة حاملها في عقدها.',
  // the permanent address of the gate (it follows whichever server is up); the icon endpoint adds the coin's age badge (new, 1d..29d, 1m..11m, 1y..10y); the small copy below (image_data) has no badge and never depends on a server
  image: 'https://ttbik-gate.jonsnowx1r.workers.dev/api/zenobia/znbt/icon',
};

// TEP-64 snake data: 0x00 prefix byte, then bytes spread over a chain of cells.
function snake(data: Buffer): Cell {
  const MAX = 127;
  const parts: Buffer[] = [];
  let first = Buffer.concat([Buffer.from([0]), data.subarray(0, MAX - 1)]);
  parts.push(first);
  for (let i = MAX - 1; i < data.length; i += MAX) parts.push(data.subarray(i, i + MAX));
  let cell: Cell | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const b: Builder = beginCell().storeBuffer(parts[i]);
    if (cell) b.storeRef(cell);
    cell = b.endCell();
  }
  return cell!;
}

export function onchainMetadata(): Cell {
  const dict = Dictionary.empty(Dictionary.Keys.Buffer(32), Dictionary.Values.Cell());
  const set = (k: string, v: Buffer | string) =>
    dict.set(sha256_sync(k), snake(typeof v === 'string' ? Buffer.from(v, 'utf8') : v));
  set('name', COIN.name);
  set('symbol', COIN.symbol);
  set('decimals', COIN.decimals);
  set('description', COIN.description);
  set('image', COIN.image);
  set('image_data', Buffer.from(smallIcon as Uint8Array));
  return beginCell().storeUint(0, 8).storeDict(dict).endCell();
}
