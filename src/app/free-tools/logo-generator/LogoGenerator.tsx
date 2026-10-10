"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadDataUrl, downloadBlob } from "@/lib/download";

// O4 co-build pass 7 (Grok): restore truncated file + diagonal split layout.
const FONTS = [
  { id: "cairo", family: "Cairo", weight: "900", label: "Cairo — عصري هندسي" },
  { id: "tajawal", family: "Tajawal", weight: "800", label: "Tajawal — نظيف حديث" },
  { id: "aref", family: "Aref Ruqaa", weight: "700", label: "Aref Ruqaa — خط تقليدي" },
  { id: "lalezar", family: "Lalezar", weight: "400", label: "Lalezar — عريض جريء" },
  { id: "amiri", family: "Amiri", weight: "700", label: "Amiri — نسخي كلاسيكي" },
] as const;

const PAIRINGS = [
  { id: "emerald", bg: "#ecfdf5", text: "#065f46", accent: "#10b981", label: "أخضر زمردي" },
  { id: "sky", bg: "#f0f9ff", text: "#0c4a6e", accent: "#0ea5e9", label: "أزرق سماوي" },
  { id: "amber", bg: "#fffbeb", text: "#78350f", accent: "#f59e0b", label: "كهرماني" },
  { id: "rose", bg: "#fff1f2", text: "#881337", accent: "#f43f5e", label: "وردي" },
  { id: "violet", bg: "#f5f3ff", text: "#4c1d95", accent: "#8b5cf6", label: "بنفسجي" },
  { id: "dark", bg: "#0f172a", text: "#f8fafc", accent: "#38bdf8", label: "داكن" },
] as const;

const LAYOUTS = [
  { id: "wordmark", label: "نص عريض" },
  { id: "badge", label: "شارة" },
  { id: "monogram", label: "حرف واحد" },
  { id: "stacked", label: "نص مكدّس" },
  { id: "seal", label: "ختم دائري" },
  { id: "ribbon", label: "شريط" },
  { id: "split", label: "انقسام قطري" },
] as const;

const CANVAS_W = 1000;
const CANVAS_H = 500;
const AVATAR = 500;
const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Amiri:wght@700&family=Cairo:wght@900&family=Tajawal:wght@800&family=Aref+Ruqaa:wght@700&family=Lalezar&display=swap";

function slugName(name: string) {
  return (name.trim() || "wordmark").replace(/\s+/g, "-");
}

