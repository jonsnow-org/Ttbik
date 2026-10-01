"use client";

import { useMemo, useState } from "react";

const POS_AR = "ممتاز رائع جميل حب أحب سعيد فرح نجاح شكر ممتنة مذهل مميز لطيف ودي إيجابي راضٍ راضي أنصح أنصحكم أفضل قوي مفيد سهل سريع أنيق نظيف صادق أمين محترم شكراً شكرا تستحق يستحق فخور فخورة مبسوط مبسوطة عظيم خارق مذهلة جيدة جيد جميلة أحسنت بارك مبارك".split(" ");
const NEG_AR = "سيء سيئ فاشل فشل كره أكره حزين غاضب غضب مشكلة معقد صعب بطيء خيبة خيبة_أمل احتيال نصب كذب سيئة رديء رديئة مزعج مزعجة مخيب مخيبة لا_أنصح سيئين أسوأ أرفض رفض كارثة سيء جداً فظيع فظيعة مؤسف مؤسفة ضعيف ضعيفة ناقص ناقصة باهظ غالي سيئ_جدا".split(" ");
const POS_EN = "good great excellent amazing love loved happy joy success thank thanks positive best useful easy fast nice clean honest recommend awesome wonderful perfect".split(" ");
const NEG_EN = "bad terrible awful hate hated sad angry anger problem hard difficult slow scam fraud lie worst refuse fail failed poor weak expensive horrible disappointed disappointment".split(" ");

const INTENSIFIERS = new Set(["جدا", "جداً", "very", "really", "extremely", "للغاية", "للغايه", "أكثر", "اكثر"]);
const NEGATORS = new Set(["لا", "ليس", "غير", "بدون", "ما", "لم", "لن", "not", "no", "never"]);

type Label = "إيجابي" | "سلبي" | "محايد";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreText(text: string): { score: number; label: Label; hits: { w: string; s: number }[] } {
  const tokens = tokenize(text);
  let score = 0;
  const hits: { w: string; s: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let s = 0;
    if (POS_AR.includes(t) || POS_EN.includes(t)) s = 1;
    if (NEG_AR.includes(t) || NEG_EN.includes(t)) s = -1;
    if (!s) continue;
    const prev = tokens[i - 1];
    if (prev && INTENSIFIERS.has(prev)) s *= 1.5;
    if (prev && NEGATORS.has(prev)) s *= -1;
    score += s;
    hits.push({ w: t, s });
  }
  // mild length normalization
  const norm = tokens.length ? score / Math.sqrt(tokens.length) : 0;
  let label: Label = "محايد";
  if (norm >= 0.35) label = "إيجابي";
  else if (norm <= -0.35) label = "سلبي";
  return { score: norm, label, hits };
}

function confidence(absScore: number, hits: number): number {
  const base = Math.min(0.92, 0.45 + absScore * 0.35 + Math.min(hits, 6) * 0.05);
  return Math.round(base * 100);
}

const labelStyle: Record<Label, string> = {
  إيجابي: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  سلبي: "bg-rose-50 text-rose-800 ring-rose-200",
  محايد: "bg-slate-100 text-slate-700 ring-slate-200",
};

export default function SentimentAnalyzer() {
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<"single" | "batch">("single");

  const results = useMemo(() => {
    const lines = mode === "single" ? [raw.trim()] : raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    return lines.filter(Boolean).map((text) => {
      const r = scoreText(text);
      return {
        text: text.slice(0, 160) + (text.length > 160 ? "…" : ""),
        ...r,
        conf: confidence(Math.abs(r.score), r.hits.length),
      };
    });
  }, [raw, mode]);

  const summary = useMemo(() => {
    if (!results.length) return null;
    const c = { إيجابي: 0, سلبي: 0, محايد: 0 };
    results.forEach((r) => {
      c[r.label]++;
    });
    return c;
  }, [results]);

  return (
    <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={`flex-1 rounded-xl py-2 text-sm font-bold ${mode === "single" ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          نص واحد
        </button>
        <button
          type="button"
          onClick={() => setMode("batch")}
          className={`flex-1 rounded-xl py-2 text-sm font-bold ${mode === "batch" ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          عدة تعليقات
        </button>
      </div>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={mode === "batch" ? 8 : 5}
        dir="auto"
        placeholder={mode === "batch" ? "سطر لكل تعليق أو مراجعة…" : "الصق النص هنا…"}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none ring-sky-200 focus:ring-2"
      />
      {!results.length ? (
        <p className="text-center text-xs text-slate-400">ابدأ بالكتابة لترى التحليل فوراً</p>
      ) : (
        <>
          {summary && results.length > 1 && (
            <div className="grid grid-cols-3 gap-2">
              {(["إيجابي", "محايد", "سلبي"] as Label[]).map((k) => (
                <div key={k} className={`rounded-2xl p-2 text-center ring-1 ${labelStyle[k]}`}>
                  <p className="text-lg font-black">{summary[k]}</p>
                  <p className="text-[10px] font-bold">{k}</p>
                </div>
              ))}
            </div>
          )}
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
            {results.map((r, i) => (
              <li key={i} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-black ring-1 ${labelStyle[r.label]}`}>{r.label}</span>
                  <span className="text-[11px] font-bold text-slate-500">ثقة {r.conf}%</span>
                  <span className="text-[11px] text-slate-400">درجة {r.score.toFixed(2)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-800" dir="auto">
                  {r.text}
                </p>
                {!!r.hits.length && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.hits.slice(0, 8).map((h, j) => (
                      <span
                        key={j}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${h.s > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}
                      >
                        {h.w}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-[10px] leading-relaxed text-slate-400">
        التحليل يعتمد قاموساً لغوياً محلياً داخل المتصفح — مناسب للتقدير السريع لتعليقات المتاجر
        والسوشيال. للنصوص القانونية أو الطبية استخدم مراجعة بشرية.
      </p>
    </div>
  );
}
