"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeAudio, modelFromLandmarks, modelFromMouth, renderFrame, sampleTrack, type Model, type Track, type Weights } from "./engine";
import { EFFECTS, applyEffect, type EffectId } from "./voice";
import { loadVisemeModel, refineTrack, type Prototype } from "./viseme";

/**
 * Talking photo, entirely in the browser (nothing is uploaded): a photo + a voice (uploaded or recorded) become a short video of the photo speaking.
 * The voice is analysed into mouth weights (jaw, spread, round, hiss), the face is a triangle mesh (MediaPipe landmarks, or a ring built around the mouth
 * the user taps for drawings), and see engine.ts for how the mouth, teeth, tongue, blinks and head sway are produced. Every frame carries an "AI-generated" mark.
 */

type Lang = "ar" | "en";
const T = {
  ar: {
    pickImage: "1) اختر الصورة", pickAudio: "2) الصوت", upload: "رفع ملف صوتي", record: "تسجيل بالميكروفون", stopRec: "إيقاف التسجيل",
    consent: "أقرّ بأن الصورة لي أو لشخصية خيالية أو لشخص أذن لي بذلك، ولن أستخدم الفيديو للانتحال أو الخداع أو الإساءة.",
    place: "اضغط على الصورة لتحديد موضع الفم، وغيّر حجمه بالشريط.", size: "حجم الفم", detecting: "جارٍ البحث عن الوجه…", found: "وُجد وجه: ستتحرك الشفاه والفك والعينان تلقائياً.",
    notFound: "لم يُعثر على وجه بشري (طبيعي للرسوم والشخصيات): اضغط على الصورة عند الفم.",
    voiceFx: "تغيير الصوت", analyzing: "جارٍ تحليل الصوت…", analyzed: "تم تحليل الصوت.", analyzeFail: "تعذّر تحليل هذا الصوت؛ سيُستخدم تحليل أبسط.",
    preview: "معاينة", makeVideo: "اصنع الفيديو", making: "جارٍ التسجيل… (بطول الصوت)", download: "تنزيل الفيديو", share: "مشاركة", del: "حذف الفيديو وإعادة المحاولة",
    needConsent: "فعّل الإقرار أولاً.", needBoth: "اختر صورة وصوتاً.", tooLong: "الصوت أطول من 60 ثانية.", micDenied: "تعذّر الوصول للميكروفون.",
    noRecorder: "متصفحك لا يدعم تسجيل الفيديو. جرّب Chrome أو Safari حديث.", ready: "الفيديو جاهز. إن لم يعجبك احذفه وأعد المحاولة.", deleted: "حُذف الفيديو.",
    note: "تعمل الأداة بالكامل في متصفحك: لا تُرفع صورتك ولا صوتك لأي خادم. حركة الفم تُشتق من الصوت نفسه (انفتاح الفك، انفراج الشفاه أو استدارتها، الأصوات الصفيرية)، وتُرسم الأسنان واللسان داخل الفم.",
  },
  en: {
    pickImage: "1) Pick the picture", pickAudio: "2) The voice", upload: "Upload an audio file", record: "Record with the microphone", stopRec: "Stop recording",
    consent: "I confirm the picture is mine, a fictional character, or of someone who allowed it, and I will not use the video to impersonate, deceive or abuse.",
    place: "Tap the picture to place the mouth, and change its size with the slider.", size: "Mouth size", detecting: "Looking for a face…", found: "A face was found: lips, jaw and eyes will move by themselves.",
    notFound: "No human face found (normal for cartoons and characters): tap the picture at the mouth.",
    voiceFx: "Voice effect", analyzing: "Analysing the voice…", analyzed: "Voice analysed.", analyzeFail: "This audio could not be analysed; a simpler analysis is used.",
    preview: "Preview", makeVideo: "Make the video", making: "Recording… (as long as the audio)", download: "Download the video", share: "Share", del: "Delete the video and try again",
    needConsent: "Tick the confirmation first.", needBoth: "Choose a picture and a voice.", tooLong: "The audio is longer than 60 seconds.", micDenied: "Could not access the microphone.",
    noRecorder: "Your browser cannot record video. Try a recent Chrome or Safari.", ready: "The video is ready. If you do not like it, delete it and try again.", deleted: "The video was deleted.",
    note: "Runs entirely in your browser: your picture and voice are never uploaded. The mouth follows the voice itself (jaw opening, spread or rounded lips, hissing sounds) and teeth and tongue are drawn inside the mouth.",
  },
} as const;

const MAX_SIDE = 720;
const MAX_SECONDS = 60;
const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MP_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

