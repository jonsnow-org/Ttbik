"use client";

import { useEffect, useRef, useState } from "react";

const CANVAS_W = 540;
const CANVAS_H = 960;

type Format = "mp4" | "webm" | "mov";
type Output = { url: string; size: number };

const FORMAT_LABELS: Record<Format, { label: string; hint: string }> = {
  mp4: { label: "MP4", hint: "الأنسب لواتساب وإنستغرام وتيك توك" },
  webm: { label: "WebM", hint: "أخف حجماً — للمتصفحات ويوتيوب" },
  mov: { label: "MOV", hint: "لأجهزة آيفون وماك" },
};

// Prefer MP4 when the browser can record it natively (recent Chrome/Safari):
// it plays everywhere, so most people never need a conversion step at all.
function pickRecording(): { mimeType: string; format: "mp4" | "webm" } {
  const candidates: { mimeType: string; format: "mp4" | "webm" }[] = [
    { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", format: "mp4" },
    { mimeType: "video/mp4", format: "mp4" },
    { mimeType: "video/webm;codecs=vp9,opus", format: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", format: "webm" },
    { mimeType: "video/webm", format: "webm" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: "", format: "webm" };
}

function formatSize(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// ffmpeg.wasm is ~30MB, so it's only fetched the first time someone asks
// for a format the browser didn't record natively — never on page load.
let ffmpegPromise: Promise<any> | null = null;
function loadFfmpeg(onLog: (msg: string) => void) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      // The @ffmpeg/ffmpeg ESM files are served as-is from /public/ffmpeg
      // (copied from node_modules by scripts/copy-ffmpeg.mjs): webpack would
      // otherwise rewrite the worker's own dynamic import() of the core and
      // every conversion fails with "Cannot find module 'blob:...'".
      const ffmpegUrl = "/ffmpeg/index.js";
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import(/* webpackIgnore: true */ ffmpegUrl),
        import("@ffmpeg/util"),
      ]);
      const ffmpeg = new FFmpeg();
      ffmpeg.on("log", ({ message }: { message: string }) => onLog(message));
      const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
      return ffmpeg;
    })().catch((e) => {
      ffmpegPromise = null;
      throw e;
    });
  }
  return ffmpegPromise;
}

