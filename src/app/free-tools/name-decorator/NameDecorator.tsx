"use client";

import { useMemo, useState } from "react";

const TATWEEL = "ـ";
// Arabic letters that do not connect to the following letter.
const NO_JOIN = new Set("اأإآدذرزوؤةىء".split(""));
const isArabic = (c: string) => /[ء-ي]/.test(c);

function tatweel(name: string, n: number): string {
  const chars = [...name];
  return chars
    .map((c, i) => {
      const next = chars[i + 1];
      return isArabic(c) && !NO_JOIN.has(c) && next && isArabic(next) ? c + TATWEEL.repeat(n) : c;
    })
    .join("");
}

function mapLatin(name: string, upper: number, lower: number, digits?: number): string {
  return [...name]
    .map((c) => {
      const code = c.codePointAt(0)!;
      if (code >= 65 && code <= 90) return String.fromCodePoint(upper + code - 65);
      if (code >= 97 && code <= 122) return String.fromCodePoint(lower + code - 97);
      if (digits && code >= 48 && code <= 57) return String.fromCodePoint(digits + code - 48);
      return c;
    })
    .join("");
}

const ARABIC_STYLES: [string, (n: string) => string][] = [
  ["مطوّل خفيف", (n) => tatweel(n, 1)],
  ["مطوّل متوسط", (n) => tatweel(n, 2)],
  ["مطوّل كبير", (n) => tatweel(n, 3)],
  ["نجوم", (n) => `★彡 ${tatweel(n, 1)} 彡★`],
  ["قلوب", (n) => `♡ ${tatweel(n, 1)} ♡`],
  ["زهور", (n) => `✿ ${n} ✿`],
  ["تاج", (n) => `♛ ${tatweel(n, 1)} ♛`],
  ["أقواس", (n) => `『 ${n} 』`],
  ["زخرفة جانبية", (n) => `•°• ${tatweel(n, 1)} •°•`],
  ["ملكي", (n) => `꧁ ${n} ꧂`],
  ["نقاط", (n) => [...n].join("٠")],
  ["نبضة", (n) => `ıllıllı ${n} ıllıllı`],
  ["سهام", (n) => `➳ ${n} ➳`],
  ["ماسة", (n) => `◈ ${tatweel(n, 1)} ◈`],
];

const LATIN_STYLES: [string, (n: string) => string][] = [
  ["Bold", (n) => mapLatin(n, 0x1d400, 0x1d41a, 0x1d7ce)],
  ["Italic Bold", (n) => mapLatin(n, 0x1d468, 0x1d482)],
  ["Script Bold", (n) => mapLatin(n, 0x1d4d0, 0x1d4ea)],
  ["Fraktur Bold", (n) => mapLatin(n, 0x1d56c, 0x1d586)],
  ["Double-struck", (n) => mapLatin(n, 0x1d538, 0x1d552, 0x1d7d8)],
  ["Monospace", (n) => mapLatin(n, 0x1d670, 0x1d68a, 0x1d7f6)],
  ["Circled", (n) => mapLatin(n, 0x24b6, 0x24d0)],
  ["Fullwidth", (n) => mapLatin(n, 0xff21, 0xff41, 0xff10)],
  ["Gamer", (n) => `꧁༺ ${mapLatin(n, 0x1d4d0, 0x1d4ea)} ༻꧂`],
  ["Stars", (n) => `★彡 ${mapLatin(n, 0x1d400, 0x1d41a)} 彡★`],
  ["Crown", (n) => `♛ ${mapLatin(n, 0x1d56c, 0x1d586)} ♛`],
];

export default function NameDecorator() {
  const [name, setName] = useState("محمد");
  const [copied, setCopied] = useState("");
  const hasArabic = useMemo(() => [...name].some(isArabic), [name]);
  const hasLatin = useMemo(() => /[A-Za-z]/.test(name), [name]);
  const list = useMemo(() => {
    const t = name.trim();
    if (!t) return [] as [string, string][];
    const out: [string, string][] = [];
    if (hasArabic) ARABIC_STYLES.forEach(([l, f]) => out.push([l, f(t)]));
    if (hasLatin || !hasArabic) LATIN_STYLES.forEach(([l, f]) => out.push([l, f(t)]));
    return out;
  }, [name, hasArabic, hasLatin]);

  async function copy(v: string) {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(v);
      setTimeout(() => setCopied(""), 1200);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <label className="block text-sm font-bold text-slate-700">
        اكتب اسمك (عربي أو إنجليزي)
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-lg" />
      </label>
      <ul className="space-y-2">
        {list.map(([label, val]) => (
          <li key={label + val}>
            <button type="button" onClick={() => copy(val)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-start hover:bg-emerald-50">
              <span className="min-w-0 flex-1 break-words text-lg">{val}</span>
              <span className="shrink-0 text-xs font-bold text-emerald-700">{copied === val ? "✓ تم النسخ" : `نسخ · ${label}`}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">اضغط على أي زخرفة لنسخها ثم الصقها في ببجي أو فري فاير أو إنستغرام أو تيك توك أو واتساب.</p>
    </div>
  );
}
