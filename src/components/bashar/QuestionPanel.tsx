"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ShareButtons from "./ShareButtons";
import { ANSWER_SECONDS, MAX_LEN, api, type Ans } from "./client";

type View = { id: string; text: string; from: string; mine: boolean; answers: Ans[] };

/** One shared question: answer it within 75 seconds, then see everyone's answers. */
export default function QuestionPanel({ id }: { id: string }) {
  const [view, setView] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [reply, setReply] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [deadline] = useState(() => Date.now() + ANSWER_SECONDS * 1000);
  const [left, setLeft] = useState(ANSWER_SECONDS);

  const load = useCallback(async () => {
    const r = await api("view", { id });
    if (r.error) setMissing(true);
    else setView(r as unknown as View);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // keep the answers list live once the person has answered (or it's their own)
  useEffect(() => {
    if (!(done || view?.mine)) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [done, view?.mine, load]);

  useEffect(() => {
    if (done || view?.mine) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, [deadline, done, view?.mine]);

  async function send() {
    if (!reply.trim() || busy) return;
    setBusy(true);
    setErr("");
    const r = await api("reply", { id, text: reply });
    setBusy(false);
    if (r.ok) {
      setDone(true);
      void load();
    } else setErr(r.error || "تعذّر الإرسال");
  }

  if (missing) {
    return (
      <div className="p-6 text-center text-sm text-slate-600">
        <p className="mb-3">هذا السؤال لم يعد متاحاً.</p>
        <Link href="/bashar" className="inline-block rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white">
          اسأل أنت سؤالاً ←
        </Link>
      </div>
    );
  }
  if (!view) return <p className="p-8 text-center text-sm text-slate-400">جارٍ فتح السؤال…</p>;

  // The 75 s countdown is only a nudge: the answer box never disappears.
  const showAnswers = done || view.mine;

  return (
    <div className="p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
        <span>سؤال من إنسان في {view.from}</span>
        {!showAnswers && (
          <span className={`rounded-full px-2 py-0.5 font-mono font-bold ${left <= 15 ? "bg-rose-100 text-rose-700" : "bg-indigo-100 text-indigo-700"}`}>
            {left} ث
          </span>
        )}
      </div>
      {!showAnswers && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(left / ANSWER_SECONDS) * 100}%` }} />
        </div>
      )}
      <p className="mb-3 rounded-2xl bg-white p-4 text-base font-bold leading-7 text-slate-900 shadow-sm ring-1 ring-slate-200">{view.text}</p>

      {!showAnswers ? (
        <>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value.slice(0, MAX_LEN))}
            rows={3}
            placeholder="اكتب جوابك قبل انتهاء الوقت…"
            className="w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-indigo-500 focus:outline-none"
          />
          {left === 0 && <p className="mt-1 text-xs text-slate-500">انتهى العدّاد — لكن ما زال بإمكانك الإجابة.</p>}
          {err && <p className="mt-1 text-xs font-bold text-rose-700">{err}</p>}
          <button
            type="button"
            disabled={busy || !reply.trim()}
            onClick={() => void send()}
            className="mt-2 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            أرسل جوابي
          </button>
        </>
      ) : (
        <>
          {done && <p className="mb-2 text-center text-xs font-bold text-emerald-700">✅ وصل جوابك — هذه إجابات البشر:</p>}
          {view.mine && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900">
              <p className="font-extrabold">هذا سؤالك أنت، لذلك لا تظهر لك خانة الجواب.</p>
              <p>
                أرسل الرابط لغيرك: من يفتحه على هاتفه يظهر له السؤال مع خانة الجواب وعدّاد 75 ثانية، وتصلك إجاباتهم هنا وفي صفحة
                «بَشَر» فوراً.
              </p>
              <p className="mt-1 text-amber-800/80">لتجرّب بنفسك كيف يراه غيرك: افتح الرابط في نافذة تصفح خاصة أو متصفح آخر.</p>
            </div>
          )}
          <ul className="space-y-2">
            {view.answers.length === 0 && <li className="text-center text-xs text-slate-400">لا إجابات بعد…</li>}
            {view.answers.map((a) => (
              <li key={a.id} className="rounded-xl bg-white px-3 py-2 text-sm leading-6 shadow-sm ring-1 ring-slate-200">
                {a.text}
                <span className="mt-0.5 flex justify-between text-[10px] text-slate-500">
                  <span>— {a.from}</span>
                  <button type="button" onClick={() => void api("report_answer", { id: a.id })} className="text-slate-400">
                    إبلاغ
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-xl bg-slate-100 p-3">
            <p className="mb-2 text-xs font-bold text-slate-700">وسّع الدائرة — شارك هذا السؤال:</p>
            <ShareButtons id={view.id} text={view.text} compact />
          </div>
          <Link href="/bashar" className="mt-3 block w-full rounded-xl bg-slate-900 py-2.5 text-center text-sm font-bold text-white">
            💬 اسأل أنت سؤالك الآن ←
          </Link>
        </>
      )}
    </div>
  );
}
