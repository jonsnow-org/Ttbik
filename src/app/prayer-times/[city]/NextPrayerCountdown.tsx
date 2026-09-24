"use client";

import { useEffect, useState } from "react";

export default function NextPrayerCountdown({
  nextName,
  nextIso,
}: {
  nextName: string;
  nextIso: string;
}) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    function tick() {
      const ms = new Date(nextIso).getTime() - Date.now();
      if (ms <= 0) {
        setLabel("حان الوقت — حدّث الصفحة لجدول اليوم.");
        return;
      }
      const total = Math.floor(ms / 1000);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      setLabel(`${h}س ${m}د ${s}ث`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextIso]);

  return (
    <p className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
      الصلاة التالية: <strong>{nextName}</strong>
      {label ? ` — متبقٍ ${label}` : ""}
    </p>
  );
}
