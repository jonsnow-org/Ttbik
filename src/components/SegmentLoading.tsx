/** Lightweight Arabic skeleton for segment loading.tsx files. */
export default function SegmentLoading({ label }: { label: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" dir="rtl" lang="ar" aria-busy="true" aria-label={label}>
      <div className="mb-4 h-4 w-40 animate-pulse rounded bg-slate-200" />
      <div className="mb-6 h-8 w-64 max-w-full animate-pulse rounded bg-slate-200" />
      <div className="mb-4 h-4 w-full animate-pulse rounded bg-slate-100" />
      <div className="mb-8 h-4 w-4/5 max-w-full animate-pulse rounded bg-slate-100" />
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    </main>
  );
}
