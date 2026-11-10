"use client";
import { usePathname } from "next/navigation";
import ToolSponsor from "@/components/ToolSponsor";
import { OWN_SPONSOR_SLOT, SPONSOR_TOOL_IDS } from "@/lib/sponsorTools";

// The sponsor line for every sponsorable free tool, placed once by app/free-tools/layout.tsx.
export default function ToolSponsorAuto() {
  const slug = (usePathname() || "").split("/")[2] || "";
  if (!SPONSOR_TOOL_IDS.has(slug) || OWN_SPONSOR_SLOT.has(slug)) return null;
  return <div className="mx-auto max-w-3xl px-4"><ToolSponsor tool={slug} /></div>;
}