export default function AudioVisualizerStudio({
  canGenerate,
  onGenerated,
}: {
  canGenerate: boolean;
  onGenerated: () => void;
}) {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [title, setTitle] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [recordedFormat, setRecordedFormat] = useState<"mp4" | "webm" | null>(null);
  const [outputs, setOutputs] = useState<Partial<Record<Format, Output>>>({});
  const [converting, setConverting] = useState<Format | null>(null);
  const [convertProgress, setConvertProgress] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationFrameId = useRef<number | null>(null);
  // One AudioContext + one MediaElementSource for the page's lifetime: a
  // <audio> element can only ever be wired to createMediaElementSource once,
  // so closing/recreating these per run broke every generation after the
  // first one (you had to reload the page to make a second video).
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const sourceElRef = useRef<HTMLAudioElement | null>(null);
  const recordedBlobRef = useRef<Blob | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const titleRef = useRef("");
  const outputsRef = useRef(outputs);
  outputsRef.current = outputs;
  bgImageRef.current = bgImage;
  titleRef.current = title;

  useEffect(() => {
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      audioContextRef.current?.close().catch(() => {});
      Object.values(outputsRef.current).forEach((o) => o && URL.revokeObjectURL(o.url));
    };
  }, []);

  function resetOutputs() {
    Object.values(outputsRef.current).forEach((o) => o && URL.revokeObjectURL(o.url));
    setOutputs({});
    setRecordedFormat(null);
    recordedBlobRef.current = null;
  }

  function handleAudioUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioFile(file);
    setAudioUrl(URL.createObjectURL(file));
    setTitle(file.name.replace(/\.[^.]+$/, ""));
    resetOutputs();
    setError("");
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => setBgImage(img);
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  function drawFrame(analyser: AnalyserNode | null, dataArray: Uint8Array<ArrayBuffer> | null) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    if (analyser && dataArray) analyser.getByteFrequencyData(dataArray);

    const bg = bgImageRef.current;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (bg) {
      // Cover-fit so portrait/landscape photos fill the 9:16 frame without stretching.
      const scale = Math.max(CANVAS_W / bg.width, CANVAS_H / bg.height);
      const w = bg.width * scale;
      const h = bg.height * scale;
      ctx.drawImage(bg, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    } else {
      const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      gradient.addColorStop(0, "#1a1a2e");
      gradient.addColorStop(1, "#16213e");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    const centerX = CANVAS_W / 2;
    const centerY = CANVAS_H / 2 - 100;
    const radius = 180;

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "#00fff5";
    ctx.lineWidth = 6;
    ctx.shadowColor = "#00fff5";
    ctx.shadowBlur = 15;
    ctx.stroke();
    ctx.restore();

    if (dataArray) {
      const bars = 64;
      const step = (Math.PI * 2) / bars;
      for (let i = 0; i < bars; i++) {
        const barHeight = (dataArray[i] / 255) * 120;
        const angle = i * step;
        const x1 = centerX + Math.cos(angle) * radius;
        const y1 = centerY + Math.sin(angle) * radius;
        const x2 = centerX + Math.cos(angle) * (radius + barHeight);
        const y2 = centerY + Math.sin(angle) * (radius + barHeight);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `hsl(${(i * 360) / bars}, 100%, 50%)`;
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    const t = titleRef.current;
    if (t) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 36px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(t.slice(0, 30), CANVAS_W / 2, CANVAS_H - 200);
    }

    animationFrameId.current = requestAnimationFrame(() => drawFrame(analyser, dataArray));
  }

  async function generate() {
    const canvas = canvasRef.current;
    const audioEl = audioRef.current;
    if (!audioFile || !canvas || !audioEl || !canGenerate) return;

    if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
      setError("متصفحك لا يدعم تسجيل الفيديو. جرّب متصفح Chrome أو Firefox الحديث.");
      return;
    }

    setError("");
    resetOutputs();
    setProgress(0);
    const chunks: Blob[] = [];

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const audioContext = audioContextRef.current;
    await audioContext.resume();
    if (!sourceRef.current || sourceElRef.current !== audioEl) {
      sourceRef.current = audioContext.createMediaElementSource(audioEl);
      sourceElRef.current = audioEl;
    }
    const source = sourceRef.current;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const recordDest = audioContext.createMediaStreamDestination();
    source.disconnect();
    source.connect(analyser);
    source.connect(audioContext.destination);
    source.connect(recordDest);

    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    drawFrame(analyser, dataArray);

    const canvasStream = canvas.captureStream(30);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...recordDest.stream.getAudioTracks(),
    ]);

    const { mimeType, format } = pickRecording();
    const mediaRecorder = new MediaRecorder(combinedStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 4_000_000,
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
      const type = mediaRecorder.mimeType || (format === "mp4" ? "video/mp4" : "video/webm");
      const blob = new Blob(chunks, { type });
      recordedBlobRef.current = blob;
      setRecordedFormat(format);
      setOutputs({ [format]: { url: URL.createObjectURL(blob), size: blob.size } });
      setIsRecording(false);
      combinedStream.getTracks().forEach((tr) => tr.stop());
      source.disconnect(recordDest);
      // Count the free try only once a video was actually produced.
      onGenerated();
    };

    audioEl.ontimeupdate = () => {
      if (audioEl.duration) setProgress(Math.min(100, Math.round((audioEl.currentTime / audioEl.duration) * 100)));
    };
    audioEl.onended = () => {
      if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
    };

    setIsRecording(true);
    audioEl.currentTime = 0;
    mediaRecorder.start(1000);
    try {
      await audioEl.play();
    } catch {
      mediaRecorder.stop();
      setIsRecording(false);
      setError("تعذّر تشغيل الملف الصوتي. تأكد أنه ملف صوتي صالح ثم أعد المحاولة.");
    }
  }

  async function convertTo(target: Format) {
    const source = recordedBlobRef.current;
    if (!source || !recordedFormat || converting) return;
    setConverting(target);
    setConvertProgress(0);
    setError("");
    try {
      const ffmpeg = await loadFfmpeg(() => {});
      const onProgress = ({ progress: p }: { progress: number }) =>
        setConvertProgress(Math.max(0, Math.min(100, Math.round(p * 100))));
      ffmpeg.on("progress", onProgress);
      const { fetchFile } = await import("@ffmpeg/util");
      const input = `in.${recordedFormat}`;
      await ffmpeg.writeFile(input, await fetchFile(source));
      const out = `out.${target}`;
      let args: string[];
      if (target === "webm") {
        args = ["-i", input, "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "2M", "-c:a", "libvorbis", out];
      } else if (recordedFormat === "mp4") {
        // Already H.264 — MOV is just a different container, no re-encode needed.
        args = ["-i", input, "-c", "copy", "-movflags", "+faststart", out];
      } else {
        args = ["-i", input, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out];
      }
      const code = await ffmpeg.exec(args);
      ffmpeg.off("progress", onProgress);
      if (code !== 0) throw new Error(`ffmpeg exit ${code}`);
      const data = new Uint8Array((await ffmpeg.readFile(out)) as Uint8Array);
      await ffmpeg.deleteFile(input).catch(() => {});
      await ffmpeg.deleteFile(out).catch(() => {});
      const mime = target === "mp4" ? "video/mp4" : target === "webm" ? "video/webm" : "video/quicktime";
      const blob = new Blob([data], { type: mime });
      setOutputs((prev) => ({ ...prev, [target]: { url: URL.createObjectURL(blob), size: blob.size } }));
    } catch (e) {
      console.error("ffmpeg convert failed", e);
      setError("تعذّر تحويل الصيغة على هذا الجهاز. يمكنك تنزيل الفيديو بالصيغة الأصلية المتاحة.");
    } finally {
      setConverting(null);
    }
  }

  const previewUrl = recordedFormat ? outputs[recordedFormat]?.url : undefined;
  const fileBase = (title.trim() || "reel").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">1. الملف الصوتي (MP3/WAV)</label>
            <input type="file" accept="audio/*" onChange={handleAudioUpload} className="text-sm" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">2. صورة الخلفية (اختياري)</label>
            <input type="file" accept="image/*" onChange={handleImageUpload} className="text-sm" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">3. نص على الفيديو (اختياري)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="اسم المقطع أو المنشئ"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>

          {audioUrl && <audio ref={audioRef} src={audioUrl} className="w-full" controls />}

          <button
            onClick={generate}
            disabled={!audioFile || isRecording || !!converting || !canGenerate}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300"
          >
            {isRecording
              ? `جاري توليد الفيديو... ${progress}%`
              : canGenerate
                ? previewUrl
                  ? "توليد فيديو جديد"
                  : "توليد فيديو الريلز الآن"
                : "انتهت محاولاتك المجانية — اطلب الوصول الكامل بالأسفل"}
          </button>
          {isRecording && (
            <p className="text-xs text-slate-500">
              يُسجَّل الفيديو أثناء تشغيل الصوت، فمدة التوليد تساوي مدة المقطع. أبقِ الصفحة مفتوحة حتى ينتهي.
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {previewUrl && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="mb-3 font-bold text-emerald-800">تم إنشاء الفيديو بنجاح — شاهده ثم نزّله بالصيغة التي تريدها:</p>
              <video src={previewUrl} controls playsInline className="mb-4 max-h-[420px] w-full rounded-lg bg-black" />
              <div className="flex flex-col gap-2">
                {(Object.keys(FORMAT_LABELS) as Format[]).map((f) => {
                  const out = outputs[f];
                  const info = FORMAT_LABELS[f];
                  if (out) {
                    return (
                      <a
                        key={f}
                        href={out.url}
                        download={`${fileBase}.${f}`}
                        className="flex items-center justify-between rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
                      >
                        <span>تنزيل {info.label}</span>
                        <span className="text-xs font-normal opacity-90">
                          {formatSize(out.size)} · {info.hint}
                        </span>
                      </a>
                    );
                  }
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => convertTo(f)}
                      disabled={!!converting}
                      className="flex items-center justify-between rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                    >
                      <span>{converting === f ? `جاري التحويل إلى ${info.label}... ${convertProgress}%` : `تحويل إلى ${info.label}`}</span>
                      <span className="text-xs font-normal text-emerald-700">{info.hint}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                التحويل يتم داخل متصفحك أيضاً. أول تحويل يحمّل أداة التحويل مرة واحدة (حوالي 30MB) وقد يستغرق دقيقة على الهاتف.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center rounded-xl bg-black p-2">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="max-h-[480px] w-full rounded-lg object-contain"
          />
        </div>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        كل المعالجة والتسجيل يتمّان داخل متصفحك مباشرة — ملفك الصوتي لا يُرفع لأي خادم إطلاقاً.
      </p>
    </div>
  );
}
