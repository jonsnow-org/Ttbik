"use client";

import { useState } from "react";

type Exp = { company: string; role: string; period: string; desc: string };
type Edu = { school: string; degree: string; year: string };
const inp = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";

export default function EnCv() {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loc, setLoc] = useState("");
  const [summary, setSummary] = useState("");
  const [skills, setSkills] = useState("");
  const [langs, setLangs] = useState("");
  const [exp, setExp] = useState<Exp[]>([{ company: "", role: "", period: "", desc: "" }]);
  const [edu, setEdu] = useState<Edu[]>([{ school: "", degree: "", year: "" }]);
  const [copied, setCopied] = useState(false);
  const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const text = () => {
    const l: string[] = [name, title, [phone, email, loc].filter(Boolean).join(" | "), ""];
    if (summary) l.push("SUMMARY", summary, "");
    const ex = exp.filter((e) => e.company || e.role);
    if (ex.length) { l.push("EXPERIENCE"); ex.forEach((e) => l.push(`${e.role} — ${e.company} (${e.period})`, e.desc)); l.push(""); }
    const ed = edu.filter((e) => e.school || e.degree);
    if (ed.length) { l.push("EDUCATION"); ed.forEach((e) => l.push(`${e.degree} — ${e.school} (${e.year})`)); l.push(""); }
    if (list(skills).length) l.push(`SKILLS: ${list(skills).join(", ")}`);
    if (list(langs).length) l.push(`LANGUAGES: ${list(langs).join(", ")}`);
    return l.join("\n");
  };
  async function copy() {
    try { await navigator.clipboard.writeText(text()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ }
  }
  const H = ({ children }: { children: string }) => <h3 className="mt-5 border-b border-slate-300 pb-1 text-sm font-extrabold uppercase tracking-wide text-slate-700">{children}</h3>;
  return (
    <div dir="ltr" lang="en" className="space-y-5 text-left">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 print:hidden">
        <h2 className="text-lg font-bold">Your details</h2>
        <input className={inp} placeholder="Full name *" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inp} placeholder="Job title (e.g. Software Engineer)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={inp} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className={inp} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={inp} placeholder="City, Country" value={loc} onChange={(e) => setLoc(e.target.value)} />
        </div>
        <textarea className={inp} rows={3} placeholder="Professional summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <div>
          <div className="mb-1 flex items-center justify-between text-sm font-bold"><span>Experience</span><button type="button" className="text-emerald-700" onClick={() => setExp([...exp, { company: "", role: "", period: "", desc: "" }])}>+ Add</button></div>
          {exp.map((e, i) => (
            <div key={i} className="mb-3 grid gap-2 sm:grid-cols-3">
              <input className={inp} placeholder="Company" value={e.company} onChange={(ev) => setExp(exp.map((x, j) => (j === i ? { ...x, company: ev.target.value } : x)))} />
              <input className={inp} placeholder="Role" value={e.role} onChange={(ev) => setExp(exp.map((x, j) => (j === i ? { ...x, role: ev.target.value } : x)))} />
              <input className={inp} placeholder="Period (2020–2023)" value={e.period} onChange={(ev) => setExp(exp.map((x, j) => (j === i ? { ...x, period: ev.target.value } : x)))} />
              <textarea className={`${inp} sm:col-span-3`} rows={2} placeholder="What you did, in one or two lines" value={e.desc} onChange={(ev) => setExp(exp.map((x, j) => (j === i ? { ...x, desc: ev.target.value } : x)))} />
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-sm font-bold"><span>Education</span><button type="button" className="text-emerald-700" onClick={() => setEdu([...edu, { school: "", degree: "", year: "" }])}>+ Add</button></div>
          {edu.map((e, i) => (
            <div key={i} className="mb-3 grid gap-2 sm:grid-cols-3">
              <input className={inp} placeholder="School / University" value={e.school} onChange={(ev) => setEdu(edu.map((x, j) => (j === i ? { ...x, school: ev.target.value } : x)))} />
              <input className={inp} placeholder="Degree / Field" value={e.degree} onChange={(ev) => setEdu(edu.map((x, j) => (j === i ? { ...x, degree: ev.target.value } : x)))} />
              <input className={inp} placeholder="Year" value={e.year} onChange={(ev) => setEdu(edu.map((x, j) => (j === i ? { ...x, year: ev.target.value } : x)))} />
            </div>
          ))}
        </div>
        <input className={inp} placeholder="Skills (comma separated)" value={skills} onChange={(e) => setSkills(e.target.value)} />
        <input className={inp} placeholder="Languages (comma separated)" value={langs} onChange={(e) => setLangs(e.target.value)} />
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white">🖨️ Print / Save as PDF</button>
          <button type="button" onClick={copy} className="flex-1 rounded-xl border border-slate-300 py-2.5 font-bold">{copied ? "Copied ✓" : "Copy text"}</button>
        </div>
        <p className="text-xs text-slate-500">Your browser&apos;s print dialog opens: choose “Save as PDF”. Nothing is uploaded; everything stays in this tab.</p>
      </div>
      <div id="cv-print-area" className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <h2 className="text-2xl font-extrabold text-slate-900">{name || "Your Name"}</h2>
        {title && <p className="text-slate-600">{title}</p>}
        <p className="text-sm text-slate-500">{[phone, email, loc].filter(Boolean).join("  ·  ")}</p>
        {summary && (<><H>Summary</H><p className="mt-2 text-sm leading-7">{summary}</p></>)}
        {exp.some((e) => e.company || e.role) && (<><H>Experience</H>{exp.filter((e) => e.company || e.role).map((e, i) => (<div key={i} className="mt-2"><p className="text-sm font-bold">{e.role} — {e.company} <span className="font-normal text-slate-500">{e.period}</span></p><p className="text-sm leading-6 text-slate-700">{e.desc}</p></div>))}</>)}
        {edu.some((e) => e.school || e.degree) && (<><H>Education</H>{edu.filter((e) => e.school || e.degree).map((e, i) => (<p key={i} className="mt-2 text-sm"><b>{e.degree}</b> — {e.school} <span className="text-slate-500">{e.year}</span></p>))}</>)}
        {list(skills).length > 0 && (<><H>Skills</H><p className="mt-2 text-sm">{list(skills).join(" · ")}</p></>)}
        {list(langs).length > 0 && (<><H>Languages</H><p className="mt-2 text-sm">{list(langs).join(" · ")}</p></>)}
      </div>
      <style>{`@media print{body *{visibility:hidden}#cv-print-area,#cv-print-area *{visibility:visible}#cv-print-area{position:absolute;left:0;top:0;width:100%}}`}</style>
    </div>
  );
}
