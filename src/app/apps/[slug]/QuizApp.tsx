"use client";
import { useState } from "react";
import type { AppItem } from "@/lib/hub/appConfig";

export default function QuizApp({
  items,
  color,
  onColor,
}: {
  items: AppItem[];
  color: string;
  onColor: string;
}) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const done = Object.keys(picked).length === items.length && items.length > 0;
  const score = items.reduce((s, it, i) => s + (picked[i] === it.answer ? 1 : 0), 0);
  const reset = () => setPicked({});

  return (
    <section className="user-created-app__quiz" aria-label="أسئلة الاختبار">
      {items.map((it, i) => (
        <article key={i} className="user-created-app__quiz-question" aria-labelledby={`user-quiz-question-${i}`}>
          <h2 id={`user-quiz-question-${i}`} className="font-bold leading-7 text-slate-900">
            {i + 1}. {it.title}
          </h2>
          <div className="mt-3 grid gap-2">
            {(it.options || []).map((option, k) => {
              const chosen = picked[i] === k;
              const answered = picked[i] !== undefined;
              const correct = k === it.answer;
              const className = [
                "user-created-app__quiz-option",
                answered && correct ? "is-correct" : "",
                chosen && !correct ? "is-wrong" : "",
              ].filter(Boolean).join(" ");
              return (
                <button
                  key={k}
                  type="button"
                  disabled={answered}
                  aria-pressed={chosen}
                  className={className}
                  onClick={() => setPicked((current) => ({ ...current, [i]: k }))}
                >
                  <span>{option}</span>
                  {answered && correct && <span className="mr-2 font-bold text-emerald-700">✓ صحيحة</span>}
                  {chosen && !correct && <span className="mr-2 font-bold text-rose-700">إجابتك</span>}
                </button>
              );
            })}
          </div>
        </article>
      ))}
      {done && (
        <div className="user-created-app__quiz-result" role="status" aria-live="polite" style={{ background: color, color: onColor }}>
          <div className="text-2xl font-extrabold">{score} / {items.length}</div>
          <p className="mt-1 text-sm font-bold">نتيجتك في الاختبار · {Math.round((score / items.length) * 100)}٪</p>
          <button type="button" className="user-created-app__quiz-reset" onClick={reset}>أعد الاختبار</button>
        </div>
      )}
    </section>
  );
}
