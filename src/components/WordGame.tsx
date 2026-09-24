"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MAX_GUESSES,
  WORD_LEN,
  isValidGuess,
  normalizeLetter,
  scoreGuess,
  shareText,
  type LetterState,
} from "@/lib/wordGame";

const ROW1 = "ضصثقفغعهخحج".split("");
const ROW2 = "شسيبلاتنمك".split("");
const ROW3 = "ظطذدزرو".split("");
const EXTRA = ["ى", "ة", "ء", "ؤ", "ئ"];

const STATS_KEY = "kalimat_stats_v1";
type Stats = { played: number; won: number; streak: number; maxStreak: number; lastDay: number };
type Saved = { day: number; guesses: string[]; done: boolean; won: boolean };
const GAME_KEY = "kalimat_game_v1";

function loadStats(): Stats {
  try {
    return { played: 0, won: 0, streak: 0, maxStreak: 0, lastDay: -1, ...JSON.parse(localStorage.getItem(STATS_KEY) || "{}") };
  } catch {
    return { played: 0, won: 0, streak: 0, maxStreak: 0, lastDay: -1 };
  }
}
function loadSaved(day: number): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(GAME_KEY) || "null") as Saved | null;
    return s && s.day === day ? s : null;
  } catch {
    return null;
  }
}

const CELL_STYLE: Record<LetterState, string> = {
  correct: "bg-emerald-500 border-emerald-500 text-white",
  present: "bg-amber-400 border-amber-400 text-white",
  absent: "bg-slate-400 border-slate-400 text-white",
};
const KEY_STYLE: Record<LetterState | "unused", string> = {
  correct: "bg-emerald-500 text-white",
  present: "bg-amber-400 text-white",
  absent: "bg-slate-300 text-slate-500",
  unused: "bg-slate-100 text-slate-800 hover:bg-slate-200",
};

