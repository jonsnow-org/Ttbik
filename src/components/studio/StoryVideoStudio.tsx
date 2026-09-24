"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import VideoResult from "./VideoResult";
import { pickRecording, safeFileBase } from "./videoExport";
import {
  ACTION_LABEL,
  ALL_ACTIONS,
  ALL_KINDS,
  ALL_PLACES,
  ALL_TIMES,
  ALL_WEATHERS,
  KIND_LABEL,
  PLACE_LABEL,
  TIME_LABEL,
  WEATHER_LABEL,
  understand,
  type SceneCode,
} from "@/lib/motion/brain";
import { decodeStory, encodeStory } from "@/lib/motion/codec";
import { H, W, drawScene } from "@/lib/motion/render";
import { scheduleSoundtrack } from "@/lib/motion/sound";

// «رموز» — description → scene codes → animated video, entirely in the
// visitor's browser with our own engine (src/lib/motion): a symbol lexicon and
// rule-based parser, a code-drawn renderer with real in-frame motion, and
// synthesised sound. No AI model, no outside image service, nothing uploaded.

const FADE = 0.6;

const EXAMPLES = [
  "قطط صغيرة تلعب في الحقل وتطارد الفراشة ثم تنام تحت الشجرة",
  "طفل يمشي على شاطئ البحر عند الغروب ثم يجلس وينظر إلى الأمواج",
  "كلب بني يركض في المدينة ليلاً تحت المطر ثم يستريح في البيت",
  "عصافير تطير فوق الغابة صباحاً ثم سمكة تسبح في النهر",
];

/** One frame of the whole story at time t (seconds). */
function drawTimeline(ctx: CanvasRenderingContext2D, scenes: SceneCode[], per: number, t: number) {
  const total = scenes.length * per;
  const i = Math.min(scenes.length - 1, Math.floor(t / per));
  const local = t - i * per;
  ctx.clearRect(0, 0, W, H);
  drawScene(ctx, scenes[i], local, per, i, 1);
  const fadeLen = Math.min(FADE, per / 3);
  if (i < scenes.length - 1 && local > per - fadeLen) {
    drawScene(ctx, scenes[i + 1], 0, per, i + 1, (local - (per - fadeLen)) / fadeLen);
  }
  const edge = Math.min(1, t / 0.4, (total - t) / 0.5);
  if (edge < 1) {
    ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, edge)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function Thumb({ scene, index }: { scene: SceneCode; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const t = ((performance.now() - t0) / 1000) % 4;
      ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
      drawScene(ctx, scene, t, 4, index, 1, false);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [scene, index]);
  return <canvas ref={ref} width={135} height={240} className="h-full w-full rounded-lg bg-slate-200" />;
}

function Pick<T extends string>({ value, options, labels, onChange }: { value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]">
      {options.map((o) => (
        <option key={o} value={o}>
          {labels[o]}
        </option>
      ))}
    </select>
  );
}

