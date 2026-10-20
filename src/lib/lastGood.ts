// Market feeds fail now and then (a provider times out, rate-limits one IP). A ticker full of dashes is worse than a number a few minutes old,
// so each snapshot keeps the last good value per field in memory and uses it, for a limited time, when the fresh fetch has none.
const store = new Map<string, { at: number; value: unknown }>();

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Fill null numbers (and empty-valued rows) of `next` from the previous good snapshot of the same `key`, if that is younger than `maxAgeMs`. */
export function keepLastGood<T extends Record<string, unknown>>(key: string, next: T, maxAgeMs = 6 * 3600 * 1000, now = Date.now()): T {
  const prev = store.get(key);
  const usable = prev && now - prev.at <= maxAgeMs ? (prev.value as Record<string, unknown>) : null;
  const out: Record<string, unknown> = { ...next };
  let anyFresh = false;
  for (const [k, v] of Object.entries(next)) {
    if (isNum(v)) anyFresh = true;
    if (v == null && usable && isNum(usable[k])) out[k] = usable[k];
    else if (Array.isArray(v) && usable && Array.isArray(usable[k])) {
      const old = usable[k] as Record<string, unknown>[];
      out[k] = (v as Record<string, unknown>[]).map((row, i) => {
        if (!row || typeof row !== "object") return row;
        const o = old[i] && typeof old[i] === "object" ? old[i] : null;
        const fixed: Record<string, unknown> = { ...row };
        for (const [rk, rv] of Object.entries(row)) if (rv == null && o && isNum(o[rk]) && (o.code ?? o.pair ?? o.name) === (row.code ?? row.pair ?? row.name)) fixed[rk] = o[rk];
        return fixed;
      });
      for (const row of out[k] as Record<string, unknown>[]) for (const rv of Object.values(row ?? {})) if (isNum(rv)) anyFresh = true;
    }
  }
  if (anyFresh) store.set(key, { at: now, value: out });
  return out as T;
}

/** Wait for `p` at most `ms`; null on timeout or error, so a slow provider never holds a page render. */
export function withinMs<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}
