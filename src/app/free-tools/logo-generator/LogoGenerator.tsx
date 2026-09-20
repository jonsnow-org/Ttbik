"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
      ctx.font = `${font.weight} 52px "${font.family}"`;
      ctx.fillText(label.slice(0, 18), cx, tagline.trim() ? cy - 16 : cy);
      if (tagline.trim()) {
        ctx.font = `400 22px "${font.family}"`;
        ctx.fillStyle = pairing.accent;
        ctx.fillText(tagline.trim().slice(0, 28), cx, cy + 36);
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
      ctx.font = `${font.weight} 120px "${font.family}"`;
      ctx.fillText(firstGlyph(label), cx, cy + 6);
      if (tagline.trim()) {
        ctx.font = `400 26px "${font.family}"`;
        ctx.fillStyle = pairing.accent;
        ctx.fillText(tagline.trim().slice(0, 60), cx, cy + 176);
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
        if (ctx.measureText(label).width <= CANVAS_W - 160 || fontSize <= 28) break;
        fontSize -= 4;
      } while (true);
      ctx.fillStyle = pairing.text;
      ctx.fillText(label, CANVAS_W / 2, tagline.trim() ? CANVAS_H / 2 - 36 : CANVAS_H / 2);
      if (tagline.trim()) {
        ctx.font = `400 30px "${font.family}"`;
        ctx.fillStyle = pairing.accent;
        ctx.fillText(tagline.trim().slice(0, 60), CANVAS_W / 2, CANVAS_H / 2 + 48);
      }
      setDataUrl(canvas.toDataURL("image/png"));
      return;
    }

    if (layoutId === "badge") {
      const pad = 48;
      const rx = 48;
      ctx.fillStyle = pairing.accent;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(pad, pad, CANVAS_W - pad * 2, CANVAS_H - pad * 2, rx);
      } else {
        ctx.rect(pad, pad, CANVAS_W - pad * 2, CANVAS_H - pad * 2);
      }
      ctx.fill();
      ctx.fillStyle = transparentBg ? "#ffffff" : pairing.bg;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(pad + 10, pad + 10, CANVAS_W - pad * 2 - 20, CANVAS_H - pad * 2 - 20, rx - 8);
      } else {
        ctx.rect(pad + 10, pad + 10, CANVAS_W - pad * 2 - 20, CANVAS_H - pad * 2 - 20);
      }
      ctx.fill();
    } else {
      ctx.fillStyle = pairing.accent;
      ctx.fillRect(CANVAS_W / 2 - 60, CANVAS_H / 2 + 70, 120, 6);
    }

    let fontSize = layoutId === "badge" ? 84 : 96;
    do {
      ctx.font = `${font.weight} ${fontSize}px "${font.family}"`;
      const width = ctx.measureText(label).width;
      const maxW = layoutId === "badge" ? CANVAS_W - 200 : CANVAS_W - 120;
      if (width <= maxW || fontSize <= 28) break;
      fontSize -= 4;
    } while (true);
    ctx.fillStyle = pairing.text;
    ctx.fillText(label, CANVAS_W / 2, CANVAS_H / 2 - (tagline.trim() ? 20 : 0));

    if (tagline.trim()) {
      ctx.font = `400 28px "${font.family}"`;
      ctx.fillStyle = pairing.accent;
      ctx.fillText(tagline.trim().slice(0, 60), CANVAS_W / 2, CANVAS_H / 2 + 110);
    }

    setDataUrl(canvas.toDataURL("image/png"));
  }, [name, tagline, font, pairing, fontsReady, layoutId, transparentBg]);

  useEffect(() => {
    draw();
  }, [draw]);

  function downloadPng() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `logo-${slugName(name)}.png`;
    a.click();
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
    const a = document.createElement("a");
    a.href = url;
    a.download = `avatar-${slugName(name)}.png`;
    a.click();
  }

  function downloadSvg() {
    const label = (name.trim() || "اسم مشروعك").slice(0, 80);
    const sub = tagline.trim().slice(0, 60);
    const escaped = escapeXml(label);
    const escapedSub = escapeXml(sub);
    const glyph = escapeXml(firstGlyph(label));
    const bgRect = transparentBg ? "" : `<rect width=\"1000\" height=\"500\" fill=\"${pairing.bg}\"/>`;
    let body = "";
    if (layoutId === "split") {
      const rightText = sub ? escapeXml(sub.slice(0, 24)) : glyph;
      const rightSize = sub ? 26 : 72;
      body = `<polygon points=\"580,0 1000,0 1000,500 380,500\" fill=\"${pairing.accent}\"/><text x=\"320\" y=\"${sub ? 232 : 250}\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"${pairing.text}\" font-family=\"${font.family}, sans-serif\" font-weight=\"${font.weight}\" font-size=\"56\">${escaped.slice(0, 22)}</text><text x=\"720\" y=\"258\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"${pairing.bg}\" font-family=\"${font.family}, sans-serif\" font-weight=\"700\" font-size=\"${rightSize}\">${rightText}</text>`;
    } else if (layoutId === "ribbon") {
      const onBand = escapeXml((sub || label).slice(0, 36));
      body = `<rect x=\"0\" y=\"310\" width=\"1000\" height=\"190\" fill=\"${pairing.accent}\"/><text x=\"500\" y=\"160\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"${pairing.text}\" font-family=\"${font.family}, sans-serif\" font-weight=\"${font.weight}\" font-size=\"64\">${escaped.slice(0, 28)}</text><text x=\"500\" y=\"405\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"${pairing.bg}\" font-family=\"${font.family}, sans-serif\" font-weight=\"700\" font-size=\"28\">${onBand}</text>`;
    } else if (layoutId === "seal") {
      body = `<circle cx=\"500\" cy=\"250\" r=\"168\" fill=\"none\" stroke=\"${pairing.accent}\" stroke-width=\"10\"/><circle cx=\"500\" cy=\"250\" r=\"152\" fill=\"none\" stroke=\"${pairing.accent}\" stroke-width=\"3\"/><text x=\"500\" y=\"${sub ? 234 : 250}\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"${pairing.text}\" font-family=\"${font.family}, sans-serif\" font-weight=\"${font.weight}\" font-size=\"52\">${escaped.slice(0, 18)}</text>${sub ? `<text x=\"500\" y=\"286\" text-anchor=\"middle\" fill=\"${pairing.accent}\" font-family=\"${font.family}, sans-serif\" font-size=\"22\">${escapeXml(sub.slice(0, 28))}</text>` : ""}`;
    } else if (layoutId === "monogram") {
      const cy = sub ? 226 : 250;
      const inner = transparentBg ? "#ffffff" : pairing.bg;
      body = `<circle cx=\"500\" cy=\"${cy}\" r=\"140\" fill=\"${pairing.accent}\"/><circle cx=\"500\" cy=\"${cy}\" r=\"126\" fill=\"${inner}\"/><text x=\"500\" y=\"${cy + 8}\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"${pairing.text}\" font-family=\"${font.family}, sans-serif\" font-weight=\"${font.weight}\" font-size=\"120\">${glyph}</text>${sub ? `<text x=\"500\" y=\"${cy + 176}\" text-anchor=\"middle\" fill=\"${pairing.accent}\" font-family=\"${font.family}, sans-serif\" font-size=\"26\">${escapedSub}</text>` : ""}`;
    } else if (layoutId === "stacked") {
      body = `<rect x=\"0\" y=\"0\" width=\"16\" height=\"500\" fill=\"${pairing.accent}\"/><rect x=\"984\" y=\"0\" width=\"16\" height=\"500\" fill=\"${pairing.accent}\"/><text x=\"500\" y=\"${sub ? 214 : 250}\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"${pairing.text}\" font-family=\"${font.family}, sans-serif\" font-weight=\"${font.weight}\" font-size=\"72\">${escaped}</text>${sub ? `<text x=\"500\" y=\"298\" text-anchor=\"middle\" fill=\"${pairing.accent}\" font-family=\"${font.family}, sans-serif\" font-size=\"30\">${escapedSub}</text>` : ""}`;
    } else if (layoutId === "badge") {
      const inner = transparentBg ? "#ffffff" : pairing.bg;
      body = `<rect x=\"48\" y=\"48\" width=\"904\" height=\"404\" rx=\"48\" fill=\"${pairing.accent}\"/><rect x=\"58\" y=\"58\" width=\"884\" height=\"384\" rx=\"40\" fill=\"${inner}\"/><text x=\"500\" y=\"${sub ? 230 : 250}\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"${pairing.text}\" font-family=\"${font.family}, sans-serif\" font-weight=\"${font.weight}\" font-size=\"72\">${escaped}</text>${sub ? `<text x=\"500\" y=\"360\" text-anchor=\"middle\" fill=\"${pairing.accent}\" font-family=\"${font.family}, sans-serif\" font-size=\"28\">${escapedSub}</text>` : ""}`;
    } else {
      body = `<rect x=\"440\" y=\"320\" width=\"120\" height=\"6\" fill=\"${pairing.accent}\"/><text x=\"500\" y=\"${sub ? 230 : 250}\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"${pairing.text}\" font-family=\"${font.family}, sans-serif\" font-weight=\"${font.weight}\" font-size=\"72\">${escaped}</text>${sub ? `<text x=\"500\" y=\"360\" text-anchor=\"middle\" fill=\"${pairing.accent}\" font-family=\"${font.family}, sans-serif\" font-size=\"28\">${escapedSub}</text>` : ""}`;
    }
    const svg = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1000\" height=\"500\" viewBox=\"0 0 1000 500\" direction=\"rtl\">\n  <style>@import url('${GOOGLE_FONTS_HREF}');</style>\n  ${bgRect}\n  ${body}\n</svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logo-${slugName(name)}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />

      <label className="block text-sm font-semibold text-slate-700">اسم المشروع أو المتجر</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        dir="auto"
        placeholder="مثال: بيت القهوة"
        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />

      <label className="mt-4 block text-sm font-semibold text-slate-700">شعار فرعي (اختياري)</label>
      <input
        value={tagline}
        onChange={(e) => setTagline(e.target.value)}
        dir="auto"
        placeholder="مثال: قهوة مختصة منذ 2020"
        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />

      <p className="mt-4 mb-1 text-sm font-semibold text-slate-700">الخط</p>
      <div className="flex flex-wrap gap-2">
        {FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFontId(f.id)}
            style={{ fontFamily: `\"${f.family}\"` }}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${
              fontId === f.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="mt-4 mb-1 text-sm font-semibold text-slate-700">التخطيط</p>
      <div className="flex flex-wrap gap-2">
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLayoutId(l.id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${
              layoutId === l.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <p className="mt-4 mb-1 text-sm font-semibold text-slate-700">تنسيق الألوان</p>
      <div className="flex flex-wrap gap-2">
        {PAIRINGS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPairingId(p.id)}
            title={p.label}
            className={`h-9 w-9 rounded-full border-2 ${
              pairingId === p.id ? "border-brand-600" : "border-transparent"
            }`}
            style={{ background: `linear-gradient(135deg, ${p.bg} 50%, ${p.accent} 50%)` }}
          />
        ))}
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
        <input
          type="checkbox"
          checked={transparentBg}
          onChange={(e) => setTransparentBg(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        خلفية شفافة للتنزيل (مناسب للطباعة واللصق فوق صورة)
      </label>

      <div className="mt-6 flex flex-col items-center gap-3">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="w-full max-w-lg rounded-xl border border-slate-200 shadow-sm"
          style={
            transparentBg
              ? {
                  backgroundImage:
                    "linear-gradient(45deg,#e2e8f0 25%,transparent 25%),linear-gradient(-45deg,#e2e8f0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e8f0 75%),linear-gradient(-45deg,transparent 75%,#e2e8f0 75%)",
                  backgroundSize: "20px 20px",
                  backgroundPosition: "0 0,0 10px,10px -10px,-10px 0",
                }
              : undefined
          }
        />
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={downloadPng}
            disabled={!dataUrl}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            تنزيل PNG
          </button>
          <button
            type="button"
            onClick={downloadAvatarPng}
            disabled={!fontsReady}
            className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            أفاتار 500×500
          </button>
          <button
            type="button"
            onClick={downloadSvg}
            className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            تنزيل SVG
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        يعمل بالكامل داخل متصفحك — بلا رفع بيانات لأي خادم. PNG للاستخدام السريع، SVG للتكبير بلا فقدان وضوح، الأفاتار مربع 500×500 للحسابات. الخلفية الشفافة تُصدَّر في PNG وSVG.
      </p>
    </div>
  );
}
