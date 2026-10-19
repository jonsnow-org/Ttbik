"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Talking photo, entirely in the browser (nothing is uploaded): a photo + a voice (uploaded or recorded) become a short video of the photo "speaking".
 * The mouth is a puppet jaw: inside a soft elliptical mask around the mouth the lower half of the picture is shifted down by the loudness of the voice
 * and the gap is filled with a dark mouth interior; the head sways a little. The mouth position comes from MediaPipe face landmarks when a human face is
 * found, otherwise (cartoons, animals, statues) the user places it by tapping the picture. Every frame carries an "AI-generated" mark.
 */

type Lang = "ar" | "en";
const T = {
  ar: {
    pickImage: "1) اختر الصورة", pickAudio: "2) الصوت", upload: "رفع ملف صوتي", record: "تسجيل بالميكروفون", stopRec: "إيقاف التسجيل",
    consent: "أقرّ بأن الصورة لي أو لشخصية خيالية أو لشخص أذن لي بذلك، ولن أستخدم الفيديو للانتحال أو الخداع أو الإساءة.",
    place: "اضغط على الصورة لتحديد موضع الفم، وغيّر حجمه بالشريط.", size: "حجم الفم", detecting: "جارٍ البحث عن الوجه…", found: "وُجد وجه وضُبط الفم تلقائياً. يمكنك تعديله بالضغط على الصورة.",
    notFound: "لم يُعثر على وجه بشري (طبيعي للرسوم والشخصيات): اضغط على الصورة عند الفم.",
    preview: "معاينة", makeVideo: "اصنع الفيديو", making: "جارٍ التسجيل… (بطول الصوت)", download: "تنزيل الفيديو", share: "مشاركة",
    needConsent: "فعّل الإقرار أولاً.", needBoth: "اختر صورة وصوتاً.", tooLong: "الصوت أطول من 60 ثانية.", micDenied: "تعذّر الوصول للميكروفون.",
    noRecorder: "متصفحك لا يدعم تسجيل الفيديو. جرّب Chrome أو Safari حديث.", ready: "الفيديو جاهز.",
    note: "تعمل الأداة بالكامل في متصفحك: لا تُرفع صورتك ولا صوتك لأي خادم. الحركة بسيطة (فم ورأس) ومناسبة للشخصيات والصور الواضحة.",
  },
  en: {
    pickImage: "1) Pick the picture", pickAudio: "2) The voice", upload: "Upload an audio file", record: "Record with the microphone", stopRec: "Stop recording",
    consent: "I confirm the picture is mine, a fictional character, or of someone who allowed it, and I will not use the video to impersonate, deceive or abuse.",
    place: "Tap the picture to place the mouth, and change its size with the slider.", size: "Mouth size", detecting: "Looking for a face…", found: "A face was found and the mouth was set. Tap the picture to adjust it.",
    notFound: "No human face found (normal for cartoons and characters): tap the picture at the mouth.",
    preview: "Preview", makeVideo: "Make the video", making: "Recording… (as long as the audio)", download: "Download the video", share: "Share",
    needConsent: "Tick the confirmation first.", needBoth: "Choose a picture and a voice.", tooLong: "The audio is longer than 60 seconds.", micDenied: "Could not access the microphone.",
    noRecorder: "Your browser cannot record video. Try a recent Chrome or Safari.", ready: "The video is ready.",
    note: "Runs entirely in your browser: your picture and voice are never uploaded. The motion is simple (mouth and head), best for characters and clear pictures.",
  },
} as const;

const MAX_SIDE = 720;
const MAX_SECONDS = 60;
const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MP_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type Mouth = { x: number; y: number; w: number };

