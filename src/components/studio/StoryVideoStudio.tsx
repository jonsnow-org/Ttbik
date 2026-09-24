"use client";

import { useEffect, useRef, useState } from "react";
import VideoResult from "./VideoResult";
import { pickRecording, safeFileBase } from "./videoExport";
import {
  ACTION_LABEL,
  ALL_ACTIONS,
  ALL_PLACES,
  ALL_TIMES,
  ALL_WEATHERS,
  PLACE_LABEL,
  TIME_LABEL,
  WEATHER_LABEL,
  readWords,
  understand,
  type SceneCode,
  type WordRead,
} from "@/lib/motion/brain";
import { SYMBOL_COUNT, letterCode, symbolInfo } from "@/lib/motion/lexicon";
import { fetchPools, needOf, rankScenes, type Clip } from "@/lib/motion/match";
import { H, W, drawShot, freeMedia, loadMedia, syncPlayback, type Media } from "@/lib/motion/film";
import { scheduleSoundtrack } from "@/lib/motion/sound";

// «رموز» — description → words read letter by letter through the saved
// letter-code model (lexicon.ts) → scene codes (brain.ts) → weighted concept
// vectors matched against real footage (match.ts, footage store on our side,
// clips from Pexels) → played and recorded as one vertical video (film.ts).

const FADE = 0.6;

const EXAMPLES = [
  "قطة تلعب في الحديقة ثم تنام في البيت",
  "جمل يمشي في الصحراء عند الغروب",
  "طفل يركض على شاطئ البحر ثم يجلس وينظر إلى الأمواج",
  "مطر في المدينة ليلاً ثم شروق الشمس فوق الجبال",
];

const KIND_STYLE: Record<WordRead["kind"], string> = {
  actor: "bg-violet-100 text-violet-800",
  thing: "bg-sky-100 text-sky-800",
  action: "bg-amber-100 text-amber-800",
  place: "bg-emerald-100 text-emerald-800",
  time: "bg-indigo-100 text-indigo-800",
  weather: "bg-cyan-100 text-cyan-800",
  color: "bg-pink-100 text-pink-800",
  size: "bg-slate-100 text-slate-700",
  number: "bg-slate-100 text-slate-700",
  unknown: "bg-slate-50 text-slate-400 line-through",
};

