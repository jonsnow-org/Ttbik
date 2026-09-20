"use client";

import { useEffect, useRef, useState } from "react";

const CANVAS_W = 540;
const CANVAS_H = 960;

function pickMimeType(): string {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "video/webm";
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
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationFrameId = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      audioContextRef.current?.close().catch(() => {});
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAudioUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioFile(file);
    setAudioUrl(URL.createObjectURL(file));
    setTitle(file.name.replace(/\.[^.]+$/, ""));
    setVideoUrl(null);
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

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, CANVAS_W, CANVAS_H);
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

    if (title) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 36px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(title.slice(0, 30), CANVAS_W / 2, CANVAS_H - 200);
    }

    animationFrameId.current = requestAnimationFrame(() => drawFrame(analyser, dataArray));
  }

  async function generate() {
    const canvas = canvasRef.current;
    const audioEl = audioRef.current;
    if (!audioFile || !canvas || !audioEl || !canGenerate) return;

    if (typeof MediaRecorder === "undefined") {
      setError("متصفحك لا يدعم تسجيل الفيديو. جرّب متصفح Chrome أو Firefox الحديث.");
      return;
    }

    setError("");
    setVideoUrl(null);
    setProgress(0);
    recordedChunksRef.current = [];

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = audioContext;
    await audioContext.resume();

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const source = audioContext.createMediaElementSource(audioEl);
    const recordDest = audioContext.createMediaStreamDestination();
    // Visualization data + audible playback while recording + the actual
    // audio track that gets baked into the exported video — three separate
    // connections off the same source node.
    source.connect(analyser);
    source.connect(audioContext.destination);
    source.connect(recordDest);

    drawFrame(analyser, dataArray);

    const canvasStream = canvas.captureStream(30);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...recordDest.stream.getAudioTracks(),
    ]);

    const mediaRecorder = new MediaRecorder(combinedStream, { mimeType: pickMimeType() });
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunksRef.current.push(event.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mediaRecorder.mimeType || "video/webm" });
      setVideoUrl(URL.createObjectURL(blob));
      setIsRecording(false);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      audioContext.close().catch(() => {});
      // Count the free try only once a video was actually produced -- a
      // browser that can't record at all (see the MediaRecorder check
      // above) must never burn someone's free attempt for nothing.
      onGenerated();
    };

    audioEl.ontimeupdate = () => {
      if (audioEl.duration) setProgress(Math.min(100, Math.round((audioEl.currentTime / audioEl.duration) * 100)));
    };
    audioEl.onended = () => mediaRecorder.stop();

    setIsRecording(true);
    mediaRecorder.start();
    audioEl.currentTime = 0;
    await audioEl.play();
  }

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
                ? "توليد فيديو الريلز الآن"
                : "انتهت محاولاتك المجانية — اطلب الوصول الكامل بالأسفل"}
          </button>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {videoUrl && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="mb-3 font-bold text-emerald-800">تم إنشاء الفيديو بنجاح!</p>
              <a
                href={videoUrl}
                download="reel-visualizer.webm"
                className="inline-block rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
              >
                تنزيل الفيديو
              </a>
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
