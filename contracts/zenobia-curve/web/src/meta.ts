import { Cell, Dictionary, Slice } from '@ton/core';
import { sha256_sync } from '@ton/crypto';

function snakeText(c: Cell | undefined): string {
  if (!c) return '';
  let s: Slice = c.beginParse();
  if (s.remainingBits < 8 || s.loadUint(8) !== 0) return '';
  const parts: Buffer[] = [];
  for (;;) {
    parts.push(s.loadBuffer(Math.floor(s.remainingBits / 8)));
    if (s.remainingRefs === 0) break;
    s = s.loadRef().beginParse();
  }
  return Buffer.concat(parts).toString('utf8');
}

export function readMeta(meta: Cell) {
  const out = { name: '', symbol: '', description: '', image: '' };
  try {
    const s = meta.beginParse();
    if (s.loadUint(8) !== 0) return out;
    const d = s.loadDict(Dictionary.Keys.Buffer(32), Dictionary.Values.Cell());
    const get = (k: string) => snakeText(d?.get(sha256_sync(k)));
    out.name = get('name').slice(0, 64);
    out.symbol = get('symbol').slice(0, 16);
    out.description = get('description').slice(0, 400);
    const img = get('image');
    out.image = /^https:\/\/[^\s"'<>]{4,300}$/.test(img) ? img : '';
  } catch {}
  return out;
}

