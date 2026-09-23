"use client";

import { useEffect, useRef, useState } from "react";
import VideoResult from "./VideoResult";
import { pickRecording, safeFileBase } from "./videoExport";

// Description (+ optional photo, + optional audio) -> multi-scene vertical
// video, entirely in the visitor's browser:
//   1. a free, no-account LLM (Pollinations text) turns the description into
//      a storyboard: N scenes, each an English image prompt + a short caption
//      in the description's own language;
//   2. a free, no-account image model (Pollinations image) paints each scene
//      at 9:16;
//   3. the scenes are animated on a canvas (Ken Burns camera moves,
//      crossfades, animated captions, background music) and recorded with
//      MediaRecorder into a real video file.
// Owner directive 2026-09-23: "يصنعه من وصف قصير وصورة او وصف بدون صورة".
// Generative *motion* (objects moving inside the frame) needs a paid video
// model; this is the free tier — real AI scenes with camera motion.

const W = 540;
const H = 960;
const FADE = 0.7; // seconds of crossfade between scenes

type Scene = { prompt: string; caption: string; img: HTMLImageElement | null; status: "idle" | "loading" | "ready" | "error"; user?: boolean };

const STYLES: { key: string; label: string; suffix: string }[] = [
  { key: "cinematic", label: "سينمائي", suffix: "cinematic film still, dramatic lighting, shallow depth of field, highly detailed" },
  { key: "realistic", label: "واقعي", suffix: "photorealistic, natural light, 35mm photo, highly detailed" },
  { key: "cartoon", label: "كرتوني", suffix: "3d cartoon style, pixar-like, vibrant colors, soft lighting" },
  { key: "anime", label: "أنمي", suffix: "anime style, studio ghibli inspired, detailed background" },
  { key: "painting", label: "لوحة فنية", suffix: "oil painting, rich brush strokes, artistic, masterpiece" },
];

const SHOT_HINTS = ["wide establishing shot", "medium shot", "close-up detail shot", "dynamic angle", "wide shot, golden hour", "final hero shot"];

function loadImage(src: string, timeoutMs = 90_000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // required so the canvas stays recordable
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("image failed"));
    };
    img.src = src;
  });
}

