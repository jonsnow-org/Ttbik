/** What the owner is told when ZNB's holders or supply change (a buy, a sell, a new holder). Pure: no network. */
export interface WatchState { holders: number; supply: string; owners: string[] }

const fmt = (units: bigint, decimals: number) => {
  const neg = units < 0n; const a = neg ? -units : units;
  const whole = a / 10n ** BigInt(decimals);
  return (neg ? "-" : "+") + whole.toLocaleString("en-US");
};
const short = (a: string) => (a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a);

export function watchMessage(prev: WatchState | null, cur: WatchState, decimals: number, link: string): string | null {
  if (!prev) return null; // the first look is only the baseline
  const dSupply = BigInt(cur.supply) - BigInt(prev.supply);
  const dHolders = cur.holders - prev.holders;
  if (dSupply === 0n && dHolders === 0) return null;
  const newOwners = cur.owners.filter((o) => !prev.owners.includes(o));
  const lines = ["🔔 ZNB تحرّكت على السلسلة"];
  if (dSupply > 0n) lines.push(`🛒 شراء على المنحنى: ${fmt(dSupply, decimals)} ZNB خرجت إلى المتداول`);
  if (dSupply < 0n) lines.push(`💱 بيع أو حرق: ${fmt(dSupply, decimals)} ZNB عادت`);
  if (dHolders !== 0) lines.push(`👥 الحاملون: ${prev.holders} ← ${cur.holders}`);
  if (newOwners.length) lines.push(`حامل جديد: ${newOwners.slice(0, 3).map(short).join("، ")}`);
  lines.push(link);
  return lines.join("\n");
}
