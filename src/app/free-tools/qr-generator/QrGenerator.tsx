"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QR from "@/lib/qrMin";

const SIZES = [128, 256, 384, 512] as const;

const T = {
  ar: {
    label: "النص أو الرابط",
    placeholder: "https://... أو أي نص",
    size: "الحجم:",
    fgColor: "لون الرمز",
    bgColor: "لون الخلفية",
    errorTooLong: "تعذر إنشاء رمز QR — النص طويل جداً",
    download: "تنزيل PNG",
    copy: "نسخ الصورة",
    copied: "✅ تم النسخ",
    footer: "يعمل بالكامل داخل المتصفح — بلا رفع بيانات لأي خادم.",
  },
  en: {
    label: "Text or link",
    placeholder: "https://... or any text",
    size: "Size:",
    fgColor: "Code color",
    bgColor: "Background color",
    errorTooLong: "Couldn't generate the QR code — text is too long",
    download: "Download PNG",
    copy: "Copy image",
    copied: "✅ Copied",
    footer: "Runs entirely in your browser — no data is ever uploaded.",
  },
} as const;

export default function QrGenerator({ lang = "ar" }: { lang?: "ar" | "en" }) {
  const t = T[lang];
  const [text, setText] = useState("https://ttbik.vercel.app");
  const [size, setSize] = useState<(typeof SIZES)[number]>(256);
  const [fg, setFg] = useState("#0f172a");
  const [bg, setBg] = useState("#ffffff");
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const draw = useCallback(() => {
    setError(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const value = text.trim();
    if (!value) {
      setDataUrl(null);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);
      }
      return;
    }
    try {
      const matrix = QR(value) as number[][];
      const n = matrix.length;
      const quiet = 2; // modules of quiet zone
      const modules = n + quiet * 2;
      const cell = size / modules;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = fg;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (matrix[y][x]) {
            ctx.fillRect(
              (x + quiet) * cell,
              (y + quiet) * cell,
              Math.ceil(cell),
              Math.ceil(cell)
            );
          }
        }
      }
      setDataUrl(canvas.toDataURL("image/png"));
    } catch (e) {
      // qrMin.ts's own thrown message is Arabic-only — for the English UI,
      // always show the English translation rather than a mixed-language
      // string, regardless of what the encoder threw.
      setError(lang === "en" ? t.errorTooLong : e instanceof Error ? e.message : t.errorTooLong);
      setDataUrl(null);
    }
  }, [text, size, fg, bg, lang, t.errorTooLong]);

  useEffect(() => {
    draw();
  }, [draw]);

  const download = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "qr-souqtools.png";
    a.click();
  };

  const copyPng = async () => {
    if (!dataUrl || !navigator.clipboard) return;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: ignore
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6" dir={lang === "en" ? "ltr" : "rtl"}>
      <label className="block text-sm font-semibold text-slate-700">
        {t.label}
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        dir="auto"
        placeholder={t.placeholder}
        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-500">{t.size}</span>
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSize(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              size === s
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {s}px
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span>{t.fgColor}</span>
          <input
            type="color"
            value={fg}
            onChange={(e) => setFg(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border border-slate-300"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span>{t.bgColor}</span>
          <input
            type="color"
            value={bg}
            onChange={(e) => setBg(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border border-slate-300"
          />
        </label>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      )}

      <div className="mt-6 flex flex-col items-center gap-3">
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          className="rounded-xl border border-slate-200 shadow-sm"
          style={{ width: Math.min(size, 320), height: Math.min(size, 320) }}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={download}
            disabled={!dataUrl}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {t.download}
          </button>
          <button
            type="button"
            onClick={copyPng}
            disabled={!dataUrl}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {copied ? t.copied : t.copy}
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        {t.footer}
      </p>
    </div>
  );
}