export default function WordGame({ answer, dayIndex, siteUrl }: { answer: string; dayIndex: number; siteUrl: string }) {
  const [guesses, setGuesses] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [done, setDone] = useState(false);
  const [won, setWon] = useState(false);
  const [shake, setShake] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = loadSaved(dayIndex);
    if (saved) {
      setGuesses(saved.guesses);
      setDone(saved.done);
      setWon(saved.won);
    }
    setStats(loadStats());
    setReady(true);
  }, [dayIndex]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify({ day: dayIndex, guesses, done, won } satisfies Saved));
    } catch {
      /* not persisted — game still works this visit */
    }
  }, [ready, dayIndex, guesses, done, won]);

  const rows = useMemo(() => guesses.map((g) => scoreGuess(g, answer)), [guesses, answer]);

  const keyState = useMemo(() => {
    const map = new Map<string, LetterState>();
    const rank: Record<LetterState, number> = { absent: 0, present: 1, correct: 2 };
    guesses.forEach((g, i) => {
      [...g].forEach((ch, j) => {
        const n = normalizeLetter(ch);
        const s = rows[i][j];
        if (!map.has(n) || rank[s] > rank[map.get(n)!]) map.set(n, s);
      });
    });
    return map;
  }, [guesses, rows]);

  function finish(nextGuesses: string[], isWin: boolean) {
    setDone(true);
    setWon(isWin);
    setStats((prev) => {
      const s = prev ?? loadStats();
      if (s.lastDay === dayIndex) return s; // already recorded today (e.g. state restored)
      const streak = isWin ? s.streak + 1 : 0;
      const next: Stats = { played: s.played + 1, won: s.won + (isWin ? 1 : 0), streak, maxStreak: Math.max(s.maxStreak, streak), lastDay: dayIndex };
      try {
        localStorage.setItem(STATS_KEY, JSON.stringify(next));
      } catch {
        /* stats not saved this visit */
      }
      return next;
    });
  }

  function submit() {
    if (done) return;
    if (current.length !== WORD_LEN) {
      setError(`الكلمة ${WORD_LEN} أحرف`);
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    if (!isValidGuess(current)) {
      setError("أحرف عربية فقط");
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    setError("");
    const next = [...guesses, current];
    setGuesses(next);
    setCurrent("");
    const isWin = [...current].every((ch, i) => normalizeLetter(ch) === normalizeLetter(answer[i]));
    if (isWin) finish(next, true);
    else if (next.length >= MAX_GUESSES) finish(next, false);
  }

  function press(ch: string) {
    if (done) return;
    setError("");
    setCurrent((c) => (c.length < WORD_LEN ? c + ch : c));
  }
  function backspace() {
    if (done) return;
    setCurrent((c) => c.slice(0, -1));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") submit();
      else if (e.key === "Backspace") backspace();
      else if (/^[ء-ي]$/.test(e.key)) press(e.key);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, done, guesses]);

  async function share() {
    const text = shareText(dayIndex, rows, won, siteUrl);
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* user cancelled share/clipboard — no error needed */
    }
  }

  const filledRows = [...rows];
  const displayRows: (string | null)[][] = [];
  for (let i = 0; i < MAX_GUESSES; i++) {
    if (i < guesses.length) displayRows.push([...guesses[i]]);
    else if (i === guesses.length) displayRows.push(Array.from({ length: WORD_LEN }, (_, j) => current[j] ?? null));
    else displayRows.push(Array(WORD_LEN).fill(null));
  }

  return (
    <div className="flex flex-col items-center gap-4" dir="rtl">
      <div className="flex flex-col gap-1.5">
        {displayRows.map((row, i) => (
          <div key={i} className={`flex gap-1.5 ${i === guesses.length && shake ? "animate-[shake_0.4s]" : ""}`}>
            {row.map((ch, j) => {
              const state = i < rows.length ? rows[i][j] : null;
              return (
                <div
                  key={j}
                  className={`flex h-12 w-12 items-center justify-center rounded-lg border-2 text-xl font-extrabold sm:h-14 sm:w-14 sm:text-2xl ${
                    state ? CELL_STYLE[state] : ch ? "border-slate-400 text-slate-900" : "border-slate-200 text-slate-900"
                  }`}
                >
                  {ch || ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {error && <p className="text-sm font-bold text-rose-600">{error}</p>}

      {done && (
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="text-lg font-extrabold text-slate-900">{won ? "🎉 أحسنت!" : "لم تفلح هذه المرة"}</p>
          {!won && (
            <p className="mt-1 text-sm text-slate-600">
              الكلمة كانت: <strong className="text-slate-900">{answer}</strong>
            </p>
          )}
          {stats && (
            <p className="mt-2 text-xs text-slate-500">
              لعبت {stats.played} · فزت {stats.won} · سلسلة حالية {stats.streak} · أفضل سلسلة {stats.maxStreak}
            </p>
          )}
          <button type="button" onClick={share} className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">
            {copied ? "✓ نُسخت النتيجة" : "📤 شارك نتيجتك"}
          </button>
          <p className="mt-2 text-[11px] text-slate-400">كلمة جديدة غداً — احتفظ بسلسلتك.</p>
        </div>
      )}

      {!done && (
        <div className="flex w-full max-w-md flex-col items-center gap-1.5">
          <div className="flex flex-wrap justify-center gap-1">
            {EXTRA.map((k) => (
              <Key key={k} label={k} state={keyState.get(normalizeLetter(k))} onClick={() => press(k)} />
            ))}
          </div>
          {[ROW1, ROW2, ROW3].map((row, i) => (
            <div key={i} className="flex justify-center gap-1">
              {row.map((k) => (
                <Key key={k} label={k} state={keyState.get(normalizeLetter(k))} onClick={() => press(k)} />
              ))}
            </div>
          ))}
          <div className="mt-1 flex gap-1.5">
            <button type="button" onClick={backspace} className="rounded-lg bg-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-300">
              ⌫ حذف
            </button>
            <button type="button" onClick={submit} className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-700">
              تأكيد
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Key({ label, state, onClick }: { label: string; state?: LetterState; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 min-w-[2.1rem] rounded-md px-1.5 text-sm font-bold transition ${KEY_STYLE[state ?? "unused"]}`}
    >
      {label}
    </button>
  );
}
