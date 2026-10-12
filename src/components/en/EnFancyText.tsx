"use client";

import { useMemo, useState } from "react";
import { Card } from "./EnUi";

function map(name: string, up: number, low: number, dig?: number) {
  return [...name]
    .map((c) => {
      const x = c.codePointAt(0)!;
      if (x >= 65 && x <= 90) return String.fromCodePoint(up + x - 65);
      if (x >= 97 && x <= 122) return String.fromCodePoint(low + x - 97);
      if (dig && x >= 48 && x <= 57) return String.fromCodePoint(dig + x - 48);
      return c;
    })
    .join("");
}
const STYLES: [string, (n: string) => string][] = [
  ["Bold", (n) => map(n, 0x1d400, 0x1d41a, 0x1d7ce)],
  ["Italic bold", (n) => map(n, 0x1d468, 0x1d482)],
  ["Script bold", (n) => map(n, 0x1d4d0, 0x1d4ea)],
  ["Gothic (fraktur) bold", (n) => map(n, 0x1d56c, 0x1d586)],
  ["Double-struck", (n) => map(n, 0x1d538, 0x1d552, 0x1d7d8)],
  ["Monospace", (n) => map(n, 0x1d670, 0x1d68a, 0x1d7f6)],
  ["Circled", (n) => map(n, 0x24b6, 0x24d0)],
  ["Wide (fullwidth)", (n) => map(n, 0xff21, 0xff41, 0xff10)],
  ["Gamer tag", (n) => `꧁༺ ${map(n, 0x1d4d0, 0x1d4ea)} ༻꧂`],
  ["Stars", (n) => `★彡 ${map(n, 0x1d400, 0x1d41a)} 彡★`],
  ["Crown", (n) => `♛ ${map(n, 0x1d56c, 0x1d586)} ♛`],
  ["Brackets", (n) => `『 ${n} 』`],
  ["Hearts", (n) => `♡ ${n} ♡`],
];
export default function EnFancyText() {
  const [t, setT] = useState("Your Name");
  const [done, setDone] = useState("");
  const list = useMemo(() => (t.trim() ? STYLES.map(([l, fn]) => [l, fn(t.trim())] as [string, string]) : []), [t]);
  async function copy(v: string) {
    try {
      await navigator.clipboard.writeText(v);
      setDone(v);
      setTimeout(() => setDone(""), 1200);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <Card>
      <label className="block text-sm font-bold text-slate-700">
        Type your text
        <input value={t} onChange={(e) => setT(e.target.value)} maxLength={40} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-lg font-normal" />
      </label>
      <ul className="space-y-2">
        {list.map(([l, v]) => (
          <li key={l}>
            <button type="button" onClick={() => copy(v)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:bg-emerald-50">
              <span className="min-w-0 flex-1 break-words text-lg">{v}</span>
              <span className="shrink-0 text-xs font-bold text-emerald-700">{done === v ? "✓ Copied" : `Copy · ${l}`}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">Paste into Instagram, TikTok, Discord, Steam, gaming profiles and chat apps. Some sites limit which symbols they accept.</p>
    </Card>
  );
}
