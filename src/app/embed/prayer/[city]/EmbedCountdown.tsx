"use client";

import { useEffect, useState } from "react";

export default function EmbedCountdown({ nextName, nextIso }: { nextName: string; nextIso: string }) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    function tick() {
      const ms = new Date(nextIso).getTime() - Date.now();
      if (ms <= 0) {
        // The prayer has started: show it, then fetch the new schedule a
        // minute later (once — a skewed client clock can't cause a loop).
        setLeft("الآن");
        if (!reloadTimer) reloadTimer = setTimeout(() => window.location.reload(), 60_000);
        return;
      }
      const t = Math.floor(ms / 1000);
      setLeft(`${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, [nextIso]);
  return (
    <p className="mt-2 text-center text-xs">
      {nextName} {left === "الآن" ? "" : "بعد "}<span className="font-mono font-bold tabular-nums">{left}</span>
    </p>
  );
}
