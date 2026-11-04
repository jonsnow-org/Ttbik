/**
 * Calculate percentage change relative to the starting value.
 * A zero starting value has no defined percentage-change result.
 */
export function calculatePercentageChange(oldValue: number, newValue: number): number | null {
  if (!Number.isFinite(oldValue) || !Number.isFinite(newValue) || oldValue === 0) {
    return null;
  }
  return ((newValue - oldValue) / Math.abs(oldValue)) * 100;
}
