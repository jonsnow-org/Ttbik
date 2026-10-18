/** The age badge of the ZNBt coin icon: "new", 1d..29d, 1m..11m, 1y..10y. The matching pre-rendered file is /zenobia/znbt/age/<label>.webp. */
export function ageLabel(launchedAtMs: number, nowMs: number): string {
  if (!Number.isFinite(launchedAtMs) || launchedAtMs <= 0 || nowMs < launchedAtMs) return "new";
  const days = Math.floor((nowMs - launchedAtMs) / 86_400_000);
  if (days < 1) return "new";
  if (days < 30) return `${days}d`;
  if (days < 360) return `${Math.floor(days / 30)}m`;
  return `${Math.min(10, Math.max(1, Math.floor(days / 365)))}y`;
}
export const AGE_LABELS: string[] = ["new", ...Array.from({ length: 29 }, (_, i) => `${i + 1}d`), ...Array.from({ length: 11 }, (_, i) => `${i + 1}m`), ...Array.from({ length: 10 }, (_, i) => `${i + 1}y`)];
