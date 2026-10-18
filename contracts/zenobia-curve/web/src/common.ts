import { Address } from '@ton/core';
import { TonClient } from '@ton/ton';
import { LaunchpadV2 } from '../../sdk/dist/index.js';

export const OWNER = Address.parse('UQBt3hzFFJ11GjBjzD523m3NnyhqRNyfKCmzVq9_zVfjQJSz');
export const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC' });
export const sdk = new LaunchpadV2((a: Address) => client.provider(a));
export const $ = (id: string) => document.getElementById(id) as HTMLElement;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// toncenter without a key allows ~1 request/second: retry politely
export async function retry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await sleep(1200 * (i + 1));
    }
  }
  throw last;
}

export async function loadConfig(): Promise<{ master: string; curve: string; open?: boolean; launchedAt?: string }> {
  const r = await fetch('/zenobia/znbt/config.json', { cache: 'no-store' });
  return r.json();
}

export function fmt(n: bigint, dec = 9, digits = 4): string {
  const neg = n < 0n;
  const v = neg ? -n : n;
  const base = 10n ** BigInt(dec);
  const whole = v / base;
  const frac = (v % base).toString().padStart(dec, '0').slice(0, digits);
  return (neg ? '-' : '') + whole.toLocaleString('en-US') + (digits ? '.' + frac : '');
}

export function parseUnits(s: string, dec = 9): bigint {
  const t = s.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') throw new Error('Invalid number');
  const [w, f = ''] = t.split('.');
  return BigInt(w || '0') * 10n ** BigInt(dec) + BigInt((f + '0'.repeat(dec)).slice(0, dec));
}
