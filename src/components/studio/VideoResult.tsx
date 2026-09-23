"use client";

import { useEffect, useState } from "react";
import {
  FORMAT_LABELS,
  canShareFiles,
  convertVideo,
  downloadVideo,
  formatSize,
  shareVideo,
  type VideoFormat,
} from "./videoExport";

type Recorded = { blob: Blob; format: "mp4" | "webm" };

// Preview + save/share/convert panel shown once a studio has produced a video.
export default function VideoResult({ recorded, fileBase }: { recorded: Recorded; fileBase: string }) {
  const [blobs, setBlobs] = useState<Partial<Record<VideoFormat, Blob>>>({ [recorded.format]: recorded.blob });
  const [previewUrl, setPreviewUrl] = useState("");
  const [converting, setConverting] = useState<VideoFormat | null>(null);
  const [pct, setPct] = useState(0);
  const [message, setMessage] = useState("");
  const [shareable, setShareable] = useState(false);

  useEffect(() => {
    setBlobs({ [recorded.format]: recorded.blob });
    const url = URL.createObjectURL(recorded.blob);
    setPreviewUrl(url);
    setMessage("");
    return () => URL.revokeObjectURL(url);
  }, [recorded]);

  useEffect(() => setShareable(canShareFiles()), []);

  async function convert(target: VideoFormat) {
    if (converting) return;
    setConverting(target);
    setPct(0);
    setMessage("");
    try {
      const out = await convertVideo(recorded.blob, recorded.format, target, setPct);
      setBlobs((prev) => ({ ...prev, [target]: out }));
    } catch (e) {
      console.error("ffmpeg convert failed", e);
      setMessage("تعذّر تحويل الصيغة على هذا الجهاز. يمكنك حفظ الفيديو بالصيغة المتاحة.");
    } finally {
      setConverting(null);
    }
  }

  async function share(f: VideoFormat, blob: Blob) {
    const r = await shareVideo(blob, `${fileBase}.${f}`);
    if (r === "failed") setMessage("تعذّرت المشاركة — جرّب زر «تنزيل مباشر».");
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="mb-3 font-bold text-emerald-800">تم إنشاء الفيديو بنجاح — شاهده ثم احفظه بالصيغة التي تريدها:</p>
      {previewUrl && <video src={previewUrl} controls playsInline className="mb-4 max-h-[460px] w-full rounded-lg bg-black" />}
      <div className="flex flex-col gap-3">
        {(Object.keys(FORMAT_LABELS) as VideoFormat[]).map((f) => {
          const blob = blobs[f];
          const info = FORMAT_LABELS[f];
          if (!blob) {
            return (
              <button
                key={f}
                type="button"
                onClick={() => convert(f)}
                disabled={!!converting}
                className="flex items-center justify-between rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
              >
                <span>{converting === f ? `جاري التحويل إلى ${info.label}... ${pct}%` : `تحويل إلى ${info.label}`}</span>
                <span className="text-xs font-normal text-emerald-700">{info.hint}</span>
              </button>
            );
          }
          return (
            <div key={f} className="rounded-xl bg-white p-3 ring-1 ring-emerald-200">
              <p className="mb-2 text-sm font-bold text-emerald-900">
                {info.label} <span className="font-normal text-slate-500">· {formatSize(blob.size)} · {info.hint}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {shareable && (
                  <button
                    type="button"
                    onClick={() => share(f, blob)}
                    className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700"
                  >
                    📲 حفظ في الهاتف / مشاركة
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => downloadVideo(blob, `${fileBase}.${f}`)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${shareable ? "border border-emerald-600 text-emerald-700 hover:bg-emerald-50" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                >
                  ⬇️ تنزيل مباشر
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
      <p className="mt-3 text-xs text-slate-500">
        على الهاتف: إذا فتحت الموقع من داخل تيليجرام أو واتساب ولم يبدأ التنزيل، استخدم زر «حفظ في الهاتف / مشاركة» ثم اختر «الملفات» أو أي تطبيق، أو افتح الصفحة في متصفح Chrome من قائمة ⋮.
        أول تحويل بين الصيغ يحمّل أداة التحويل مرة واحدة (حوالي 30MB).
      </p>
    </div>
  );
}
