"use client";

import SegmentError from "@/components/SegmentError";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError error={error} reset={reset} title="تعذّر تحميل الأخبار" />;
}
