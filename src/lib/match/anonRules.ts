/**
 * Pure pairing rules for the random (anonymous) chat, shared by the bot and the Mini App.
 * A filter only counts when it is "active" for that queue entry: the user owned the
 * 🎛 anon-filters entitlement when they entered the queue (see activeFilterFor).
 */
import { anonCandidateOk, anonFilterIsEmpty, type AnonFilter } from "@/lib/match/premium";

export type AnonProfile = { gender: string; age: number; country: string } | null;
export type AnonSide = { profile: AnonProfile; filter: AnonFilter | null };

function satisfies(filter: AnonFilter | null, other: AnonProfile): boolean {
  if (!filter || anonFilterIsEmpty(filter)) return true;
  return anonCandidateOk(other, filter);
}
/** Mutual: each side's active filter must be satisfied by the other side's profile. */
export function anonPairOk(a: AnonSide, b: AnonSide): boolean {
  return satisfies(a.filter, b.profile) && satisfies(b.filter, a.profile);
}
export type AnonFilterRow = { filter: AnonFilter | null; paid_until: Date | null; active_queue_id: string | null } | null;
/** The filter applied to a given queue row: only if it was snapshotted onto that row at entry. */
export function activeFilterFor(row: AnonFilterRow, queueId: string | null | undefined, entitledNow = true): AnonFilter | null {
  // Feature expired mid-queue → the filter is simply no longer applied (and nothing is charged).
  if (!entitledNow || !row || !row.filter || anonFilterIsEmpty(row.filter) || !queueId || row.active_queue_id !== queueId) return null;
  return row.filter;
}
export function describeAnonFilter(f: AnonFilter | null): string {
  if (!f || anonFilterIsEmpty(f)) return "بدون فلاتر";
  const parts: string[] = [];
  if (f.gender) parts.push(f.gender === "MALE" ? "ذكر" : "أنثى");
  if (f.country) parts.push(f.country);
  if (f.ageMin != null || f.ageMax != null) parts.push(`العمر ${f.ageMin ?? 18}–${f.ageMax ?? "∞"}`);
  return parts.join(" · ");
}
