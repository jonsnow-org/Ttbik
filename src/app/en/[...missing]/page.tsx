import { notFound } from "next/navigation";

// Unmatched /en/* URLs fall through to here (catch-all has the lowest priority) so they get the
// English 404 (en/not-found.tsx) instead of the Arabic root one.
export default function EnMissing() {
  notFound();
}
