"use client";
import { useEffect } from "react";
import { indexOf } from "@/lib/dates";

// The bot's "Today's token" button opens here: go straight to today's date (the visitor's own calendar day).
export default function Today() {
  useEffect(() => {
    const n = new Date();
    const lang = new URLSearchParams(window.location.search).get("lang");
    window.location.replace(`/date?i=${indexOf(n.getFullYear(), n.getMonth() + 1, n.getDate())}${lang ? `&lang=${encodeURIComponent(lang)}` : ""}`);
  }, []);
  return <p className="muted" style={{ textAlign: "center", marginTop: 40 }}>…</p>;
}
