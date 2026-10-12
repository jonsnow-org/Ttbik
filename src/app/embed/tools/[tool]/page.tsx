import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EMBED_TOOLS } from "@/lib/embedTools";
import { SITE_URL } from "@/lib/siteUrl";
import EmbeddedTool from "./EmbeddedTool";

// Widget copy of a free tool for other people's sites. Kept out of the search
// index so the canonical /free-tools/<tool> page is the one that ranks.
export const metadata: Metadata = { robots: { index: false, follow: true } };

export default async function EmbedToolPage(props: { params: Promise<{ tool: string }> }) {
  const { tool } = await props.params;
  const meta = EMBED_TOOLS[tool];
  if (!meta) notFound();
  const home = `${SITE_URL}/free-tools/${tool}?utm_source=embed&utm_medium=widget`;
  return (
    <div dir="rtl" className="mx-auto max-w-xl bg-white px-3 py-4">
      <EmbeddedTool slug={tool} />
      <p className="mt-4 border-t border-slate-100 pt-3 text-center text-xs text-slate-500">
        تم التطوير بواسطة{" "}
        <a href={home} target="_blank" rel="noopener" className="font-bold text-indigo-700 hover:underline">
          شام AI
        </a>{" "}
        — أدوات مجانية بالعربي
      </p>
    </div>
  );
}
