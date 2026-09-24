"use client";

import { useCallback, useEffect, useState } from "react";
import ShareButtons from "./ShareButtons";
import { MAX_LEN, api, type Ans, type Api } from "./client";

type Mine = { id: string; text: string; answers?: Ans[]; expired?: boolean; at: number };
type Task = { id: string; text: string; from: string; deadline: number };

const STORE = "bashar_mine_v2";

function loadMine(): Mine[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "[]") as Mine[];
  } catch {
    return [];
  }
}

export default function BasharApp({ compact = false }: { compact?: boolean }) {
  const [credits, setCredits] = useState<number | null>(null);
  const [online, setOnline] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [mine, setMine] = useState<Mine[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"ask" | "answer">("ask");
  const [task, setTask] = useState<Task | null>(null);
  const [reply, setReply] = useState("");
  const [left, setLeft] = useState(0);
  const [emptyQueue, setEmptyQueue] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const absorb = useCallback((r: Api) => {
    if (typeof r.credits === "number") setCredits(r.credits);
    if (typeof r.online === "number") setOnline(r.online);
    if (typeof r.answered === "number") setAnsweredCount(r.answered);
  }, []);

  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setMine(loadMine());
    setLoaded(true);
    api("state").then(absorb);
  }, [absorb]);

  // No programmatic scrolling anywhere: the page scrolls only under the user's finger.
  // Saving waits for the first load so the empty initial state never overwrites it.
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORE, JSON.stringify(mine.slice(-30)));
    } catch {
      /* storage blocked */
    }
  }, [mine, loaded]);

  // Poll my recent questions (live answers) — does NOT trigger scroll
  const liveIds = mine
    .filter((m) => !m.expired && Date.now() - m.at < 30 * 60_000)
    .map((m) => m.id)
    .join(",");

  useEffect(() => {
    if (!liveIds) return;
    const ids = liveIds.split(",");
    const t = setInterval(async () => {
      for (const qid of ids) {
        const r = await api("poll", { id: qid });
        absorb(r);
        setMine((all) =>
          all.map((m) =>
            m.id !== qid
              ? m
              : r.error === "not_found"
                ? { ...m, expired: true }
                : { ...m, answers: (r.answers as Ans[]) ?? m.answers, expired: !!r.expired },
          ),
        );
      }
    }, 4000);
    return () => clearInterval(t);
  }, [liveIds, absorb]);

  // Answer mode countdown
  useEffect(() => {
    if (!task) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((task.deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [task]);

  const nextTask = useCallback(async () => {
    setReply("");
    setTask(null);
    const r = await api("claim");
    absorb(r);
    if (r.id) {
      setEmptyQueue(false);
      setTask({
        id: r.id as string,
        text: r.text as string,
        from: r.from as string,
        deadline: r.deadline as number,
      });
    } else {
      setEmptyQueue(true);
    }
  }, [absorb]);

  // When queue is empty, retry every 5s
  useEffect(() => {
    if (mode !== "answer" || !emptyQueue) return;
    const id = setTimeout(() => void nextTask(), 5000);
    return () => clearTimeout(id);
  }, [mode, emptyQueue, nextTask]);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setNote("");
    const r = await api("ask", { text });
    absorb(r);
    setBusy(false);
    if (r.id) {
      setMine((all) => [...all, { id: r.id as string, text: text.trim(), at: Date.now() }]);
      setText("");
    } else if (r.error === "no_credits") {
      setNote("رصيدك انتهى — أجب عن سؤال غيرك لتكسب رصيداً فوراً، أو انتظر 10 دقائق.");
    } else if (r.error) {
      setNote(r.error);
    }
  }

  async function submitAnswer() {
    if (!task || !reply.trim() || busy) return;
    setBusy(true);
    const r = await api("answer", { id: task.id, text: reply });
    absorb(r);
    setBusy(false);
    if (r.ok) {
      setNote("✅ وصل جوابك! +1 رصيد");
      void nextTask();
    } else {
      setNote(r.error || "تعذّر الإرسال");
      if (!String(r.error || "").includes("ألفاظ") && !String(r.error || "").includes("مسموحة")) {
        void nextTask();
      }
    }
  }

  async function skip() {
    if (task) await api("skip", { id: task.id });
    void nextTask();
  }

  function openAnswerMode() {
    setMode("answer");
    setNote("");
    void nextTask();
  }

  const pendingCount = mine.filter((m) => !m.answers?.length && !m.expired).length;
  const VISIBLE = 4;
  const hiddenCount = showAll ? 0 : Math.max(0, mine.length - VISIBLE);
  const shown = mine.slice(hiddenCount);

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg">

      {/* Header */}
      <div className="flex items-center justify-between gap-2 bg-gradient-to-l from-slate-900 to-indigo-900 px-4 py-3 text-white">
        <div>
          <p className="text-base font-extrabold">💬 بَشَر</p>
          <p className="text-[11px] text-white/70">
            <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" />
            {online} إنسان متصل الآن
          </p>
        </div>
        <div className="text-left text-xs">
          <p className="text-white/80">رصيدك</p>
          <p className="text-2xl font-extrabold leading-none">{credits ?? "…"}</p>
          {answeredCount > 0 && <p className="text-[10px] text-white/60">أجبت {answeredCount}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 text-sm font-bold">
        <button
          type="button"
          onClick={() => { setMode("ask"); setNote(""); }}
          className={`flex-1 py-2.5 transition ${mode === "ask" ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-700"}`}
        >
          💬 اسأل إنساناً
        </button>
        <button
          type="button"
          onClick={openAnswerMode}
          className={`flex-1 py-2.5 transition ${mode === "answer" ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-700"}`}
        >
          🧠 أجب واكسب رصيداً
        </button>
      </div>

      {/* ── ASK MODE ── */}
      {mode === "ask" && (
        <div>
          {/* Chat log — grows with the page (no inner scroll box, so page swipes always work) */}
          <div className="bg-slate-50 p-4">
            {mine.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-slate-500">
                <span className="text-4xl">💬</span>
                <p className="font-bold text-slate-700">هنا لا يجيبك ذكاء اصطناعي</p>
                <p className="max-w-xs leading-6">
                  سؤالك يذهب لإنسان حقيقي عشوائي — لديه 75 ثانية يكتب جوابه، ثم تعرف من أي بلد هو.
                </p>
                <p className="text-xs text-slate-400">اسأل أي شيء: نصيحة، رأي، نكتة، سؤال محرج…</p>
              </div>
            ) : (
              <div className="space-y-4">
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="w-full rounded-xl bg-white py-2 text-xs font-bold text-slate-500 ring-1 ring-slate-200"
                  >
                    عرض {hiddenCount} أسئلة أقدم
                  </button>
                )}
                {shown.map((m) => (
                  <div key={m.id} className="space-y-2">
                    {/* Question bubble (right) */}
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-indigo-600 px-4 py-2.5 text-sm leading-6 text-white shadow-sm">
                        {m.text}
                      </div>
                    </div>

                    {/* Answer state */}
                    {m.answers && m.answers.length > 0 ? (
                      <div className="space-y-2">
                        {m.answers.map((a) => (
                          <div key={a.id} className="flex justify-start">
                            <div className="max-w-[85%]">
                              <div className="rounded-2xl rounded-br-sm bg-white px-4 py-2.5 text-sm leading-6 text-slate-800 shadow-sm ring-1 ring-slate-200">
                                {a.text}
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                                <span>— إنسان من {a.from}</span>
                                <button
                                  type="button"
                                  onClick={() => void api("report_answer", { id: a.id })}
                                  className="text-slate-300 hover:text-rose-500"
                                  title="إبلاغ"
                                >
                                  ⚑
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : m.expired ? (
                      <div className="flex justify-start">
                        <p className="max-w-[85%] rounded-2xl bg-slate-100 px-4 py-2.5 text-xs leading-6 text-slate-500">
                          لم يتوفر إنسان في الوقت — أُعيد رصيدك تلقائياً.
                        </p>
                      </div>
                    ) : (
                      <div className="flex justify-start">
                        <div className="max-w-[85%] rounded-2xl bg-white px-4 py-2.5 text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">
                          <span className="animate-pulse">إنسان حقيقي يفكّر…</span>
                        </div>
                      </div>
                    )}

                    {/* Share row (only for recent, unanswered questions) */}
                    {Date.now() - m.at < 30 * 60_000 && (!m.answers || m.answers.length === 0) && !m.expired && (
                      <div className="rounded-xl bg-indigo-50 p-2.5">
                        <p className="mb-1.5 text-[11px] font-bold text-indigo-800">📣 شارك ليجيبك أصحابك أيضاً:</p>
                        <ShareButtons id={m.id} text={m.text} compact />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Earn credits nudge while waiting */}
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={openAnswerMode}
              className="w-full bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
            >
              ⏳ أثناء الانتظار — أجب أنت واكسب رصيداً ←
            </button>
          )}

          {note && (
            <p className="bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{note}</p>
          )}

          {/* Input row */}
          <div className="flex gap-2 border-t border-slate-100 p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
              onKeyDown={(e) => e.key === "Enter" && void send()}
              placeholder="اسأل إنساناً أي شيء…"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={() => void send()}
              className="shrink-0 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "…" : "أرسل"}
            </button>
          </div>
        </div>
      )}

      {/* ── ANSWER MODE ── */}
      {mode === "answer" && (
        <div className={`${compact ? "min-h-[320px]" : "min-h-[420px]"} bg-slate-50 p-4`}>
          {task ? (
            <div className="space-y-3">
              {/* Sender info + timer */}
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>سؤال من إنسان في <strong className="text-slate-700">{task.from}</strong></span>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono font-bold tabular-nums ${
                    left <= 15 ? "bg-rose-100 text-rose-700" : "bg-indigo-100 text-indigo-700"
                  }`}
                >
                  {left} ث
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full transition-all ${left <= 15 ? "bg-rose-500" : "bg-indigo-500"}`}
                  style={{ width: `${Math.min(100, (left / 75) * 100)}%` }}
                />
              </div>

              {/* Question */}
              <p className="rounded-2xl bg-white px-4 py-3.5 text-base font-bold leading-7 text-slate-900 shadow-sm ring-1 ring-slate-200">
                {task.text}
              </p>

              {/* Answer textarea — no autoFocus (causes mobile scroll jump) */}
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value.slice(0, MAX_LEN))}
                rows={4}
                placeholder="اكتب جوابك كإنسان حقيقي…"
                className="w-full rounded-xl border border-slate-300 p-3 text-sm leading-6 focus:border-indigo-500 focus:outline-none"
              />

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !reply.trim() || left === 0}
                  onClick={() => void submitAnswer()}
                  className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                >
                  {busy ? "جارٍ الإرسال…" : "أرسل جوابي (+1 رصيد)"}
                </button>
                <button
                  type="button"
                  onClick={() => void skip()}
                  className="rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  تخطّ
                </button>
              </div>

              {left === 0 && (
                <button
                  type="button"
                  onClick={() => void nextTask()}
                  className="w-full text-center text-xs font-bold text-indigo-700"
                >
                  انتهى الوقت — سؤال آخر ←
                </button>
              )}
            </div>
          ) : emptyQueue ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
              <span className="text-4xl">🕊️</span>
              <p className="font-bold text-slate-700">لا توجد أسئلة تنتظر الآن</p>
              <p className="text-xs leading-6">نبحث كل 5 ثوانٍ…<br />أو اسأل أنت وشارك الرابط مع أصدقائك.</p>
              <button
                type="button"
                onClick={() => { setMode("ask"); setNote(""); }}
                className="mt-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white"
              >
                اسأل أنت ←
              </button>
            </div>
          ) : (
            <div className="flex h-full min-h-[200px] items-center justify-center">
              <p className="text-sm text-slate-400">جارٍ البحث عن سؤال…</p>
            </div>
          )}

          {note && (
            <p className={`mt-3 text-center text-xs font-bold ${note.startsWith("✅") ? "text-emerald-700" : "text-rose-700"}`}>
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