async function detectLandmarks(c: HTMLCanvasElement): Promise<{ x: number; y: number; z: number }[] | null> {
  try {
    const vision: any = await import(/* webpackIgnore: true */ `${MP}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const lm = await vision.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MP_MODEL }, runningMode: "IMAGE", numFaces: 1 });
    const res = lm.detect(c);
    lm.close?.();
    const p = res?.faceLandmarks?.[0];
    return p && p.length >= 468 ? p.map((q: any) => ({ x: q.x, y: q.y, z: q.z ?? 0 })) : null;
  } catch {
    return null;
  }
}

export default function TalkingPhoto({ lang = "ar" }: { lang?: Lang }) {
  const t = T[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  const viewRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<Model | null>(null);
  const hasFace = useRef(false);
  const mouth = useRef({ x: 0, y: 0, w: 80 });
  const trackRef = useRef<Track | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graph = useRef<{ ac: AudioContext; an: AnalyserNode; dest: MediaStreamAudioDestinationNode } | null>(null);
  const raf = useRef(0);
  const playing = useRef(false);
  const micRec = useRef<MediaRecorder | null>(null);
  const blink = useRef({ start: -10, next: 1.2 });
  const fallbackOpen = useRef(0);

  const [hasImage, setHasImage] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState("");
  const [recMic, setRecMic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoExt, setVideoExt] = useState("webm");
  const [mouthW, setMouthW] = useState(80);
  const [manual, setManual] = useState(false);

  // ---------- drawing ----------
  const paint = useCallback((w: Weights, time: number, moving: boolean, marker: boolean) => {
    const cv = viewRef.current, base = baseRef.current, work = workRef.current;
    if (!cv || !base || !work) return;
    let b = 0;
    if (moving) {
      const s = blink.current;
      if (time >= s.next) { s.start = time; s.next = time + 2.2 + Math.random() * 3; }
      const k = (time - s.start) / 0.16;
      b = k >= 0 && k <= 1 ? Math.sin(Math.PI * k) : 0;
    }
    renderFrame(cv, work, base, modelRef.current, { t: time, w, blink: b, moving });
    const ctx = cv.getContext("2d")!, W = cv.width, H = cv.height;
    ctx.font = `${Math.max(12, Math.round(W / 32))}px system-ui, sans-serif`; ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(8, H - Math.round(W / 24) - 10, Math.round(W / 4.2), Math.round(W / 24) + 6);
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fillText("AI-generated", 14, H - 10);
    if (marker) {
      const m = mouth.current;
      ctx.strokeStyle = "#ff3355"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(m.x, m.y, m.w / 2, Math.max(8, m.w / 5), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2); ctx.fillStyle = "#ff3355"; ctx.fill();
    }
  }, []);
  const still = useCallback(() => paint({ J: 0, S: 0, R: 0, F: 0, E: 0, B: 0 }, 0, false, !hasFace.current), [paint]);

  const rebuildManual = useCallback(() => {
    const base = baseRef.current;
    if (!base || hasFace.current) return;
    modelRef.current = modelFromMouth(mouth.current, base.width, base.height);
    still();
  }, [still]);

  useEffect(() => { mouth.current.w = mouthW; if (hasImage && !hasFace.current && !playing.current) rebuildManual(); }, [mouthW, hasImage, rebuildManual]);

  // ---------- picture ----------
  const onImage = async (f: File | null) => {
    if (!f) return;
    setVideoUrl(""); setMsg(t.detecting); hasFace.current = false; setManual(false); modelRef.current = null;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = async () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const W = Math.max(2, Math.round((img.width * k) / 2) * 2), H = Math.max(2, Math.round((img.height * k) / 2) * 2);   // even sizes for video
      const base = document.createElement("canvas"); base.width = W; base.height = H;
      base.getContext("2d")!.drawImage(img, 0, 0, W, H);
      const work = document.createElement("canvas"); work.width = W; work.height = H;
      baseRef.current = base; workRef.current = work;
      const cv = viewRef.current!; cv.width = W; cv.height = H;
      mouth.current = { x: W / 2, y: H * 0.68, w: Math.round(W * 0.18) };
      setMouthW(mouth.current.w);
      setHasImage(true);
      URL.revokeObjectURL(url);
      still();
      const lm = await detectLandmarks(base);
      if (lm) { hasFace.current = true; modelRef.current = modelFromLandmarks(lm, W, H); setMsg(t.found); setManual(false); }
      else { setManual(true); modelRef.current = modelFromMouth(mouth.current, W, H); setMsg(t.notFound); }
      still();
    };
    img.src = url;
  };

  const onTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!hasImage || playing.current || hasFace.current) return;
    const cv = viewRef.current!, r = cv.getBoundingClientRect();
    mouth.current = { ...mouth.current, x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
    rebuildManual();
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

  const decodedRef = useRef<AudioBuffer | null>(null);
  const modelPromise = useRef<Promise<Prototype[] | null> | null>(null);
  const visemeModel = () => (modelPromise.current ??= loadVisemeModel("/tools/talking-photo/viseme-model.bin").catch(() => null));
  const [effect, setEffect] = useState<EffectId>("original");
  const effectRef = useRef<EffectId>("original");

  /** Applies the chosen voice effect to the decoded voice, analyses the result for the mouth, and makes it the audio that plays and is recorded. */
  const processAudio = useCallback(async (id: EffectId) => {
    const dec = decodedRef.current;
    if (!dec) return;
    setBusy(true); setMsg(t.analyzing);
    try {
      const { buffer, blob, loudDb } = await applyEffect(dec, id);
      let track = analyzeAudio(buffer, 30, loudDb);
      const vm = await visemeModel();
      if (vm) { try { track = refineTrack(track, buffer.getChannelData(0), buffer.sampleRate, vm); } catch { /* keep the loudness-based track */ } }
      trackRef.current = track;
      setAudioUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
      setMsg(t.analyzed);
    } catch { setMsg(t.analyzeFail); }
    finally { setBusy(false); }
  }, [t]);

  const setAudio = async (blob: Blob) => {
    setVideoUrl(""); trackRef.current = null; decodedRef.current = null;
    try {
      const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
      decodedRef.current = await ac.decodeAudioData(await blob.arrayBuffer());
      void ac.close();
      await processAudio(effectRef.current);
    } catch {   // an unusual format: play it as it is, with the loudness-only mouth
      setAudioUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
      setMsg(t.analyzeFail);
    }
  };

  const toggleMic = async () => {
    if (recMic) { micRec.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream); const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => { stream.getTracks().forEach((x) => x.stop()); setRecMic(false); void setAudio(new Blob(chunks, { type: rec.mimeType })); };
      micRec.current = rec; rec.start(); setRecMic(true);
      setTimeout(() => { if (rec.state === "recording") rec.stop(); }, MAX_SECONDS * 1000);
    } catch { setMsg(t.micDenied); }
  };

  // ---------- playing / recording ----------
  const loop = (an: AnalyserNode) => {
    const buf = new Uint8Array(an.fftSize);
    const el = audioRef.current!;
    const tick = () => {
      let w: Weights;
      if (trackRef.current) w = sampleTrack(trackRef.current, el.currentTime);
      else {   // no analysis available: loudness only
        an.getByteTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const target = Math.min(1, Math.max(0, (Math.sqrt(sum / buf.length) - 0.02) * 9));
        fallbackOpen.current += (target - fallbackOpen.current) * (target > fallbackOpen.current ? 0.55 : 0.25);
        w = { J: fallbackOpen.current, S: 0.2, R: 0, F: 0, E: fallbackOpen.current, B: 0 };
      }
      paint(w, el.currentTime + 0.001, true, false);
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
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      setBusy(true); setMsg(t.making);
    }
    playing.current = true; fallbackOpen.current = 0; blink.current = { start: -10, next: 1.0 + Math.random() };
    el.currentTime = 0;
    rec?.start(250);
    loop(g.an);
    await el.play().catch(() => null);
    el.onended = () => {
      playing.current = false; cancelAnimationFrame(raf.current);
      setTimeout(() => {
        still();
        if (rec && rec.state !== "inactive") {
          rec.onstop = () => { setVideoExt(ext); setVideoUrl(URL.createObjectURL(new Blob(chunks, { type: rec!.mimeType }))); setBusy(false); setMsg(t.ready); };
          rec.stop();
        }
      }, 300);
    };
  };

  useEffect(() => () => { cancelAnimationFrame(raf.current); }, []);

  const deleteVideo = () => { setVideoUrl((u) => { if (u) URL.revokeObjectURL(u); return ""; }); setMsg(t.deleted); still(); };

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
            {manual && (
              <label className="flex items-center gap-3">
                <span>{t.size}</span>
                <input type="range" min={20} max={Math.max(60, Math.round((viewRef.current?.width ?? 400) * 0.5))} value={mouthW} onChange={(e) => setMouthW(Number(e.target.value))} className="flex-1" />
              </label>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-extrabold text-slate-900">{t.pickAudio}</h2>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">
            {t.upload}
            <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void setAudio(f); }} />
          </label>
          <button type="button" onClick={() => void toggleMic()} className={`rounded-xl px-4 py-2 text-sm font-bold ${recMic ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-700"}`}>
            {recMic ? `⏺ ${t.stopRec}` : `🎙 ${t.record}`}
          </button>
        </div>
        <label className="mt-3 flex items-center gap-3 text-xs text-slate-600">
          <span>{t.voiceFx}</span>
          <select value={effect} disabled={busy} onChange={(e) => { const id = e.target.value as EffectId; setEffect(id); effectRef.current = id; void processAudio(id); }} className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            {EFFECTS.map((x) => <option key={x.id} value={x.id}>{lang === "ar" ? x.ar : x.en}</option>)}
          </select>
        </label>
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
            <button type="button" onClick={deleteVideo} className="rounded-xl bg-rose-50 px-5 py-3 text-sm font-bold text-rose-700 ring-1 ring-rose-200">🗑 {t.del}</button>
          </div>
        </section>
      )}
      <p className="text-xs leading-6 text-slate-500">{t.note}</p>
    </div>
  );
}