function firstGlyph(name: string) {
  const trimmed = name.trim() || "أ";
  const chars = Array.from(trimmed);
  return chars[0] || "أ";
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """);
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  transparent: boolean,
) {
  ctx.clearRect(0, 0, w, h);
  if (!transparent) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }
}

export default function LogoGenerator() {
  const [name, setName] = useState("اسم مشروعك");
  const [tagline, setTagline] = useState("");
  const [fontId, setFontId] = useState<(typeof FONTS)[number]["id"]>("cairo");
  const [pairingId, setPairingId] = useState<(typeof PAIRINGS)[number]["id"]>("emerald");
  const [layoutId, setLayoutId] = useState<(typeof LAYOUTS)[number]["id"]>("wordmark");
  const [transparentBg, setTransparentBg] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fontsReady, setFontsReady] = useState(false);

  const font = FONTS.find((f) => f.id === fontId)!;
  const pairing = PAIRINGS.find((p) => p.id === pairingId)!;

  useEffect(() => {
    let cancelled = false;
    Promise.all(FONTS.map((f) => document.fonts.load(`${f.weight} 64px "${f.family}"`)))
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFontsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !fontsReady) return;

    paintBackground(ctx, CANVAS_W, CANVAS_H, pairing.bg, transparentBg);

    const label = name.trim() || "اسم مشروعك";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.direction = "rtl";

    if (layoutId === "split") {
      ctx.fillStyle = pairing.accent;
      ctx.beginPath();
      ctx.moveTo(CANVAS_W * 0.58, 0);
      ctx.lineTo(CANVAS_W, 0);
      ctx.lineTo(CANVAS_W, CANVAS_H);
      ctx.lineTo(CANVAS_W * 0.38, CANVAS_H);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = pairing.text;
      ctx.font = `${font.weight} 56px "${font.family}"`;
      ctx.fillText(label.slice(0, 22), CANVAS_W * 0.32, tagline.trim() ? CANVAS_H / 2 - 18 : CANVAS_H / 2);
      if (tagline.trim()) {
        ctx.fillStyle = pairing.bg;
        ctx.font = `700 26px "${font.family}"`;
        ctx.fillText(tagline.trim().slice(0, 24), CANVAS_W * 0.72, CANVAS_H / 2 + 8);
      } else {
        ctx.fillStyle = pairing.bg;
        ctx.font = `${font.weight} 72px "${font.family}"`;
        ctx.fillText(firstGlyph(label), CANVAS_W * 0.74, CANVAS_H / 2);
      }
      setDataUrl(canvas.toDataURL("image/png"));
      return;
    }

    if (layoutId === "ribbon") {
      const bandY = Math.round(CANVAS_H * 0.62);
      const bandH = CANVAS_H - bandY;
      ctx.fillStyle = pairing.accent;
      ctx.fillRect(0, bandY, CANVAS_W, bandH);
      ctx.fillStyle = pairing.text;
      ctx.font = `${font.weight} 64px "${font.family}"`;
      ctx.fillText(label.slice(0, 28), CANVAS_W / 2, bandY / 2 + 8);
      const onBand = tagline.trim() ? tagline.trim().slice(0, 36) : label.slice(0, 28);
      ctx.fillStyle = pairing.bg;
      ctx.font = `700 28px "${font.family}"`;
      ctx.fillText(onBand, CANVAS_W / 2, bandY + bandH / 2);
      setDataUrl(canvas.toDataURL("image/png"));
      return;
    }

    if (layoutId === "seal") {
      const cx = CANVAS_W / 2;
      const cy = CANVAS_H / 2;
      ctx.strokeStyle = pairing.accent;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, 168, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 152, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = pairing.text;
      ctx.font = `${font.weight} 64px "${font.family}"`;
      ctx.fillText(label.slice(0, 18), cx, tagline.trim() ? cy - 22 : cy);
      if (tagline.trim()) {
        ctx.fillStyle = pairing.accent;
        ctx.font = `700 26px "${font.family}"`;
        ctx.fillText(tagline.trim().slice(0, 28), cx, cy + 42);
      }
      setDataUrl(canvas.toDataURL("image/png"));
      return;
    }

    if (layoutId === "monogram") {
      const cx = CANVAS_W / 2;
      const cy = CANVAS_H / 2 - (tagline.trim() ? 24 : 0);
      ctx.fillStyle = pairing.accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 140, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = transparentBg ? "#ffffff" : pairing.bg;
      ctx.beginPath();
      ctx.arc(cx, cy, 126, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pairing.text;
      ctx.font = `${font.weight} 128px "${font.family}"`;
      ctx.fillText(firstGlyph(label), cx, cy + 6);
      if (tagline.trim()) {
        ctx.fillStyle = pairing.accent;
        ctx.font = `700 28px "${font.family}"`;
        ctx.fillText(tagline.trim().slice(0, 32), cx, cy + 190);
      }
      setDataUrl(canvas.toDataURL("image/png"));
      return;
    }

    if (layoutId === "stacked") {
      ctx.fillStyle = pairing.accent;
      ctx.fillRect(0, 0, 16, CANVAS_H);
      ctx.fillRect(CANVAS_W - 16, 0, 16, CANVAS_H);
      let fontSize = 88;
      do {
        ctx.font = `${font.weight} ${fontSize}px "${font.family}"`;
        if (ctx.measureText(label).width <= CANVAS_W - 120) break;
        fontSize -= 4;
      } while (fontSize > 36);
      ctx.fillStyle = pairing.text;
      ctx.fillText(label, CANVAS_W / 2, tagline.trim() ? CANVAS_H / 2 - 28 : CANVAS_H / 2);
      if (tagline.trim()) {
        ctx.fillStyle = pairing.accent;
        ctx.font = `700 30px "${font.family}"`;
        ctx.fillText(tagline.trim().slice(0, 40), CANVAS_W / 2, CANVAS_H / 2 + 48);
      }
      setDataUrl(canvas.toDataURL("image/png"));
      return;
    }

    if (layoutId === "badge") {
      const inner = transparentBg ? "#ffffff" : pairing.bg;
      ctx.fillStyle = pairing.accent;
      roundRect(ctx, 48, 48, CANVAS_W - 96, CANVAS_H - 96, 48);
      ctx.fill();
      ctx.fillStyle = inner;
      roundRect(ctx, 58, 58, CANVAS_W - 116, CANVAS_H - 116, 40);
      ctx.fill();
      ctx.fillStyle = pairing.text;
      ctx.font = `${font.weight} 72px "${font.family}"`;
      ctx.fillText(label.slice(0, 20), CANVAS_W / 2, tagline.trim() ? CANVAS_H / 2 - 20 : CANVAS_H / 2);
      if (tagline.trim()) {
        ctx.fillStyle = pairing.accent;
        ctx.font = `700 28px "${font.family}"`;
        ctx.fillText(tagline.trim().slice(0, 36), CANVAS_W / 2, CANVAS_H / 2 + 60);
      }
      setDataUrl(canvas.toDataURL("image/png"));
      return;
    }

    // default wordmark
    let fontSize = 96;
    do {
      ctx.font = `${font.weight} ${fontSize}px "${font.family}"`;
      if (ctx.measureText(label).width <= CANVAS_W - 80) break;
      fontSize -= 4;
    } while (fontSize > 32);
    ctx.fillStyle = pairing.text;
    ctx.fillText(label, CANVAS_W / 2, tagline.trim() ? CANVAS_H / 2 - 20 : CANVAS_H / 2);
    if (tagline.trim()) {
      ctx.fillStyle = pairing.accent;
      ctx.font = `700 32px "${font.family}"`;
      ctx.fillText(tagline.trim().slice(0, 40), CANVAS_W / 2, CANVAS_H / 2 + 52);
    } else {
      ctx.fillStyle = pairing.accent;
      ctx.fillRect(CANVAS_W / 2 - 60, CANVAS_H / 2 + 50, 120, 6);
    }
    setDataUrl(canvas.toDataURL("image/png"));
  }, [name, tagline, font, pairing, fontsReady, layoutId, transparentBg]);

  useEffect(() => {
    draw();
  }, [draw]);

  function downloadPng() {
    if (!dataUrl) return;
    downloadDataUrl(dataUrl, `logo-${slugName(name)}.png`);
  }

  function downloadAvatarPng() {
    if (!fontsReady) return;
    const off = document.createElement("canvas");
    off.width = AVATAR;
    off.height = AVATAR;
    const ctx = off.getContext("2d");
    if (!ctx) return;
    const label = name.trim() || "اسم مشروعك";
    paintBackground(ctx, AVATAR, AVATAR, pairing.bg, transparentBg);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.direction = "rtl";
    const cx = AVATAR / 2;
    const cy = AVATAR / 2;
    ctx.fillStyle = pairing.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 190, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = transparentBg ? "#ffffff" : pairing.bg;
    ctx.beginPath();
    ctx.arc(cx, cy, 172, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pairing.text;
    ctx.font = `${font.weight} 168px "${font.family}"`;
    ctx.fillText(firstGlyph(label), cx, cy + 8);
    const url = off.toDataURL("image/png");
    downloadDataUrl(url, `avatar-${slugName(name)}.png`);
  }

  function downloadSvg() {
    const label = (name.trim() || "اسم مشروعك").slice(0, 80);
    const sub = tagline.trim().slice(0, 60);
    const escaped = escapeXml(label);
    const escapedSub = escapeXml(sub);
    const glyph = escapeXml(firstGlyph(label));
    const bgRect = transparentBg ? "" : `<rect width="1000" height="500" fill="${pairing.bg}"/>`;
    let body = "";
    if (layoutId === "split") {
      const rightText = sub ? escapeXml(sub.slice(0, 24)) : glyph;
      const rightSize = sub ? 26 : 72;
      body = `<polygon points="580,0 1000,0 1000,500 380,500" fill="${pairing.accent}"/><text x="320" y="${sub ? 232 : 250}" text-anchor="middle" dominant-baseline="middle" fill="${pairing.text}" font-family="${font.family}, sans-serif" font-weight="${font.weight}" font-size="56">${escaped.slice(0, 22)}</text><text x="720" y="258" text-anchor="middle" dominant-baseline="middle" fill="${pairing.bg}" font-family="${font.family}, sans-serif" font-weight="700" font-size="${rightSize}">${rightText}</text>`;
    } else if (layoutId === "ribbon") {
      const onBand = escapeXml((sub || label).slice(0, 36));
      body = `<rect y="310" width="1000" height="190" fill="${pairing.accent}"/><text x="500" y="170" text-anchor="middle" dominant-baseline="middle" fill="${pairing.text}" font-family="${font.family}, sans-serif" font-weight="${font.weight}" font-size="64">${escaped.slice(0, 28)}</text><text x="500" y="405" text-anchor="middle" dominant-baseline="middle" fill="${pairing.bg}" font-family="${font.family}, sans-serif" font-weight="700" font-size="28">${onBand}</text>`;
    } else if (layoutId === "seal") {
      body = `<circle cx="500" cy="250" r="168" fill="none" stroke="${pairing.accent}" stroke-width="10"/><circle cx="500" cy="250" r="152" fill="none" stroke="${pairing.accent}" stroke-width="3"/><text x="500" y="${sub ? 228 : 250}" text-anchor="middle" dominant-baseline="middle" fill="${pairing.text}" font-family="${font.family}, sans-serif" font-weight="${font.weight}" font-size="64">${escaped.slice(0, 18)}</text>${sub ? `<text x="500" y="292" text-anchor="middle" fill="${pairing.accent}" font-family="${font.family}, sans-serif" font-size="26">${escapedSub.slice(0, 28)}</text>` : ""}`;
    } else if (layoutId === "monogram") {
      const inner = transparentBg ? "#ffffff" : pairing.bg;
      body = `<circle cx="500" cy="${sub ? 210 : 250}" r="140" fill="${pairing.accent}"/><circle cx="500" cy="${sub ? 210 : 250}" r="126" fill="${inner}"/><text x="500" y="${sub ? 216 : 256}" text-anchor="middle" dominant-baseline="middle" fill="${pairing.text}" font-family="${font.family}, sans-serif" font-weight="${font.weight}" font-size="128">${glyph}</text>${sub ? `<text x="500" y="400" text-anchor="middle" fill="${pairing.accent}" font-family="${font.family}, sans-serif" font-size="28">${escapedSub.slice(0, 32)}</text>` : ""}`;
    } else if (layoutId === "stacked") {
      body = `<rect width="16" height="500" fill="${pairing.accent}"/><rect x="984" width="16" height="500" fill="${pairing.accent}"/><text x="500" y="${sub ? 214 : 250}" text-anchor="middle" dominant-baseline="middle" fill="${pairing.text}" font-family="${font.family}, sans-serif" font-weight="${font.weight}" font-size="72">${escaped}</text>${sub ? `<text x="500" y="298" text-anchor="middle" fill="${pairing.accent}" font-family="${font.family}, sans-serif" font-size="30">${escapedSub}</text>` : ""}`;
    } else if (layoutId === "badge") {
      const inner = transparentBg ? "#ffffff" : pairing.bg;
      body = `<rect x="48" y="48" width="904" height="404" rx="48" fill="${pairing.accent}"/><rect x="58" y="58" width="884" height="384" rx="40" fill="${inner}"/><text x="500" y="${sub ? 230 : 250}" text-anchor="middle" dominant-baseline="middle" fill="${pairing.text}" font-family="${font.family}, sans-serif" font-weight="${font.weight}" font-size="72">${escaped}</text>${sub ? `<text x="500" y="360" text-anchor="middle" fill="${pairing.accent}" font-family="${font.family}, sans-serif" font-size="28">${escapedSub}</text>` : ""}`;
    } else {
      body = `<rect x="440" y="320" width="120" height="6" fill="${pairing.accent}"/><text x="500" y="${sub ? 230 : 250}" text-anchor="middle" dominant-baseline="middle" fill="${pairing.text}" font-family="${font.family}, sans-serif" font-weight="${font.weight}" font-size="72">${escaped}</text>${sub ? `<text x="500" y="360" text-anchor="middle" fill="${pairing.accent}" font-family="${font.family}, sans-serif" font-size="28">${escapedSub}</text>` : ""}`;
    }
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500" viewBox="0 0 1000 500" direction="rtl">\n  <style>@import url('${GOOGLE_FONTS_HREF}');</style>\n  ${bgRect}\n  ${body}\n</svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, `logo-${slugName(name)}.svg`);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold text-slate-700">اسم المشروع / الشعار</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            placeholder="اسم مشروعك"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700">شعار فرعي (اختياري)</label>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            placeholder="جملة قصيرة"
          />
        </div>
      </div>

      <div className="mt-4">
        <p className="text-sm font-semibold text-slate-700">الخط</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFontId(f.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${fontId === f.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-sm font-semibold text-slate-700">الألوان</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PAIRINGS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPairingId(p.id)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${pairingId === p.id ? "border-slate-900" : "border-slate-200"}`}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: p.accent }} />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-sm font-semibold text-slate-700">التصميم</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLayoutId(l.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${layoutId === l.id ? "bg-amber-600 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={transparentBg} onChange={(e) => setTransparentBg(e.target.checked)} />
        خلفية شفافة
      </label>

      <div className="mt-6 flex flex-col items-center">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="max-w-full rounded-xl border border-slate-200 shadow-sm"
          style={{ width: "100%", maxWidth: 500, height: "auto" }}
        />
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={downloadPng} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white">تنزيل PNG</button>
          <button type="button" onClick={downloadAvatarPng} className="rounded-full border px-4 py-2 text-sm font-bold">أفاتار دائري</button>
          <button type="button" onClick={downloadSvg} className="rounded-full border px-4 py-2 text-sm font-bold">تنزيل SVG</button>
        </div>
      </div>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
