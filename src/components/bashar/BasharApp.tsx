"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const logEnd = useRef<HTMLDivElement>(null);

  const absorb = useCallback((r: Api) => {
    if (typeof r.credits === "number") setCredits(r.credits);
    if (typeof r.online === "number") setOnline(r.online);
    if (typeof r.answered === "number") setAnsweredCount(r.answered);
  }, []);

  // initial state + restore my conversation
  useEffect(() => {
    setMine(loadMine());
    api("state").then(absorb);
  }, [absorb]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(mine.slice(-30)));
    } catch {
      // storage blocked — conversation lives for this visit only
    }
    logEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [mine]);

  // poll my recent questions (last 30 min) — shared ones keep collecting answers
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

  // answer-mode countdown
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
      setTask({ id: r.id as string, text: r.text as string, from: r.from as string, deadline: r.deadline as number });
    } else {
      setEmptyQueue(true);
    }
  }, [absorb]);

  // when the queue is empty, look again every 5s while in answer mode
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
      setNote("رصيدك انتهى. أجب عن سؤال شخص آخر لتكسب رصيداً فوراً — أو انتظر، يتجدد رصيد مجاني كل 10 دقائق.");
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
      if (!String(r.error || "").includes("ألفاظ") && !String(r.error || "").includes("مسموحة")) void nextTask();
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

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg">
      <div className="flex items-center justify-between gap-2 bg-gradient-to-l from-slate-900 to-indigo-900 px-4 py-3 text-white">
        <div>
          <p className="text-base font-extrabold">بَشَر</p>
          <p className="text-[11px] text-white/70">
            <span className="ml-1 inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" /> {online} إنسان متصل الآن
          </p>
        </div>
        <div className="text-left text-xs">
          <p>
            رصيدك: <strong className="text-base">{credits ?? "…"}</strong>
          </p>
          <p className="text-white/70">أجبت {answeredCount} سؤالاً</p>
        </div>
      </div>

      <div className="flex border-b border-slate-100 text-sm font-bold">
        <button
          type="button"
          onClick={() => setMode("ask")}
          className={`flex-1 py-2.5 ${mode === "ask" ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"}`}
        >
          💬 اسأل إنساناً
        </button>
        <button
          type="button"
          onClick={openAnswerMode}
          className={`flex-1 py-2.5 ${mode === "answer" ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"}`}
        >
          🧠 كن أنت «الذكاء» (+1 رصيد)
        </button>
      </div>

      {mode === "ask" ? (
        <div>
          <div className={`${compact ? "h-[300px]" : "h-[380px]"} space-y-3 overflow-y-auto bg-slate-50 p-4`}>
            {mine.length === 0 && (
              <div className="mt-10 text-center text-sm leading-7 text-slate-500">
                <p className="text-3xl">🧍‍♂️🧍‍♀️</p>
                <p className="mt-2 font-bold text-slate-700">هنا لا يجيبك ذكاء اصطناعي.</p>
                <p>سؤالك يذهب إلى إنسان حقيقي عشوائي، لديه {75} ثانية ليكتب جوابه — ثم تعرف من أي بلد هو.</p>
                <p className="mt-2 text-xs">اسأل أي شيء: نصيحة، رأي، نكتة، سؤال محرج…</p>
              </div>
            )}
            {mine.map((m) => (
              <div key={m.id} className="space-y-2">
                <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-indigo-600 px-3 py-2 text-sm leading-6 text-white">{m.text}</div>
                {m.answers && m.answers.length > 0 ? (
                  <div className="ml-auto max-w-[88%] space-y-1.5">
                    {m.answers.map((a) => (
                      <div key={a.id}>
                        <div className="rounded-2xl rounded-br-sm bg-white px-3 py-2 text-sm leading-6 text-slate-800 shadow-sm ring-1 ring-slate-200">
                          {a.text}
                        </div>
                        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                          — إنسان من {a.from}
                          <button type="button" onClick={() => void api("report_answer", { id: a.id })} className="text-slate-400">
                            إبلاغ
                          </button>
                        </p>
                      </div>
                    ))}
                  </div>
                ) : m.expired ? (
                  <p className="ml-auto max-w-[85%] text-xs text-slate-400">لم يتوفر إنسان في الوقت — أُعيد رصيدك. شارك سؤالك ليجيبك أصحابك.</p>
                ) : (
                  <div className="ml-auto max-w-[85%] rounded-2xl bg-white px-3 py-2 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
                    <span className="animate-pulse">إنسان حقيقي يفكّر…</span>
                  </div>
                )}
                {Date.now() - m.at < 30 * 60_000 && (
                  <div className="rounded-xl bg-indigo-50 p-2">
                    <p className="mb-1.5 text-[11px] font-bold text-indigo-800">📣 شارك سؤالك ليجيبك أصحابك أيضاً:</p>
                    <ShareButtons id={m.id} text={m.text} compact />
                  </div>
                )}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={openAnswerMode}
              className="w-full bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800"
            >
              ⏳ أثناء الانتظار: أجب أنت عن سؤال شخص آخر واكسب رصيداً ←
            </button>
          )}
          {note && <p className="bg-rose-50 px-4 py-2 text-xs font-bold text-rose-700">{note}</p>}
          <div className="flex gap-2 border-t border-slate-100 p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
              onKeyDown={(e) => e.key === "Enter" && void send()}
              placeholder="اسأل إنساناً أي شيء…"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={() => void send()}
              className="shrink-0 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              أرسل
            </button>
          </div>
        </div>
      ) : (
        <div className={`${compact ? "min-h-[340px]" : "min-h-[440px]"} bg-slate-50 p-4`}>
          {task ? (
            <div>
              <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                <span>سؤال من إنسان في {task.from}</span>
                <span className={`rounded-full px-2 py-0.5 font-mono font-bold ${left <= 15 ? "bg-rose-100 text-rose-700" : "bg-indigo-100 text-indigo-700"}`}>
                  {left} ث
                </span>
              </div>
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.min(100, (left / 75) * 100)}%` }} />
              </div>
              <p className="mb-4 rounded-2xl bg-white p-4 text-base font-bold leading-7 text-slate-900 shadow-sm ring-1 ring-slate-200">{task.text}</p>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value.slice(0, MAX_LEN))}
                rows={4}
                autoFocus
                placeholder="أنت الآن «الذكاء الاصطناعي»… اكتب جوابك"
                className="w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy || !reply.trim() || left === 0}
                  onClick={() => void submitAnswer()}
                  className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  أرسل الجواب
                </button>
                <button type="button" onClick={() => void skip()} className="rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-600">
                  تخطّ
                </button>
              </div>
              {left === 0 && (
                <button type="button" onClick={() => void nextTask()} className="mt-2 w-full text-xs font-bold text-indigo-700">
                  انتهى الوقت — سؤال آخر ←
                </button>
              )}
            </div>
          ) : emptyQueue ? (
            <div className="mt-16 text-center text-sm leading-7 text-slate-500">
              <p className="text-3xl">🕊️</p>
              <p className="font-bold text-slate-700">لا توجد أسئلة تنتظر الآن.</p>
              <p>نبحث كل 5 ثوانٍ… أو اسأل أنت وشارك الرابط مع أصدقائك ليجيبوا.</p>
            </div>
          ) : (
            <p className="mt-16 text-center text-sm text-slate-400">نبحث عن سؤال…</p>
          )}
          {note && <p className="mt-3 text-center text-xs font-bold text-emerald-700">{note}</p>}
        </div>
      )}
    </div>
  );
}
