"use client";

import { useMemo, useState } from "react";

type Mode = "format" | "minify" | "csv";
const SAMPLE = '{\n  "name": "شام AI",\n  "tools": ["JSON", "CSV"],\n  "active": true\n}';

function csvToJson(input: string): string {
  const lines = input.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("أدخل صف عناوين وصف بيانات واحداً على الأقل.");
  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if ((ch === "," || ch === "\t" || ch === ";") && !quoted) { cells.push(cell.trim()); cell = ""; }
      else cell += ch;
    }
    if (quoted) throw new Error("يوجد حقل CSV بعلامة اقتباس غير مغلقة.");
    cells.push(cell.trim());
    return cells;
  };
  const headers = parseLine(lines[0]).map((h, i) => h || `column_${i + 1}`);
  if (new Set(headers).size !== headers.length) throw new Error("أسماء الأعمدة مكررة؛ اجعل كل عنوان فريداً.");
  const rows = lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
  });
  return JSON.stringify(rows, null, 2);
}

export default function JsonWorkbench() {
  const [mode, setMode] = useState<Mode>("format");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const stats = useMemo(() => ({ chars: input.length, lines: input ? input.split(/\r?\n/).length : 0 }), [input]);

  function run() {
    setError(""); setCopied(false); setOutput("");
    if (!input.trim()) { setError("أدخل البيانات أولاً."); return; }
    try {
      if (mode === "csv") setOutput(csvToJson(input));
      else {
        const parsed: unknown = JSON.parse(input);
        setOutput(mode === "format" ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّرت معالجة البيانات.");
    }
  }

  async function copyOutput() {
    try { await navigator.clipboard.writeText(output); setCopied(true); }
    catch { setError("تعذّر النسخ التلقائي؛ حدّد النتيجة وانسخها يدوياً."); }
  }

  function downloadOutput() {
    if (!output) return;
    const blob = new Blob([output], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "sham-data.json"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="أداة JSON وCSV">
      <div className="flex flex-wrap gap-2" role="group" aria-label="نوع العملية">
        {([{key:"format",label:"تنسيق JSON"},{key:"minify",label:"تصغير JSON"},{key:"csv",label:"CSV إلى JSON"}] as const).map((item) => (
          <button key={item.key} type="button" onClick={() => { setMode(item.key); setError(""); setOutput(""); }}
            aria-pressed={mode === item.key}
            className={`rounded-xl px-3 py-2 text-sm font-bold ${mode === item.key ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-700"}`}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setInput(mode === "csv" ? "name,city\nأحمد,حلب\nليلى,دمشق" : SAMPLE); setOutput(""); setError(""); }}
          className="rounded-lg bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800">تحميل مثال</button>
        <button type="button" onClick={() => { setInput(""); setOutput(""); setError(""); }}
          className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">مسح</button>
        <span className="self-center text-xs text-slate-500">{stats.chars.toLocaleString("ar")} حرف · {stats.lines.toLocaleString("ar")} سطر</span>
      </div>
      <label className="block text-sm font-bold text-slate-800" htmlFor="json-workbench-input">{mode === "csv" ? "الصق بيانات CSV" : "الصق بيانات JSON"}</label>
      <textarea id="json-workbench-input" value={input} onChange={(e) => { setInput(e.target.value); setError(""); }}
        rows={9} dir="ltr" spellCheck={false} className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-sky-300"
        placeholder={mode === "csv" ? "name,city\nAhmad,Aleppo" : '{"name":"Sham AI","active":true}'} />
      <button type="button" onClick={run} className="w-full rounded-xl bg-sky-700 px-4 py-3 font-extrabold text-white hover:bg-sky-800">
        {mode === "format" ? "تحقق ونسّق JSON" : mode === "minify" ? "تحقق وصغّر JSON" : "حوّل CSV إلى JSON"}
      </button>
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
      {output && <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="json-workbench-output" className="text-sm font-bold text-slate-800">النتيجة</label>
          <div className="flex gap-2">
            <button type="button" onClick={copyOutput} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{copied ? "تم النسخ" : "نسخ"}</button>
            <button type="button" onClick={downloadOutput} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-800">تنزيل JSON</button>
          </div>
        </div>
        <textarea id="json-workbench-output" readOnly value={output} rows={9} dir="ltr" spellCheck={false}
          className="w-full rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3 font-mono text-xs" />
      </div>}
      <p className="text-xs leading-6 text-slate-500">تتم المعالجة داخل متصفحك؛ لا نرفع النص إلى خادم. عند استخدام بيانات حساسة، تأكد من إزالة أي أسرار قبل مشاركتها.</p>
    </section>
  );
}
