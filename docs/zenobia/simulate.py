#!/usr/bin/env python3
"""Toy simulation of the season reward formula (design checks, not a forecast).

Checks:
  1. Splitting a balance over many wallets must not pay more (linear shares are split-neutral, sqrt is not).
  2. How a trader, a holder and a wash trader fare under different weights.
Run: python3 simulate.py
"""
import random, math
random.seed(7)

def season(wallets, weights, pool, wash_cap_mult=3.0):
    """wallets: list of dicts(avg_bal, volume, accum). Returns reward per wallet."""
    wh, wt, wa = weights
    sh = sum(w['avg_bal'] for w in wallets) or 1
    capped = [min(w['volume'], wash_cap_mult * w['avg_bal']) for w in wallets]
    st = sum(capped) or 1
    sa = sum(max(0, w['accum']) for w in wallets) or 1
    out = []
    for w, c in zip(wallets, capped):
        s = wh * w['avg_bal'] / sh + wt * c / st + wa * max(0, w['accum']) / sa
        out.append(pool * s)
    return out

def crowd(n=300):
    ws = []
    for i in range(n):
        kind = random.choices(['holder', 'trader', 'whale'], [0.6, 0.35, 0.05])[0]
        if kind == 'holder':
            b = random.uniform(1, 8); ws.append(dict(kind=kind, avg_bal=b, volume=random.uniform(0, 0.3) * b, accum=random.uniform(0, 1)))
        elif kind == 'trader':
            b = random.uniform(1, 6); ws.append(dict(kind=kind, avg_bal=b, volume=random.uniform(2, 8) * b, accum=random.uniform(-1, 1)))
        else:
            b = random.uniform(30, 120); ws.append(dict(kind=kind, avg_bal=b, volume=random.uniform(0.2, 2) * b, accum=random.uniform(0, 10)))
    return ws

CONFIGS = {'hold only 100/0/0': (1, 0, 0), 'proposed 30/40/30': (0.3, 0.4, 0.3), 'trade heavy 10/70/20': (0.1, 0.7, 0.2)}
POOL = 10.0  # TON per season (example)

print('== 1. rewards by wallet type (average per wallet, TON, pool=%s)' % POOL)
base = crowd()
for name, cfg in CONFIGS.items():
    r = season(base, cfg, POOL)
    by = {}
    for w, x in zip(base, r): by.setdefault(w['kind'], []).append(x)
    print(f"{name:24s}", {k: round(sum(v) / len(v), 4) for k, v in by.items()}, '| share to traders:', round(sum(by['trader']) / POOL, 3))

print('\n== 2. splitting one 40 TON wallet into k wallets (proposed weights)')
for k in (1, 5, 20):
    ws = [dict(kind='x', avg_bal=1, volume=1, accum=0.5) for _ in range(200)]
    me = [dict(kind='me', avg_bal=40 / k, volume=60 / k, accum=4 / k) for _ in range(k)]
    r = season(ws + me, CONFIGS['proposed 30/40/30'], POOL)
    tot = sum(r[len(ws):])
    # sqrt variant (the rejected suggestion)
    sq = lambda w: dict(w, avg_bal=math.sqrt(w['avg_bal']))
    r2 = season([sq(w) for w in ws + me], CONFIGS['hold only 100/0/0'], POOL)
    print(f"k={k:2d}: linear total {tot:.3f} TON | sqrt(balance) hold-only total {sum(r2[len(ws):]):.3f} TON")

print('\n== 3. wash trading: when does it pay? (platform fee 1% per trade, paid to the platform, not to the pool)')
for pool in (2, 10, 50):
    ws = crowd(300)
    bal = 5.0
    atk = dict(kind='wash', avg_bal=bal, volume=3.0 * bal, accum=0)  # volume at the cap
    before = season(ws, CONFIGS['proposed 30/40/30'], pool)
    after = season(ws + [atk], CONFIGS['proposed 30/40/30'], pool)
    gain = after[-1]
    cost = 0.01 * atk['volume']
    print(f"pool={pool:3d} TON: attacker reward {gain:.3f}, fee cost {cost:.3f} -> net {gain - cost:+.3f} TON")


# ---------------------------------------------------------------------------
# 4. Per-person scoring: one Telegram identity bound to its wallets (ton_proof), concave transform.
#    Splitting wallets no longer helps (balances are summed per person), so square-root is safe to use.
# ---------------------------------------------------------------------------
print('\n== 4. whale share of the pool: linear per-wallet vs concave per-person (proposed weights)')
def season_person(wallets, weights, pool, transform):
    wh, wt, wa = weights
    cap = [min(w['volume'], 3.0 * w['avg_bal']) for w in wallets]
    t = [transform(w['avg_bal']) for w in wallets]
    c = [transform(x) for x in cap]
    a = [transform(max(0, w['accum'])) for w in wallets]
    sh, st, sa = (sum(t) or 1), (sum(c) or 1), (sum(a) or 1)
    return [pool * (wh * x / sh + wt * y / st + wa * z / sa) for x, y, z in zip(t, c, a)]
ws = crowd(300)
pool = 10.0
lin = season(ws, CONFIGS['proposed 30/40/30'], pool)
cav = season_person(ws, CONFIGS['proposed 30/40/30'], pool, math.sqrt)
for name, r in (('linear per wallet', lin), ('sqrt per person', cav)):
    by = {}
    for w, x in zip(ws, r): by.setdefault(w['kind'], []).append(x)
    print(f"{name:20s}", {k: round(sum(v) / len(v), 4) for k, v in by.items()}, '| whales share:', round(sum(by['whale']) / pool, 3), '| holders share:', round(sum(by['holder']) / pool, 3))
