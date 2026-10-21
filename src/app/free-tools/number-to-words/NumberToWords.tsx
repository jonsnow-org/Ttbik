"use client";

import { useMemo, useState } from "react";

const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة"];
const ONES_F = ["", "واحدة", "اثنتان", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثماني", "تسع", "عشر"];
const TEENS = ["", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TEENS_F = ["", "إحدى عشرة", "اثنتا عشرة", "ثلاث عشرة", "أربع عشرة", "خمس عشرة", "ست عشرة", "سبع عشرة", "ثماني عشرة", "تسع عشرة"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مئتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
const SCALES: [string, string, string][] = [
  ["ألف", "ألفان", "آلاف"],
  ["مليون", "مليونان", "ملايين"],
  ["مليار", "ملياران", "مليارات"],
  ["تريليون", "تريليونان", "تريليونات"],
];

type Cur = { name: string; one: string; two: string; many: string; single: string; fem: boolean; sub: [string, string, string, string]; subFem: boolean };
const CURRENCIES: Cur[] = [
  { name: "بدون عملة (رقم فقط)", one: "", two: "", many: "", single: "", fem: false, sub: ["", "", "", ""], subFem: false },
  { name: "ريال سعودي", one: "ريال", two: "ريالان", many: "ريالات", single: "ريالًا", fem: false, sub: ["هللة", "هللتان", "هللات", "هللة"], subFem: true },
  { name: "دينار (كويتي/أردني/عراقي…)", one: "دينار", two: "دينارا", many: "دنانير", single: "دينارًا", fem: false, sub: ["فلس", "فلسان", "فلوس", "فلسًا"], subFem: false },
  { name: "جنيه مصري", one: "جنيه", two: "جنيهان", many: "جنيهات", single: "جنيهًا", fem: false, sub: ["قرش", "قرشان", "قروش", "قرشًا"], subFem: false },
  { name: "درهم إماراتي / مغربي", one: "درهم", two: "درهمان", many: "دراهم", single: "درهمًا", fem: false, sub: ["فلس", "فلسان", "فلوس", "فلسًا"], subFem: false },
  { name: "دولار أمريكي", one: "دولار", two: "دولاران", many: "دولارات", single: "دولارًا", fem: false, sub: ["سنت", "سنتان", "سنتات", "سنتًا"], subFem: false },
  { name: "ليرة (سورية/لبنانية/تركية)", one: "ليرة", two: "ليرتان", many: "ليرات", single: "ليرةً", fem: true, sub: ["قرش", "قرشان", "قروش", "قرشًا"], subFem: false },
  { name: "ريال (عماني/قطري/يمني)", one: "ريال", two: "ريالان", many: "ريالات", single: "ريالًا", fem: false, sub: ["بيسة", "بيستان", "بيسات", "بيسةً"], subFem: true },
];

function under100(n: number, fem: boolean): string {
  const ones = fem ? ONES_F : ONES;
  const teens = fem ? TEENS_F : TEENS;
  if (n <= 10) return ones[n];
  if (n < 20) return teens[n - 10];
  const u = n % 10;
  const t = Math.floor(n / 10);
  return u ? `${ones[u]} و${TENS[t]}` : TENS[t];
}

function group(n: number, fem: boolean): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return under100(r, fem);
  const hw = HUNDREDS[h];
  return r ? `${hw} و${under100(r, fem)}` : hw;
}

// Counted noun after a number: 1 -> singular, 2 -> dual, 3..10 -> plural, 11..99 -> tamyeez (accusative),
// and a round hundred/thousand/million (n % 100 === 0) -> genitive singular: "ألف ريال", "مليون ريال", not "ريالًا".
function counted(n: number, one: string, two: string, many: string, single: string): string {
  const r = n % 100;
  if (r === 0) return one;
  if (n === 1) return one;
  if (n === 2) return two;
  if (r >= 3 && r <= 10) return many;
  return single;
}

export function toWords(num: bigint, fem = false): string {
  if (num === BigInt(0)) return "صفر";
  const parts: string[] = [];
  const groups: number[] = [];
  let x = num;
  const k = BigInt(1000);
  while (x > BigInt(0)) {
    groups.push(Number(x % k));
    x = x / k;
  }
  if (groups.length > 5) return "الرقم كبير جداً";
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (i === 0) {
      parts.push(group(g, fem));
      continue;
    }
    const [s1, s2, sp] = SCALES[i - 1];
    if (g === 1) parts.push(s1);
    else if (g === 2) parts.push(s2);
    else if (g % 100 >= 3 && g % 100 <= 10) parts.push(`${group(g, false)} ${sp}`);
    else parts.push(`${group(g, false)} ${s1}`);
  }
  return parts.join(" و");
}

function amountWords(n: bigint, c: { one: string; two: string; many: string; single: string }, fem: boolean): string {
  if (n === BigInt(1)) return c.one;
  if (n === BigInt(2)) return c.two;
  const w = toWords(n, fem);
  return `${w} ${counted(Number(n % BigInt(100)), c.one, c.two, c.many, c.single)}`;
}

export default function NumberToWords() {
  const [raw, setRaw] = useState("1250.50");
  const [cur, setCur] = useState(1);
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => {
    const clean = raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[,٬\s]/g, "").replace("٫", ".");
    if (!/^\d{1,15}(\.\d{1,2})?$/.test(clean)) return clean ? "أدخل رقماً صحيحاً (حتى 15 خانة، وكسران عشريان كحد أقصى)" : "";
    const [i, f = ""] = clean.split(".");
    const intPart = BigInt(i);
    const c = CURRENCIES[cur];
    if (!c.one) {
      const dec = f ? ` فاصلة ${toWords(BigInt(f.padEnd(2, "0")))}` : "";
      return toWords(intPart) + dec;
    }
    let out = `${amountWords(intPart, { one: c.one, two: c.two, many: c.many, single: c.single }, c.fem)} فقط`;
    const sub = BigInt((f || "0").padEnd(2, "0"));
    if (sub > BigInt(0)) {
      out = out.replace(/ فقط$/, "") + ` و${amountWords(sub, { one: c.sub[0], two: c.sub[1], many: c.sub[2], single: c.sub[3] }, c.subFem)} فقط`;
    }
    return out;
  }, [raw, cur]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <label className="block text-sm font-bold text-slate-700">
        الرقم
        <input value={raw} onChange={(e) => setRaw(e.target.value)} inputMode="decimal" dir="ltr" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-lg" />
      </label>
      <label className="block text-sm font-bold text-slate-700">
        العملة
        <select value={cur} onChange={(e) => setCur(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2">
          {CURRENCIES.map((c, i) => (
            <option key={c.name} value={i}>{c.name}</option>
          ))}
        </select>
      </label>
      <div className="rounded-xl bg-emerald-50 p-4 text-lg font-bold leading-9 text-emerald-900 min-h-[4rem]">{text || "—"}</div>
      <button type="button" onClick={copy} disabled={!text} className="w-full rounded-xl bg-emerald-600 py-2.5 font-bold text-white disabled:opacity-40">
        {copied ? "✓ تم النسخ" : "نسخ النص"}
      </button>
    </div>
  );
}
