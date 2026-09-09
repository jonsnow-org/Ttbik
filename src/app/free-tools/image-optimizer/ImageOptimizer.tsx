"use client";

import { useRef, useState } from "react";

type Format = "image/webp" | "image/jpeg" | "image/png";

const FORMATS_BY_LANG: Record<"ar" | "en", { value: Format; label: string; ext: string }[]> = {
  ar: [
    { value: "image/webp", label: "WebP (الأفضل — أصغر حجم)", ext: "webp" },
    { value: "image/jpeg", label: "JPEG", ext: "jpg" },
    { value: "image/png", label: "PNG (بلا فقدان جودة)", ext: "png" },
  ],
  en: [
    { value: "image/webp", label: "WebP (best — smallest size)", ext: "webp" },
    { value: "image/jpeg", label: "JPEG", ext: "jpg" },
    { value: "image/png", label: "PNG (lossless)", ext: "png" },
  ],
};

function formatBytes(bytes: number, lang: "ar" | "en"): string {
  if (lang === "en") {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} ميجابايت`;
}

const T = {
  ar: {
    format: "الصيغة الناتجة",
    quality: (pct: number) => `الجودة (${pct}%)`,
    maxWidth: "أقصى عرض بالبكسل (اختياري — لتصغير الأبعاد أيضا)",
    maxWidthPlaceholder: "مثال: 1200",
    processing: "جاري المعالجة...",
    convert: "تحويل وضغط الآن",
    done: (size: string) => `تم! الحجم الجديد ${size}`,
    saved: (pct: number) => ` (توفير ${pct}%)`,
    resultAlt: "النتيجة",
    downloadBtn: "تنزيل الصورة الناتجة",
    copySummary: "نسخ الملخص",
    copied: "تم النسخ ✓",
    footer: "كل المعالجة تتم داخل متصفحك مباشرة — صورك لا تُرفع لأي خادم ولا نراها إطلاقا.",
  },
  en: {
    format: "Output format",
    quality: (pct: number) => `Quality (${pct}%)`,
    maxWidth: "Max width in pixels (optional — also resizes)",
    maxWidthPlaceholder: "e.g. 1200",
    processing: "Processing...",
    convert: "Convert & compress now",
    done: (size: string) => `Done! New size: ${size}`,
    saved: (pct: number) => ` (saved ${pct}%)`,
    resultAlt: "Result",
    downloadBtn: "Download result",
    copySummary: "Copy summary",
    copied: "Copied ✓",
    footer: "All processing happens right in your browser — your image is never uploaded to any server.",
  },
} as const;

export default function ImageOptimizer({ lang = "ar" }: { lang?: "ar" | "en" }) {
  const t = T[lang];
  const FORMATS = FORMATS_BY_LANG[lang];
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<Format>("image/webp");
  const [quality, setQuality] = useState(0.8);
  const [maxWidth, setMaxWidth] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ url: string; size: number; ext: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setResult(null);
  }

  function convert() {
    if (!file) return;
    setIsProcessing(true);

    const img = new Image();
    img.src = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      let { width, height } = img;
      const limit = parseInt(maxWidth, 10);
      if (limit > 0 && width > limit) {
        height = Math.round((height * limit) / width);
        width = limit;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          setIsProcessing(false);
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const ext = FORMATS.find((f) => f.value === format)!.ext;
          setResult({ url, size: blob.size, ext });
        },
        format,
        format === "image/png" ? undefined : quality
      );
    };
  }

  const savedPct = result && file ? Math.max(0, Math.round((1 - result.size / file.size) * 100)) : 0;

  function copySummary() {
    if (!result || !file) return;
    const orig = formatBytes(file.size, lang);
    const neu = formatBytes(result.size, lang);
    const lines =
      lang === "ar"
        ? [
            `ضغط الصورة — سوق تولز`,
            `الاسم: ${file.name}`,
            `الحجم الأصلي: ${orig}`,
            `الحجم الجديد: ${neu}`,
            savedPct > 0 ? `التوفير: ${savedPct}%` : null,
            `الصيغة: ${result.ext.toUpperCase()}`,
          ]
        : [
            `Image compress — SouqTools`,
            `Name: ${file.name}`,
            `Original size: ${orig}`,
            `New size: ${neu}`,
            savedPct > 0 ? `Saved: ${savedPct}%` : null,
            `Format: ${result.ext.toUpperCase()}`,
          ];
    const textOut = lines.filter(Boolean).join("\n");
    navigator.clipboard.writeText(textOut).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6" dir={lang === "en" ? "ltr" : "rtl"}>
      <div className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center">
        <input
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-xl file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
        />
        {file && (
          <p className="mt-2 text-sm text-slate-600">
            {file.name} — {formatBytes(file.size, lang)}
          </p>
        )}
      </div>

      {file && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">{t.format}</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            >
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {format !== "image/png" && (
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">
                {t.quality(Math.round(quality * 100))}
              </label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={quality}
                onChange={(e) => setQuality(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              {t.maxWidth}
            </label>
            <input
              type="number"
              value={maxWidth}
              onChange={(e) => setMaxWidth(e.target.value)}
              placeholder={t.maxWidthPlaceholder}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              dir="ltr"
            />
          </div>

          <button
            onClick={convert}
            disabled={isProcessing}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300"
          >
            {isProcessing ? t.processing : t.convert}
          </button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      {result && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="mb-3 font-bold text-slate-900">
            {t.done(formatBytes(result.size, lang))}
            {savedPct > 0 && <span className="text-emerald-600">{t.saved(savedPct)}</span>}
          </p>
          <img src={result.url} alt={t.resultAlt} className="mx-auto max-h-64 max-w-full rounded-lg" />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <a
              href={result.url}
              download={`${file?.name.split(".")[0] || "image"}-optimized.${result.ext}`}
              className="inline-block rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
            >
              {t.downloadBtn}
            </a>
            <button
              type="button"
              onClick={copySummary}
              className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {copied ? t.copied : t.copySummary}
            </button>
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-slate-400">
        {t.footer}
      </p>
    </div>
  );
}