async function detectMouth(bmp: HTMLCanvasElement): Promise<Mouth | null> {
  try {
    const vision: any = await import(/* webpackIgnore: true */ `${MP}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const lm = await vision.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MP_MODEL }, runningMode: "IMAGE", numFaces: 1 });
    const res = lm.detect(bmp);
    lm.close?.();
    const p = res?.faceLandmarks?.[0];
    if (!p) return null;
    const W = bmp.width, H = bmp.height;
    const top = p[13], bot = p[14], l = p[61], r = p[291];
    return { x: ((top.x + bot.x) / 2) * W, y: ((top.y + bot.y) / 2) * H, w: Math.hypot((r.x - l.x) * W, (r.y - l.y) * H) };
  } catch {
    return null;
  }
}

export default function TalkingPhoto({ lang = "ar" }: { lang?: Lang }) {
  const t = T[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  const viewRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graph = useRef<{ ac: AudioContext; an: AnalyserNode; dest: MediaStreamAudioDestinationNode } | null>(null);
  const mouth = useRef<Mouth>({ x: 0, y: 0, w: 80 });
  const openRef = useRef(0);
  const raf = useRef(0);
  const playing = useRef(false);
  const micRec = useRef<MediaRecorder | null>(null);

  const [hasImage, setHasImage] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState("");
  const [recMic, setRecMic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoExt, setVideoExt] = useState("webm");
  const [mouthW, setMouthW] = useState(80);

  // ---------- drawing ----------
  const draw = useCallback((open: number, time: number, marker: boolean) => {
    const cv = viewRef.current, base = baseRef.current;
    if (!cv || !base) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    const m = mouth.current;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.sin(time * 0.9) * 0.012 * (playing.current ? 1 : 0));
    const s = 1 + (playing.current ? Math.sin(time * 0.6) * 0.004 + open * 0.006 : 0);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(base, 0, 0);
    if (open > 0.01) {
      const ex = m.w * 0.78, ey = m.w * 0.72;
      const x0 = Math.max(0, m.x - ex), y0 = Math.max(0, m.y - ey);
      const w = Math.min(W - x0, ex * 2), h = Math.min(H - y0, ey * 2);
      const cutY = m.y - y0;                      // the mouth line inside the patch
      const d = open * m.w * 0.42;                // how far the jaw drops
      const off = document.createElement("canvas");
      off.width = Math.ceil(w); off.height = Math.ceil(h);
      const o = off.getContext("2d")!;
      o.drawImage(base, x0, m.y, w, h - cutY, 0, cutY + d, w, h - cutY);          // jaw, shifted down
      const g = o.createRadialGradient(w / 2, cutY + d / 2, 1, w / 2, cutY + d / 2, m.w * 0.5);
      g.addColorStop(0, "#1a0508"); g.addColorStop(0.7, "#3a0f16"); g.addColorStop(1, "#5a1a22");
      o.fillStyle = g;
      o.beginPath(); o.ellipse(w / 2 + (m.x - x0 - w / 2), cutY + d / 2, m.w * 0.46, Math.max(1, d / 2 + 1), 0, 0, Math.PI * 2); o.fill();   // mouth interior
      o.drawImage(base, x0, y0, w, cutY, 0, 0, w, cutY);                          // upper part on top
      o.globalCompositeOperation = "destination-in";                                // soft edge so the patch melts into the picture
      const mask = o.createRadialGradient(m.x - x0, m.y - y0, m.w * 0.3, m.x - x0, m.y - y0, Math.min(ex, ey) * 1.05);
      mask.addColorStop(0, "rgba(0,0,0,1)"); mask.addColorStop(0.75, "rgba(0,0,0,1)"); mask.addColorStop(1, "rgba(0,0,0,0)");
      o.fillStyle = mask; o.fillRect(0, 0, w, h);
      ctx.drawImage(off, x0, y0);
    }
    ctx.restore();
    // the mark that stays on every frame
    ctx.font = `${Math.max(12, Math.round(W / 32))}px system-ui, sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(8, H - Math.round(W / 24) - 10, Math.round(W / 4.2), Math.round(W / 24) + 6);
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fillText("AI-generated", 14, H - 10);
    if (marker) {
      ctx.strokeStyle = "#ff3355"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(m.x, m.y, m.w / 2, Math.max(8, m.w / 5), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2); ctx.fillStyle = "#ff3355"; ctx.fill();
    }
  }, []);

  useEffect(() => { mouth.current.w = mouthW; if (!playing.current) draw(0, 0, true); }, [mouthW, draw]);

  // ---------- picture ----------
  const onImage = async (f: File | null) => {
    if (!f) return;
    setVideoUrl(""); setMsg(t.detecting);
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = async () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const W = Math.max(2, Math.round((img.width * k) / 2) * 2), H = Math.max(2, Math.round((img.height * k) / 2) * 2);   // even sizes for video
      const base = document.createElement("canvas"); base.width = W; base.height = H;
      base.getContext("2d")!.drawImage(img, 0, 0, W, H);
      baseRef.current = base;
      const cv = viewRef.current!; cv.width = W; cv.height = H;
      mouth.current = { x: W / 2, y: H * 0.68, w: Math.round(W * 0.18) };
      setMouthW(mouth.current.w);
      setHasImage(true);
      draw(0, 0, true);
      URL.revokeObjectURL(url);
      const found = await detectMouth(base);
      if (found) { mouth.current = found; setMouthW(Math.round(found.w)); setMsg(t.found); } else setMsg(t.notFound);
      draw(0, 0, true);
    };
    img.src = url;
  };

  const onTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!hasImage || playing.current) return;
    const cv = viewRef.current!, r = cv.getBoundingClientRect();
    mouth.current = { ...mouth.current, x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
    draw(0, 0, true);
  };

  // ---------- audio ----------
  const ensureGraph = () => {
    if (graph.current) return graph.current;
    const el = audioRef.current!;
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    const src = ac.createMediaElementSource(el);
    const an = ac.createAnalyser(); an.fftSize = 1024;
    const dest = ac.createMediaStreamDestination();
    src.connect(an); an.connect(ac.destination); an.connect(dest);
    graph.current = { ac, an, dest };
    return graph.current;
  };
  const setAudio = (blob: Blob) => { setVideoUrl(""); setAudioUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); }); };

  const toggleMic = async () => {
    if (recMic) { micRec.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream); const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => { stream.getTracks().forEach((x) => x.stop()); setRecMic(false); setAudio(new Blob(chunks, { type: rec.mimeType })); };
      micRec.current = rec; rec.start(); setRecMic(true);
      setTimeout(() => { if (rec.state === "recording") rec.stop(); }, MAX_SECONDS * 1000);
    } catch { setMsg(t.micDenied); }
  };

  // ---------- playing / recording ----------
  const loop = (an: AnalyserNode) => {
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      const target = Math.pow(Math.min(1, Math.max(0, (rms - 0.02) * 9)), 0.8);
      openRef.current += (target - openRef.current) * (target > openRef.current ? 0.55 : 0.25);
      draw(openRef.current, performance.now() / 1000, false);
      if (playing.current) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const run = async (record: boolean) => {
    if (!consent) { setMsg(t.needConsent); return; }
    if (!hasImage || !audioUrl) { setMsg(t.needBoth); return; }
    const el = audioRef.current!;
    if (el.duration > MAX_SECONDS + 0.5) { setMsg(t.tooLong); return; }
    const g = ensureGraph(); await g.ac.resume();
    let rec: MediaRecorder | null = null; const chunks: Blob[] = []; let ext = "webm";
    if (record) {
      const mime = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m));
      if (!mime) { setMsg(t.noRecorder); return; }
      ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      const stream = new MediaStream([...viewRef.current!.captureStream(30).getVideoTracks(), ...g.dest.stream.getAudioTracks()]);
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      setBusy(true); setMsg(t.making);
    }
    playing.current = true; openRef.current = 0;
    el.currentTime = 0;
    rec?.start(250);
    loop(g.an);
    await el.play().catch(() => null);
    el.onended = () => {
      playing.current = false; cancelAnimationFrame(raf.current);
      setTimeout(() => {
        draw(0, 0, false);
        if (rec && rec.state !== "inactive") {
          rec.onstop = () => { setVideoExt(ext); setVideoUrl(URL.createObjectURL(new Blob(chunks, { type: rec!.mimeType }))); setBusy(false); setMsg(t.ready); };
          rec.stop();
        } else draw(0, 0, true);
      }, 300);
    };
  };

  useEffect(() => () => { cancelAnimationFrame(raf.current); }, []);

  const shareVideo = async () => {
    try {
      const blob = await (await fetch(videoUrl)).blob();
      const file = new File([blob], `talking-photo.${videoExt}`, { type: blob.type });
      if ((navigator as any).canShare?.({ files: [file] })) await (navigator as any).share({ files: [file] });
    } catch { /* the user closed the share sheet */ }
  };

  return (
    <div dir={dir} className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-extrabold text-slate-900">{t.pickImage}</h2>
        <input type="file" accept="image/*" onChange={(e) => void onImage(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
        <div className="mt-3 flex justify-center">
          <canvas ref={viewRef} onPointerDown={onTap} width={4} height={4} className={`max-h-[60vh] w-full max-w-sm touch-none rounded-xl bg-slate-100 ${hasImage ? "" : "hidden"}`} />
        </div>
        {hasImage && (
          <div className="mt-3 space-y-2 text-xs text-slate-600">
            <p>{msg || t.place}</p>
            <label className="flex items-center gap-3">
              <span>{t.size}</span>
              <input type="range" min={20} max={Math.max(60, Math.round((viewRef.current?.width ?? 400) * 0.5))} value={mouthW} onChange={(e) => setMouthW(Number(e.target.value))} className="flex-1" />
            </label>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-extrabold text-slate-900">{t.pickAudio}</h2>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">
            {t.upload}
            <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setAudio(f); }} />
          </label>
          <button type="button" onClick={() => void toggleMic()} className={`rounded-xl px-4 py-2 text-sm font-bold ${recMic ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-700"}`}>
            {recMic ? `⏺ ${t.stopRec}` : `🎙 ${t.record}`}
          </button>
        </div>
        <audio ref={audioRef} src={audioUrl || undefined} controls className="mt-3 w-full" preload="auto" />
      </section>

      <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" />
        <span>{t.consent}</span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void run(false)} className="rounded-xl bg-slate-200 px-5 py-3 text-sm font-bold text-slate-800 disabled:opacity-50">▶ {t.preview}</button>
        <button type="button" disabled={busy} onClick={() => void run(true)} className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">🎬 {t.makeVideo}</button>
      </div>
      {!hasImage && msg && <p className="text-xs text-slate-600">{msg}</p>}

      {videoUrl && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <video src={videoUrl} controls playsInline className="mx-auto max-h-[60vh] w-full max-w-sm rounded-xl" />
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={videoUrl} download={`talking-photo.${videoExt}`} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white">⬇ {t.download}</a>
            <button type="button" onClick={() => void shareVideo()} className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-700 ring-1 ring-slate-200">↗ {t.share}</button>
          </div>
        </section>
      )}
      <p className="text-xs leading-6 text-slate-500">{t.note}</p>
    </div>
  );
}