/** How each word was read: its letters (with their codes) walked to a meaning. */
function LetterPanel({ words }: { words: WordRead[] }) {
  if (!words.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
      <p className="mb-1.5 text-[11px] font-bold text-slate-600">🔣 قراءة الحروف ← المعاني</p>
      <div className="flex flex-wrap gap-1.5">
        {words.map((w, i) => (
          <span key={i} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] ${KIND_STYLE[w.kind]}`}>
            <span className="font-bold">{w.word}</span>
            {w.path && (
              <span className="flex items-end gap-px" dir="rtl">
                {[...w.path].map((ch, k) => (
                  <span key={k} className="flex flex-col items-center rounded bg-white/70 px-0.5 leading-none">
                    <span className="text-[10px]">{ch}</span>
                    <span className="font-mono text-[8px] opacity-60">{letterCode(ch) || "·"}</span>
                  </span>
                ))}
              </span>
            )}
            {w.kind !== "unknown" && (
              <span className="opacity-80">
                = {w.kind === "thing" && w.sym !== undefined ? `${w.label} · ${symbolInfo(w.sym).en}` : w.label}
              </span>
            )}
            {w.fuzzy && <span title="تصحيح إملائي">~</span>}
          </span>
        ))}
      </div>
    </div>
  );
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

type Shot = { ranked: Clip[]; pick: number; media: Media | null; loading: boolean };

export default function StoryVideoStudio({ canGenerate, onGenerated }: { canGenerate: boolean; onGenerated: () => void }) {
  const [description, setDescription] = useState("");
  const [words, setWords] = useState<WordRead[]>([]);
  const [scenes, setScenes] = useState<SceneCode[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [per, setPer] = useState(4);
  const [music, setMusic] = useState(true);
  const [ambience, setAmbience] = useState(true);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "searching" | "preview" | "recording">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState<{ blob: Blob; format: "mp4" | "webm" } | null>(null);
  const [store, setStore] = useState<{ queries: number; clips: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const shotsRef = useRef<Shot[]>([]);
  shotsRef.current = shots;

  function refreshStore() {
    fetch("/api/tools/clips")
      .then((r) => r.json())
      .then((d) => setStore({ queries: d.queries || 0, clips: d.clips || 0 }))
      .catch(() => {});
  }

  useEffect(() => {
    refreshStore();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopRef.current?.();
      shotsRef.current.forEach((s) => freeMedia(s.media));
    };
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setWords(description.trim() ? readWords(description) : []), 200);
    return () => clearTimeout(id);
  }, [description]);

  function stopAll() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stopRef.current?.();
    stopRef.current = null;
    syncPlayback(
      shotsRef.current.map((s) => s.media),
      [],
    );
    setPhase("idle");
  }

  async function loadShot(i: number, ranked: Clip[], pick: number) {
    setShots((prev) => prev.map((s, j) => (j === i ? { ...s, ranked, loading: true } : s)));
    // try the picked clip, then the next best ones if a file fails to load
    for (let k = pick; k < Math.min(ranked.length, pick + 3); k++) {
      const media = await loadMedia(ranked[k]);
      if (media) {
        setShots((prev) =>
          prev.map((s, j) => {
            if (j !== i) return s;
            freeMedia(s.media);
            return { ranked, pick: k, media, loading: false };
          }),
        );
        return;
      }
    }
    setShots((prev) => prev.map((s, j) => (j === i ? { ...s, loading: false } : s)));
  }

  async function search(next: SceneCode[]) {
    setPhase("searching");
    setError("");
    const { pools, error: err } = await fetchPools(next);
    if (err) {
      setError(
        err === "no_key"
          ? "الأداة تحتاج مفتاح مكتبة الفيديو المجاني (Pexels) — صاحبة الموقع تضيفه مرة واحدة."
          : err === "unavailable"
            ? "تعذّر الوصول لمخزن المقاطع. أعد المحاولة."
            : err,
      );
      setPhase("idle");
      return;
    }
    const ranked = rankScenes(next, pools, per);
    shotsRef.current.forEach((s) => freeMedia(s.media));
    setShots(ranked.map((r) => ({ ranked: r, pick: 0, media: null, loading: r.length > 0 })));
    await Promise.all(ranked.map((r, i) => (r.length ? loadShot(i, r, 0) : null)));
    if (ranked.some((r) => !r.length)) setError("بعض المشاهد لم يُعثر لها على مقطع — جرّب كلمات أوضح لها.");
    setPhase("idle");
    refreshStore();
  }

  async function build() {
    if (!description.trim()) return;
    stopAll();
    setRecorded(null);
    const next = understand(description);
    setScenes(next);
    await search(next);
  }

  function edit(i: number, patch: Partial<SceneCode>) {
    setScenes((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function editAction(i: number, action: SceneCode["actors"][number]["action"]) {
    setScenes((prev) => prev.map((s, j) => (j === i ? { ...s, actors: s.actors.map((a, k) => (k === 0 ? { ...a, action } : a)) } : s)));
  }

  async function research(i: number) {
    const { pools } = await fetchPools([scenes[i]]);
    const [ranked] = rankScenes([scenes[i]], pools, per);
    if (ranked?.length) await loadShot(i, ranked, 0);
  }

  function another(i: number) {
    const s = shots[i];
    if (!s || s.ranked.length < 2) return;
    void loadShot(i, s.ranked, (s.pick + 1) % s.ranked.length);
  }

  function removeScene(i: number) {
    freeMedia(shots[i]?.media);
    setScenes((prev) => prev.filter((_, j) => j !== i));
    setShots((prev) => prev.filter((_, j) => j !== i));
  }

  function frame(ctx: CanvasRenderingContext2D, perScene: number, t: number) {
    const list = shotsRef.current;
    const total = list.length * perScene;
    const i = Math.min(list.length - 1, Math.floor(t / perScene));
    const local = t - i * perScene;
    const fadeLen = Math.min(FADE, perScene / 3);
    const fading = i < list.length - 1 && local > perScene - fadeLen;
    syncPlayback(
      list.map((s) => s.media),
      fading ? [i, i + 1] : [i],
    );
    ctx.clearRect(0, 0, W, H);
    drawShot(ctx, list[i].media, scenes[i]?.caption || "", local, perScene, i, 1);
    if (fading) drawShot(ctx, list[i + 1].media, scenes[i + 1]?.caption || "", 0, perScene, i + 1, (local - (perScene - fadeLen)) / fadeLen);
    const edge = Math.min(1, t / 0.4, (total - t) / 0.5);
    if (edge < 1) {
      ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, edge)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function preview() {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !shots.length) return;
    stopAll();
    setPhase("preview");
    const total = shots.length * per;
    const t0 = performance.now();
    let lastLoop = -1;
    const tick = () => {
      const elapsed = (performance.now() - t0) / 1000;
      const loop = Math.floor(elapsed / total);
      if (loop !== lastLoop) {
        syncPlayback(
          shotsRef.current.map((s) => s.media),
          [],
        );
        lastLoop = loop;
      }
      frame(ctx, per, elapsed % total);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  async function record() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !shots.length || !canGenerate) return;
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
        const total = Math.min(Math.max(buf.duration, shots.length * 2), 90);
        perScene = total / shots.length;
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.connect(dest);
        src.start(ac.currentTime + 0.05);
        src.stop(ac.currentTime + 0.05 + total);
        scheduleSoundtrack(ac, dest, scenes, perScene, false, ambience);
      } catch {
        setError("تعذّرت قراءة الملف الصوتي — استُخدمت الموسيقى التلقائية بدلاً منه.");
        scheduleSoundtrack(ac, dest, scenes, perScene, music, ambience);
      }
    } else {
      scheduleSoundtrack(ac, dest, scenes, perScene, music, ambience);
    }
    const total = shots.length * perScene;

    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const { mimeType, format } = pickRecording();
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 5_000_000 });
    const chunks: Blob[] = [];
    let cancelled = false;
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      ac.close().catch(() => {});
      syncPlayback(
        shotsRef.current.map((s) => s.media),
        [],
      );
      if (cancelled) return;
      setRecorded({ blob: new Blob(chunks, { type: rec.mimeType || (format === "mp4" ? "video/mp4" : "video/webm") }), format });
      setPhase("idle");
      onGenerated();
    };
    stopRef.current = () => {
      cancelled = true;
      if (rec.state !== "inactive") rec.stop();
    };

    syncPlayback(
      shotsRef.current.map((s) => s.media),
      [],
    );
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) {
        stopRef.current = null;
        if (rec.state !== "inactive") rec.stop();
        return;
      }
      frame(ctx, perScene, t);
      setProgress(Math.round((t / total) * 100));
      rafRef.current = requestAnimationFrame(tick);
    };
    rec.start(1000);
    tick();
  }

  const busy = phase === "searching" || phase === "recording";
  const ready = shots.length > 0 && shots.some((s) => s.media) && !shots.some((s) => s.loading);
  const fileBase = safeFileBase(description || scenes[0]?.caption || "", "ttbik-video");
  const credits = shots.map((s) => s.media?.clip).filter((c): c is Clip => !!c);

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
            placeholder="مثال: جمل يمشي في الصحراء عند الغروب ثم مطر في المدينة ليلاً"
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
            افصل المشاهد بـ «ثم» أو بنقطة. العقل يعرف {SYMBOL_COUNT} معنى وآلاف الكلمات العربية
            {store && store.clips > 0 ? ` · مخزن المقاطع الحقيقية: ${store.clips} مقطعاً لـ ${store.queries} معنى، ويكبر مع كل استخدام` : ""}.
          </p>
        </div>

        <LetterPanel words={words} />

        <button
          onClick={build}
          disabled={!description.trim() || busy}
          className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:bg-slate-300"
        >
          {phase === "searching" ? "جاري استدعاء المقاطع الحقيقية..." : scenes.length ? "🔄 أعد تحويل الوصف إلى مشاهد" : "① حوّل الوصف إلى مشاهد حقيقية"}
        </button>

        {scenes.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {scenes.map((s, i) => {
              const shot = shots[i];
              const clip = shot?.media?.clip;
              const query = needOf(s).queries[0];
              return (
                <div key={i} className="flex flex-col gap-1 rounded-xl border border-slate-200 p-1.5">
                  <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-slate-200">
                    {clip ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={clip.poster} alt={clip.words} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center p-2 text-center text-[11px] text-slate-500">
                        {shot?.loading || phase === "searching" ? "جاري الاستدعاء..." : "لا يوجد مقطع"}
                      </div>
                    )}
                    <span className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                    {clip && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[9px] text-white">{clip.kind === "video" ? "🎬 فيديو" : "📷 صورة"}</span>}
                    <button type="button" onClick={() => removeScene(i)} aria-label="حذف المشهد" className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">
                      ✕
                    </button>
                  </div>
                  <p className="truncate text-[10px] text-slate-400" dir="ltr" title={query}>
                    {query}
                  </p>
                  <input value={s.caption} onChange={(e) => edit(i, { caption: e.target.value })} placeholder="نص المشهد" className="rounded border border-slate-200 px-1.5 py-1 text-[11px]" />
                  <div className="grid grid-cols-2 gap-1">
                    {s.actors[0] ? (
                      <Pick value={s.actors[0].action} options={ALL_ACTIONS} labels={ACTION_LABEL} onChange={(v) => editAction(i, v)} />
                    ) : (
                      <span className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[11px] text-slate-500">مشهد مكان</span>
                    )}
                    <Pick value={s.place} options={ALL_PLACES} labels={PLACE_LABEL} onChange={(v) => edit(i, { place: v })} />
                    <Pick value={s.time} options={ALL_TIMES} labels={TIME_LABEL} onChange={(v) => edit(i, { time: v })} />
                    <Pick value={s.weather} options={ALL_WEATHERS} labels={WEATHER_LABEL} onChange={(v) => edit(i, { weather: v })} />
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      disabled={busy || !shot || shot.ranked.length < 2}
                      onClick={() => another(i)}
                      className="rounded bg-slate-100 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                    >
                      🔄 مقطع آخر
                    </button>
                    <button type="button" disabled={busy} onClick={() => void research(i)} className="rounded bg-slate-100 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-40">
                      🔎 ابحث مجدداً
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {ready && (
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
                disabled={busy}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {phase === "preview" ? "⏹ إيقاف المعاينة" : "▶ معاينة"}
              </button>
              <button
                onClick={record}
                disabled={busy || !canGenerate}
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

        <div className={`${phase === "preview" || phase === "recording" ? "flex" : "hidden"} justify-center rounded-xl bg-black p-2`}>
          <canvas ref={canvasRef} width={W} height={H} className="max-h-[480px] w-auto rounded-lg" />
        </div>

        {recorded && phase === "idle" && <VideoResult recorded={recorded} fileBase={fileBase} />}

        {credits.length > 0 && (
          <p className="text-[11px] leading-5 text-slate-500">
            المقاطع من{" "}
            <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" className="font-bold underline">
              Pexels
            </a>
            {" — تصوير: "}
            {credits.map((c, k) => (
              <span key={`${c.id}-${k}`}>
                {k > 0 && "، "}
                <a href={c.page} target="_blank" rel="noopener noreferrer" className="underline">
                  {c.author || "Pexels"}
                </a>
              </span>
            ))}
          </p>
        )}
      </div>

      <p className="mt-6 text-xs leading-5 text-slate-400">
        يعمل بمحرك «رموز» الخاص بسوق تولز: يقرأ كل كلمة حرفاً حرفاً عبر نموذج رموز محفوظ، ويجمع المعاني في مشاهد، ثم يختار لكل مشهد أنسب مقطع حقيقي بمعادلة تشابه موزونة من مخزن مقاطع يكبر مع
        الاستخدام، ويركّبها فيديو واحداً داخل متصفحك.{" "}
        <a href="/rumooz/LICENSES.txt" className="underline">
          التراخيص
        </a>
      </p>
    </div>
  );
}