export default function StoryVideoStudio({ canGenerate, onGenerated }: { canGenerate: boolean; onGenerated: () => void }) {
  const [description, setDescription] = useState("");
  const [scenes, setScenes] = useState<SceneCode[]>([]);
  const [per, setPer] = useState(4);
  const [music, setMusic] = useState(true);
  const [ambience, setAmbience] = useState(true);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "preview" | "recording">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState<{ blob: Blob; format: "mp4" | "webm" } | null>(null);
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const code = useMemo(() => (scenes.length ? encodeStory(scenes) : ""), [scenes]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopRef.current?.();
    },
    [],
  );

  function stopAll() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stopRef.current?.();
    stopRef.current = null;
    setPhase("idle");
  }

  function build() {
    if (!description.trim()) return;
    stopAll();
    setError("");
    setRecorded(null);
    setScenes(understand(description));
  }

  function recall() {
    const decoded = decodeStory(pasted);
    if (!decoded) {
      setError("الرمز غير صحيح. انسخه كاملاً كما هو (يبدأ بـ R1.)");
      return;
    }
    stopAll();
    setError("");
    setRecorded(null);
    setScenes(decoded);
  }

  function edit(i: number, patch: Partial<SceneCode>) {
    setScenes((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function editActor(i: number, patch: Partial<SceneCode["actors"][number]>) {
    setScenes((prev) => prev.map((s, j) => (j === i ? { ...s, actors: s.actors.map((a, k) => (k === 0 ? { ...a, ...patch } : a)) } : s)));
  }

  function removeScene(i: number) {
    setScenes((prev) => prev.filter((_, j) => j !== i));
  }

  function preview() {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !scenes.length) return;
    stopAll();
    setPhase("preview");
    const list = scenes;
    const total = list.length * per;
    const t0 = performance.now();
    const frame = () => {
      const t = ((performance.now() - t0) / 1000) % total;
      drawTimeline(ctx, list, per, t);
      rafRef.current = requestAnimationFrame(frame);
    };
    frame();
  }

  async function record() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const list = scenes;
    if (!canvas || !ctx || !list.length || !canGenerate) return;
    if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
      setError("متصفحك لا يدعم تسجيل الفيديو. جرّب متصفح Chrome الحديث.");
      return;
    }
    stopAll();
    setError("");
    setRecorded(null);
    setPhase("recording");
    setProgress(0);

    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    let perScene = per;
    if (audioFile) {
      try {
        const buf = await ac.decodeAudioData(await audioFile.arrayBuffer());
        const total = Math.min(Math.max(buf.duration, list.length * 2), 90);
        perScene = total / list.length;
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.connect(dest);
        src.start(ac.currentTime + 0.05);
        src.stop(ac.currentTime + 0.05 + total);
        scheduleSoundtrack(ac, dest, list, perScene, false, ambience);
      } catch {
        setError("تعذّرت قراءة الملف الصوتي — استُخدمت أصوات المحرك بدلاً منه.");
        scheduleSoundtrack(ac, dest, list, perScene, music, ambience);
      }
    } else {
      scheduleSoundtrack(ac, dest, list, perScene, music, ambience);
    }
    const total = list.length * perScene;

    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const { mimeType, format } = pickRecording();
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 5_000_000 });
    const chunks: Blob[] = [];
    let cancelled = false;
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      ac.close().catch(() => {});
      if (cancelled) return;
      setRecorded({ blob: new Blob(chunks, { type: rec.mimeType || (format === "mp4" ? "video/mp4" : "video/webm") }), format });
      setPhase("idle");
      onGenerated();
    };
    stopRef.current = () => {
      cancelled = true;
      if (rec.state !== "inactive") rec.stop();
    };

    const t0 = performance.now();
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) {
        stopRef.current = null;
        if (rec.state !== "inactive") rec.stop();
        return;
      }
      drawTimeline(ctx, list, perScene, t);
      setProgress(Math.round((t / total) * 100));
      rafRef.current = requestAnimationFrame(frame);
    };
    rec.start(1000);
    frame();
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is still selectable */
    }
  }

  const fileBase = safeFileBase(description || scenes[0]?.caption || "", "ttbik-video");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">1. اكتب ماذا يحدث في الفيديو</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={600}
            placeholder="مثال: قطط صغيرة تلعب في الحقل وتطارد الفراشة ثم تنام تحت الشجرة"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setDescription(ex)} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-200">
                {ex.split(" ").slice(0, 4).join(" ")}…
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-400">
            افصل المشاهد بـ «ثم» أو بنقطة. يفهم: قطة، كلب، أرنب، عصفور، فراشة، سمكة، طفل، شخص، سيارة، كرة · يلعب، يطارد، يمشي، يركض، يقفز، يطير، يسبح، ينام، يضحك، يأكل، يرقص، يجلس، ينظر · حقل، غابة، حديقة، بحر، نهر، صحراء، مدينة، بيت، جبل، فضاء · صباح، نهار، غروب، ليل · مطر، ثلج، رياح، غيوم · والألوان والأعداد.
          </p>
        </div>

        <button
          onClick={build}
          disabled={!description.trim() || phase === "recording"}
          className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:bg-slate-300"
        >
          {scenes.length ? "🔄 أعد تحويل الوصف إلى مشاهد" : "① حوّل الوصف إلى مشاهد متحركة"}
        </button>

        {scenes.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {scenes.map((s, i) => (
              <div key={i} className="flex flex-col gap-1 rounded-xl border border-slate-200 p-1.5">
                <div className="relative aspect-[9/16] overflow-hidden rounded-lg">
                  <Thumb scene={s} index={i} />
                  <span className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeScene(i)}
                    aria-label="حذف المشهد"
                    className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white"
                  >
                    ✕
                  </button>
                </div>
                <input value={s.caption} onChange={(e) => edit(i, { caption: e.target.value })} placeholder="نص المشهد" className="rounded border border-slate-200 px-1.5 py-1 text-[11px]" />
                <div className="grid grid-cols-2 gap-1">
                  <Pick value={s.actors[0].kind} options={ALL_KINDS} labels={KIND_LABEL} onChange={(v) => editActor(i, { kind: v })} />
                  <Pick value={s.actors[0].action} options={ALL_ACTIONS} labels={ACTION_LABEL} onChange={(v) => editActor(i, { action: v })} />
                  <Pick value={s.place} options={ALL_PLACES} labels={PLACE_LABEL} onChange={(v) => edit(i, { place: v })} />
                  <Pick value={s.time} options={ALL_TIMES} labels={TIME_LABEL} onChange={(v) => edit(i, { time: v })} />
                  <Pick value={s.weather} options={ALL_WEATHERS} labels={WEATHER_LABEL} onChange={(v) => edit(i, { weather: v })} />
                  <select
                    value={s.actors[0].count}
                    onChange={(e) => editActor(i, { count: Number(e.target.value) })}
                    className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        العدد {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        {scenes.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="text-xs font-semibold text-slate-600">
                ثوانٍ لكل مشهد
                <select value={per} onChange={(e) => setPer(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                  {[3, 4, 5, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-slate-600">
                <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} />
                موسيقى
              </label>
              <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-slate-600">
                <input type="checkbox" checked={ambience} onChange={(e) => setAmbience(e.target.checked)} />
                أصوات المكان
              </label>
              <label className="text-xs font-semibold text-slate-600">
                صوتك (اختياري)
                <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} className="mt-1 w-full text-[11px]" />
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={phase === "preview" ? stopAll : preview}
                disabled={phase === "recording"}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {phase === "preview" ? "⏹ إيقاف المعاينة" : "▶ معاينة"}
              </button>
              <button
                onClick={record}
                disabled={phase === "recording" || !canGenerate}
                className="flex-[2] rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300"
              >
                {phase === "recording"
                  ? `جاري إنشاء الفيديو... ${progress}%`
                  : !canGenerate
                    ? "انتهت محاولاتك المجانية — اطلب الوصول الكامل بالأسفل"
                    : recorded
                      ? "② إنشاء الفيديو من جديد"
                      : "② إنشاء الفيديو الآن"}
              </button>
            </div>
            {phase === "recording" && <p className="text-xs text-slate-500">يُسجَّل الفيديو الآن — أبقِ هذه الصفحة مفتوحة وظاهرة حتى ينتهي.</p>}
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className={`${phase === "idle" ? "hidden" : "flex"} justify-center rounded-xl bg-black p-2`}>
          <canvas ref={canvasRef} width={W} height={H} className="max-h-[480px] w-auto rounded-lg" />
        </div>

        {recorded && phase === "idle" && <VideoResult recorded={recorded} fileBase={fileBase} />}

        <div className="rounded-xl bg-slate-50 p-3">
          <p className="mb-1 text-xs font-bold text-slate-700">🔣 رمز الفيديو</p>
          {code ? (
            <div className="flex gap-2">
              <input readOnly value={code} onFocus={(e) => e.target.select()} dir="ltr" className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-600" />
              <button type="button" onClick={copyCode} className="shrink-0 rounded-lg bg-slate-800 px-3 text-xs font-bold text-white">
                {copied ? "✓ نُسخ" : "نسخ"}
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">بعد تحويل الوصف يظهر هنا رمز قصير يحفظ الفيديو كاملاً.</p>
          )}
          <div className="mt-2 flex gap-2">
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              dir="ltr"
              placeholder="لديك رمز؟ الصقه هنا (R1.…)"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[11px]"
            />
            <button type="button" onClick={recall} disabled={!pasted.trim()} className="shrink-0 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white disabled:bg-slate-300">
              استدعاء
            </button>
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs leading-5 text-slate-400">
        يعمل بمحرك «رموز» الخاص بسوق تولز: يفهم الوصف ويحوّله إلى رموز مشاهد، ثم يرسم كل كائن ويحرّكه بالكود، ويولّد الأصوات. كل شيء يحدث داخل متصفحك، بلا ذكاء اصطناعي خارجي ولا صور من أحد — والفيديو ملكك بالكامل.
      </p>
    </div>
  );
}
