"use client";

import { useEffect, useRef, useState } from "react";
import VideoResult from "./VideoResult";
import { pickRecording, safeFileBase } from "./videoExport";

const CANVAS_W = 540;
const CANVAS_H = 960;

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
  const [recorded, setRecorded] = useState<{ blob: Blob; format: "mp4" | "webm" } | null>(null);

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
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const titleRef = useRef("");
  bgImageRef.current = bgImage;
  titleRef.current = title;

  useEffect(() => {
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  function resetOutputs() {
    setRecorded(null);
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

    // Bass level (lowest bins) drives the "beat" pulse below.
    let bass = 0;
    if (dataArray) {
      for (let i = 0; i < 8; i++) bass += dataArray[i];
      bass = bass / (8 * 255);
    }
    const t = performance.now() / 1000;

    const bg = bgImageRef.current;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (bg) {
      // Cover-fit so portrait/landscape photos fill the 9:16 frame without
      // stretching, plus a slow Ken Burns zoom/drift and a bass-driven pulse
      // so the background actually moves instead of being one still frame
      // (owner report 2026-09-23: "مجرد صورة ثابتة").
      const zoom = 1.12 + 0.06 * Math.sin(t * 0.35) + bass * 0.06;
      const scale = Math.max(CANVAS_W / bg.width, CANVAS_H / bg.height) * zoom;
      const w = bg.width * scale;
      const h = bg.height * scale;
      const dx = Math.sin(t * 0.23) * (w - CANVAS_W) * 0.35;
      const dy = Math.cos(t * 0.17) * (h - CANVAS_H) * 0.35;
      ctx.drawImage(bg, (CANVAS_W - w) / 2 + dx, (CANVAS_H - h) / 2 + dy, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    } else {
      const hue = (t * 12) % 360;
      const gradient = ctx.createLinearGradient(0, 0, CANVAS_W * Math.sin(t * 0.2), CANVAS_H);
      gradient.addColorStop(0, `hsl(${hue}, 45%, 14%)`);
      gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 50%, 20%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    const centerX = CANVAS_W / 2;
    const centerY = CANVAS_H / 2 - 100;
    const radius = 170 + bass * 30;

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

    const caption = titleRef.current;
    if (caption) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 36px sans-serif";
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 8;
      ctx.fillText(caption.slice(0, 30), CANVAS_W / 2, CANVAS_H - 200);
      ctx.shadowBlur = 0;
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
      setRecorded({ blob: new Blob(chunks, { type }), format });
      setIsRecording(false);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
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

  const fileBase = safeFileBase(title, "ttbik-reel");

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
            disabled={!audioFile || isRecording || !canGenerate}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300"
          >
            {isRecording
              ? `جاري توليد الفيديو... ${progress}%`
              : canGenerate
                ? recorded
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

          {recorded && !isRecording && <VideoResult recorded={recorded} fileBase={fileBase} />}
        </div>

        {/* The live recording surface. Hidden once a finished video exists —
            the <video> preview above replaces it; showing both looked like a
            duplicated second screen under the preview (owner report). */}
        <div className={`${recorded && !isRecording ? "hidden" : "flex"} items-center justify-center rounded-xl bg-black p-2`}>
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