function imageUrl(prompt: string, seed: number) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${W}&height=${H}&nologo=true&seed=${seed}&referrer=ttbik.vercel.app`;
}

// Direct from the visitor's browser first (spreads the free API's
// per-visitor quota), then through our own same-origin proxy.
async function loadSceneImage(prompt: string, seed: number) {
  try {
    return await loadImage(imageUrl(prompt, seed), 45_000);
  } catch {
    return await loadImage(`/api/tools/story-image?seed=${seed}&prompt=${encodeURIComponent(prompt)}`, 70_000);
  }
}

async function askStoryboard(system: string, description: string): Promise<string> {
  try {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        referrer: "ttbik.vercel.app",
        messages: [
          { role: "system", content: system },
          { role: "user", content: description },
        ],
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.includes("{")) throw new Error("no content");
    return content;
  } catch {
    const res = await fetch("/api/tools/story-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, description }),
    });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()).content || "";
  }
}

async function planScenes(description: string, count: number): Promise<{ prompt: string; caption: string }[]> {
  const system =
    `You are a storyboard writer for short vertical videos (reels). Split the user's description into exactly ${count} consecutive scenes that tell it visually. ` +
    `Return ONLY minified JSON: {"scenes":[{"prompt":"...","caption":"..."}]}. ` +
    `"prompt": a vivid English image-generation prompt for that scene (subject, setting, lighting, vertical composition), no text or letters in the image. ` +
    `"caption": a very short on-screen caption (max 7 words) written in the SAME language as the user's description.`;
  try {
    const text = await askStoryboard(system, description);
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const scenes = (json.scenes || [])
      .filter((s: any) => typeof s?.prompt === "string" && s.prompt.trim())
      .slice(0, count)
      .map((s: any) => ({ prompt: String(s.prompt), caption: String(s.caption || "").slice(0, 80) }));
    if (scenes.length >= Math.min(2, count)) return scenes;
    throw new Error("empty storyboard");
  } catch {
    // Offline fallback: same description, different shot types; captions
    // are the description's own sentences.
    const sentences = description.split(/[.!؟?،,\n]+/).map((s) => s.trim()).filter(Boolean);
    return Array.from({ length: count }, (_, i) => ({
      prompt: `${description}, ${SHOT_HINTS[i % SHOT_HINTS.length]}`,
      caption: sentences[i] || (i === 0 ? sentences[0] || "" : ""),
    }));
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

// Each scene gets a different camera move so consecutive shots don't feel identical.
function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, index: number, p: number, alpha: number) {
  ctx.globalAlpha = alpha;
  const img = scene.img;
  if (img) {
    const mode = index % 4;
    const zoom = mode === 0 ? 1.05 + 0.15 * p : mode === 1 ? 1.2 - 0.15 * p : 1.15;
    const scale = Math.max(W / img.width, H / img.height) * zoom;
    const w = img.width * scale;
    const h = img.height * scale;
    const spareX = w - W;
    const spareY = h - H;
    let x = -spareX / 2;
    let y = -spareY / 2;
    if (mode === 2) x = -spareX * p; // pan
    if (mode === 3) {
      x = -spareX * (1 - p);
      y = -spareY * (0.3 + 0.4 * p);
    }
    ctx.drawImage(img, x, y, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `hsl(${(index * 70) % 360}, 50%, 25%)`);
    g.addColorStop(1, `hsl(${(index * 70 + 60) % 360}, 55%, 12%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Bottom shade so captions stay readable on bright images.
  const shade = ctx.createLinearGradient(0, H * 0.55, 0, H);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.65)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  if (scene.caption) {
    const appear = Math.min(1, Math.max(0, (p - 0.08) / 0.2));
    ctx.globalAlpha = alpha * appear;
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 10;
    const lines = wrapLines(ctx, scene.caption, W - 80);
    const baseY = H - 150 - (lines.length - 1) * 46 + (1 - appear) * 30;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, baseY + i * 46));
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

// Soft generated background pad (a slow I–vi–IV–V chord loop) for videos
// made without an uploaded audio track, so the result isn't silent.
function scheduleAmbient(ac: AudioContext, dest: AudioNode, duration: number) {
  const chords = [
    [261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
  ];
  const master = ac.createGain();
  master.gain.value = 0.12;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1400;
  master.connect(filter);
  filter.connect(dest);
  const chordLen = 2.5;
  const start = ac.currentTime + 0.05;
  for (let t = 0, i = 0; t < duration; t += chordLen, i++) {
    for (const f of chords[i % chords.length]) {
      for (const detune of [-6, 6]) {
        const osc = ac.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = f;
        osc.detune.value = detune;
        const g = ac.createGain();
        const s = start + t;
        const e = Math.min(start + t + chordLen + 0.4, start + duration);
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.25, s + 0.6);
        g.gain.linearRampToValueAtTime(0, e);
        osc.connect(g);
        g.connect(master);
        osc.start(s);
        osc.stop(e + 0.05);
      }
    }
  }
  // Fade the whole pad out over the last second.
  master.gain.setValueAtTime(0.12, start + Math.max(0, duration - 1));
  master.gain.linearRampToValueAtTime(0, start + duration);
}

export default function StoryVideoStudio({ canGenerate, onGenerated }: { canGenerate: boolean; onGenerated: () => void }) {
  const [description, setDescription] = useState("");
  const [userImage, setUserImage] = useState<HTMLImageElement | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [style, setStyle] = useState(STYLES[0].key);
  const [sceneCount, setSceneCount] = useState(4);
  const [secondsPerScene, setSecondsPerScene] = useState(3.5);
  const [ambient, setAmbient] = useState(true);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [phase, setPhase] = useState<"idle" | "planning" | "painting" | "ready" | "recording">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState<{ blob: Blob; format: "mp4" | "webm" } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const scenesRef = useRef<Scene[]>([]);
  scenesRef.current = scenes;

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const styleSuffix = STYLES.find((s) => s.key === style)?.suffix || "";

  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return setUserImage(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => setUserImage(img);
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  function updateScene(i: number, patch: Partial<Scene>) {
    setScenes((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  async function paint(i: number, prompt: string) {
    updateScene(i, { status: "loading" });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const seed = Math.floor(Math.random() * 1_000_000);
        const img = await loadSceneImage(`${prompt}, ${styleSuffix}, vertical 9:16 composition, no text`, seed);
        updateScene(i, { img, status: "ready" });
        return;
      } catch {
        /* retry once with a new seed */
      }
    }
    updateScene(i, { status: "error" });
  }

  async function buildStoryboard() {
    if (!description.trim() && !userImage) return;
    setError("");
    setRecorded(null);
    setPhase("planning");
    try {
      let planned: { prompt: string; caption: string }[];
      if (description.trim()) {
        planned = await planScenes(description.trim(), sceneCount);
      } else {
        planned = Array.from({ length: sceneCount }, () => ({ prompt: "", caption: "" }));
      }
      const initial: Scene[] = planned.map((s) => ({ ...s, img: null, status: "idle" }));
      if (userImage) {
        // The visitor's own photo opens the video; with no description every
        // scene is that photo under a different camera move.
        initial[0] = { ...initial[0], img: userImage, status: "ready", user: true };
        if (!description.trim()) for (let i = 1; i < initial.length; i++) initial[i] = { ...initial[i], img: userImage, status: "ready", user: true };
      }
      setScenes(initial);
      setPhase("painting");
      // Sequential on purpose: the free image API queues anonymous requests
      // per visitor, so parallel requests just fail faster.
      for (let i = 0; i < initial.length; i++) {
        if (initial[i].status !== "ready") await paint(i, initial[i].prompt);
      }
      setPhase("ready");
    } catch {
      setError("تعذّر تجهيز المشاهد. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.");
      setPhase("idle");
    }
  }

  async function record() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const list = scenesRef.current;
    if (!canvas || !ctx || !list.length || !canGenerate) return;
    if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
      setError("متصفحك لا يدعم تسجيل الفيديو. جرّب متصفح Chrome الحديث.");
      return;
    }
    setError("");
    setRecorded(null);
    setPhase("recording");
    setProgress(0);

    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    let total = list.length * secondsPerScene;
    if (audioFile) {
      try {
        const buf = await ac.decodeAudioData(await audioFile.arrayBuffer());
        total = Math.min(Math.max(buf.duration, list.length * 1.5), 90);
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.connect(dest);
        src.connect(ac.destination);
        src.start(ac.currentTime + 0.05);
        src.stop(ac.currentTime + 0.05 + total);
      } catch {
        setError("تعذّرت قراءة الملف الصوتي — سيُنشأ الفيديو بموسيقى خلفية تلقائية بدلاً منه.");
        scheduleAmbient(ac, dest, total);
      }
    } else if (ambient) {
      scheduleAmbient(ac, dest, total);
    }
    const per = total / list.length;

    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const { mimeType, format } = pickRecording();
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 5_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      ac.close().catch(() => {});
      setRecorded({ blob: new Blob(chunks, { type: rec.mimeType || (format === "mp4" ? "video/mp4" : "video/webm") }), format });
      setPhase("ready");
      onGenerated();
    };

    const t0 = performance.now();
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) {
        if (rec.state !== "inactive") rec.stop();
        return;
      }
      const i = Math.min(list.length - 1, Math.floor(t / per));
      const local = t - i * per;
      ctx.clearRect(0, 0, W, H);
      drawScene(ctx, list[i], i, local / per, 1);
      // Crossfade the next scene in over the last FADE seconds of this one.
      const fadeLen = Math.min(FADE, per / 3);
      if (i < list.length - 1 && local > per - fadeLen) {
        const a = (local - (per - fadeLen)) / fadeLen;
        drawScene(ctx, list[i + 1], i + 1, 0, a);
      }
      // Fade in from / out to black at the very start and end.
      const edge = Math.min(1, t / 0.4, (total - t) / 0.5);
      if (edge < 1) {
        ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, edge)})`;
        ctx.fillRect(0, 0, W, H);
      }
      setProgress(Math.round((t / total) * 100));
      rafRef.current = requestAnimationFrame(frame);
    };
    rec.start(1000);
    frame();
  }

  const busy = phase === "planning" || phase === "painting" || phase === "recording";
  const readyCount = scenes.filter((s) => s.status === "ready").length;
  const fileBase = safeFileBase(description, "ttbik-video");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">1. اكتب وصفاً قصيراً للفيديو</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={600}
            placeholder="مثال: قطة صغيرة تستكشف مدينة عربية قديمة ليلاً، تمشي بين الأسواق والفوانيس ثم تجلس فوق سطح تنظر إلى القمر"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">2. صورتك (اختياري)</label>
            <input type="file" accept="image/*" onChange={handleImage} className="text-sm" />
            <p className="mt-1 text-xs text-slate-400">تظهر في بداية الفيديو. بدون وصف: يُصنع الفيديو كاملاً من صورتك بحركات كاميرا مختلفة.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">3. صوت أو موسيقى (اختياري)</label>
            <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} className="text-sm" />
            <p className="mt-1 text-xs text-slate-400">إن أضفت صوتاً تصبح مدة الفيديو بطول الصوت (حتى 90 ثانية).</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">
            النمط
            <select value={style} onChange={(e) => setStyle(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              {STYLES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            عدد المشاهد
            <select value={sceneCount} onChange={(e) => setSceneCount(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              {[3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            ثوانٍ لكل مشهد
            <select value={secondsPerScene} onChange={(e) => setSecondsPerScene(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              {[2.5, 3.5, 5, 7].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-slate-600">
            <input type="checkbox" checked={ambient} onChange={(e) => setAmbient(e.target.checked)} />
            موسيقى خلفية تلقائية
          </label>
        </div>

        <button
          onClick={buildStoryboard}
          disabled={busy || (!description.trim() && !userImage)}
          className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:bg-slate-300"
        >
          {phase === "planning"
            ? "جاري كتابة القصة وتقسيمها لمشاهد..."
            : phase === "painting"
              ? `جاري رسم المشاهد بالذكاء الاصطناعي... ${readyCount}/${scenes.length}`
              : scenes.length
                ? "🔄 توليد مشاهد جديدة"
                : "① توليد المشاهد بالذكاء الاصطناعي"}
        </button>

        {scenes.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {scenes.map((s, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-slate-100">
                  {s.img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.img.src} alt={s.caption || `مشهد ${i + 1}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center p-2 text-center text-xs text-slate-500">
                      {s.status === "error" ? "تعذّر الرسم" : "جاري الرسم..."}
                    </div>
                  )}
                  <span className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                </div>
                <input
                  value={s.caption}
                  onChange={(e) => updateScene(i, { caption: e.target.value })}
                  placeholder="نص المشهد"
                  className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                />
                {!s.user && s.prompt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => paint(i, s.prompt)}
                    className="rounded bg-slate-100 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                  >
                    إعادة رسم
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {scenes.length > 0 && (
          <button
            onClick={record}
            disabled={busy || readyCount === 0 || !canGenerate}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300"
          >
            {phase === "recording"
              ? `جاري إنشاء الفيديو... ${progress}%`
              : !canGenerate
                ? "انتهت محاولاتك المجانية — اطلب الوصول الكامل بالأسفل"
                : recorded
                  ? "② إنشاء الفيديو من جديد"
                  : "② إنشاء الفيديو الآن"}
          </button>
        )}
        {phase === "recording" && <p className="text-xs text-slate-500">يُسجَّل الفيديو الآن مباشرة — أبقِ هذه الصفحة مفتوحة وظاهرة حتى ينتهي.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Recording surface: visible only while recording (live view),
            the finished <video> preview replaces it afterwards. */}
        <div className={`${phase === "recording" ? "flex" : "hidden"} justify-center rounded-xl bg-black p-2`}>
          <canvas ref={canvasRef} width={W} height={H} className="max-h-[480px] w-auto rounded-lg" />
        </div>

        {recorded && phase !== "recording" && <VideoResult recorded={recorded} fileBase={fileBase} />}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        المشاهد تُرسم بنماذج ذكاء اصطناعي مجانية، والفيديو يُركَّب ويُسجَّل داخل متصفحك. صورتك وملفك الصوتي لا يُرفعان لأي خادم.
      </p>
    </div>
  );
}
