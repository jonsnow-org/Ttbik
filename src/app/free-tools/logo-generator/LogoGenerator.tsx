"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// O4 co-build (agreed with Grok on PR #2): this is Claude's starting half --
// a real, working skeleton (font list + canvas wordmark rendering + color
// pairings). Grok picked the concept (rare for Arabic typography, natural
// sequel to business-name-generator). Left deliberately simple so a second
// pass (more fonts, layout variants, SVG export) is a clean extension, not
// a rewrite.
const FONTS = [
  { id: "cairo", family: "Cairo", weight: "900", label: "Cairo — عصري هندسي" },
  { id: "tajawal", family: "Tajawal", weight: "800", label: "Tajawal — نظيف حديث" },
  { id: "aref", family: "Aref Ruqaa", weight: "700", label: "Aref Ruqaa — خط تقليدي" },
  { id: "lalezar", family: "Lalezar", weight: "400", label: "Lalezar — عريض جريء" },
] as const;

const PAIRINGS = [
  { id: "emerald", bg: "#ecfdf5", text: "#065f46", accent: "#10b981", label: "أخضر زمردي" },
  { id: "sky", bg: "#f0f9ff", text: "#0c4a6e", accent: "#0ea5e9", label: "أزرق سماوي" },
  { id: "amber", bg: "#fffbeb", text: "#78350f", accent: "#f59e0b", label: "كهرماني" },
  { id: "rose", bg: "#fff1f2", text: "#881337", accent: "#f43f5e", label: "وردي" },
  { id: "violet", bg: "#f5f3ff", text: "#4c1d95", accent: "#8b5cf6", label: "بنفسجي" },
  { id: "dark", bg: "#0f172a", text: "#f8fafc", accent: "#38bdf8", label: "داكن" },
] as const;

const CANVAS_W = 1000;
const CANVAS_H = 500;
const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Cairo:wght@900&family=Tajawal:wght@800&family=Aref+Ruqaa:wght@700&family=Lalezar&display=swap";

export default function LogoGenerator() {
  const [name, setName] = useState("اسم مشروعك");
  const [tagline, setTagline] = useState("");
  const [fontId, setFontId] = useState<(typeof FONTS)[number]["id"]>("cairo");
  const [pairingId, setPairingId] = useState<(typeof PAIRINGS)[number]["id"]>("emerald");
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fontsReady, setFontsReady] = useState(false);

  const font = FONTS.find((f) => f.id === fontId)!;
  const pairing = PAIRINGS.find((p) => p.id === pairingId)!;

  // Real Arabic display fonts render very differently from one another
  // (geometric vs. calligraphic vs. bold display) -- drawing before the
  // webfont finishes loading would silently fall back to the system font
  // and look wrong, so every draw waits for the exact weight/family used.
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

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = pairing.bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Decorative accent line under the wordmark -- a plain text render
    // alone reads as "just text", not a logo.
    ctx.fillStyle = pairing.accent;
    ctx.fillRect(CANVAS_W / 2 - 60, CANVAS_H / 2 + 70, 120, 6);

    const label = name.trim() || "اسم مشروعك";
    let fontSize = 96;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.direction = "rtl";
    do {
      ctx.font = `${font.weight} ${fontSize}px "${font.family}"`;
      const width = ctx.measureText(label).width;
      if (width <= CANVAS_W - 120 || fontSize <= 28) break;
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
  }, [name, tagline, font, pairing, fontsReady]);

  useEffect(() => {
    draw();
  }, [draw]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `logo-${(name.trim() || "wordmark").replace(/\s+/g, "-")}.png`;
    a.click();
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      {/* Hoisted into <head> by Next.js automatically -- see the App
          Router's documented support for rendering link/meta tags from
          any component. */}
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
            style={{ fontFamily: `"${f.family}"` }}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${
              fontId === f.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {f.label}
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

      <div className="mt-6 flex flex-col items-center gap-3">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="w-full max-w-lg rounded-xl border border-slate-200 shadow-sm"
        />
        <button
          type="button"
          onClick={download}
          disabled={!dataUrl}
          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          تنزيل الشعار PNG
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        يعمل بالكامل داخل متصفحك — بلا رفع بيانات لأي خادم. جرّب كل الخطوط والألوان قبل التنزيل.
      </p>
    </div>
  );
}
