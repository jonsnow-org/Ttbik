"use client";

import { useEffect, useRef } from "react";
import { downloadDataUrl } from "@/lib/download";

export type CardLine = { label: string; value: string };

export default function ShareCard({
  kicker,
  title,
  lines,
  note,
  path,
}: {
  kicker: string;
  title: string;
  lines: CardLine[];
  note?: string;
  path: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = 1080;
    const h = 1920;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#1e1b4b");
    g.addColorStop(1, "#b45309");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(70, 160, 940, 1500);
    ctx.fillStyle = "#fde68a";
    ctx.font = "700 42px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(kicker, w / 2, 280);
    ctx.fillStyle = "#fff";
    ctx.font = "800 72px sans-serif";
    wrap(ctx, title, w / 2, 400, 860, 84);
    ctx.textAlign = "right";
    lines.slice(0, 4).forEach((line, i) => {
      const y = 760 + i * 180;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(120, y, 840, 140);
      ctx.fillStyle = "#fde68a";
      ctx.font = "700 32px sans-serif";
      ctx.fillText(line.label, 900, y + 50);
      ctx.fillStyle = "#fff";
      ctx.font = "800 40px sans-serif";
      ctx.fillText(line.value, 900, y + 105);
    });
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "700 36px sans-serif";
    ctx.fillText("شام AI", w / 2, 1680);
    ctx.font = "500 28px sans-serif";
    ctx.fillText(`ttbik.vercel.app${path}`, w / 2, 1740);
    if (note) {
      ctx.font = "500 24px sans-serif";
      ctx.fillText(note, w / 2, 1800);
    }
  }, [kicker, title, lines, note, path]);

  function download() {
    const dataUrl = ref.current?.toDataURL("image/png") || "";
    if (!dataUrl) return;
    downloadDataUrl(dataUrl, "sham-card.png");
  }

  async function share() {
    const canvas = ref.current;
    if (!canvas) {
      download();
      return;
    }
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob && navigator.canShare?.({ files: [new File([blob], "sham-card.png", { type: "image/png" })] })) {
        const file = new File([blob], "sham-card.png", { type: "image/png" });
        await navigator.share({
          files: [file],
          title: title || "بطاقة شام",
          text: `ttbik.vercel.app${path}`,
        });
        return;
      }
    } catch {
      // fall through
    }
    // Fallback: share URL via Web Share or copy
    const url = `https://ttbik.vercel.app${path}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: title || "بطاقة شام", text: title, url });
        return;
      } catch {
        /* user cancelled or failed */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      alert("تم نسخ الرابط. يمكنك مشاركته يدوياً.");
    } catch {
      download();
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-3">
      <canvas ref={ref} className="mx-auto h-80 w-auto rounded-xl" />
      <div className="mt-2 flex justify-center gap-2">
        <button type="button" onClick={download} className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">تنزيل البطاقة</button>
        <button type="button" onClick={share} className="rounded-full border px-3 py-1 text-xs font-bold">مشاركة</button>
      </div>
    </div>
  );
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, line: number) {
  const words = text.split(" ");
  let row = "";
  let yy = y;
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (ctx.measureText(next).width > max) {
      ctx.fillText(row, x, yy);
      row = word;
      yy += line;
    } else row = next;
  }
  if (row) ctx.fillText(row, x, yy);
}
