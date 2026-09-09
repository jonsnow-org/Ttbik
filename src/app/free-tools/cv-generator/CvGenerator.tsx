"use client";

import { useState } from "react";

type Edu = { school: string; degree: string; year: string };
type Exp = { company: string; role: string; period: string; desc: string };

const emptyEdu = (): Edu => ({ school: "", degree: "", year: "" });
const emptyExp = (): Exp => ({ company: "", role: "", period: "", desc: "" });

export default function CvGenerator() {
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [summary, setSummary] = useState("");
  const [education, setEducation] = useState<Edu[]>([emptyEdu()]);
  const [experience, setExperience] = useState<Exp[]>([emptyExp()]);
  const [skills, setSkills] = useState("");
  const [languages, setLanguages] = useState("");
  const [copied, setCopied] = useState(false);

  function updateEdu(i: number, field: keyof Edu, val: string) {
    setEducation((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)));
  }
  function updateExp(i: number, field: keyof Exp, val: string) {
    setExperience((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)));
  }

  function handlePrint() {
    window.print();
  }

  async function copyPlainText() {
    const lines: string[] = [];
    if (name.trim()) lines.push(name.trim());
    if (jobTitle.trim()) lines.push(jobTitle.trim());
    const contact = [phone, email, city].filter((x) => x.trim()).join(" | ");
    if (contact) lines.push(contact);
    lines.push("");
    if (summary.trim()) {
      lines.push("نبذة:");
      lines.push(summary.trim());
      lines.push("");
    }
    const exps = experience.filter((e) => e.company.trim() || e.role.trim());
    if (exps.length) {
      lines.push("الخبرات:");
      for (const e of exps) {
        lines.push(`• ${e.role || "—"} — ${e.company || "—"}${e.period ? ` (${e.period})` : ""}`);
        if (e.desc.trim()) lines.push(`  ${e.desc.trim()}`);
      }
      lines.push("");
    }
    const edus = education.filter((e) => e.school.trim() || e.degree.trim());
    if (edus.length) {
      lines.push("التعليم:");
      for (const e of edus) {
        lines.push(`• ${e.degree || "—"} — ${e.school || "—"}${e.year ? ` (${e.year})` : ""}`);
      }
      lines.push("");
    }
    if (skillList.length) lines.push(`المهارات: ${skillList.join("، ")}`);
    if (langList.length) lines.push(`اللغات: ${langList.join("، ")}`);
    try {
      await navigator.clipboard.writeText(lines.join("\n").trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const skillList = skills
    .split(/[,،\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const langList = languages
    .split(/[,،\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const hasContent = name.trim() || jobTitle.trim();

  return (
    <div className="space-y-8">
      {/* Form — hidden on print */}
      <div className="print:hidden rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
        <h2 className="text-lg font-bold text-slate-900">بيانات السيرة الذاتية</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">الاسم الكامل *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: أحمد محمد العلي"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">المسمى الوظيفي</label>
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="مثال: مطور برمجيات / محاسب"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">رقم الجوال</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+966 5xxxxxxxx"
              dir="ltr"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">البريد الإلكتروني</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              dir="ltr"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-semibold text-slate-700">المدينة / الدولة</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="الرياض، السعودية"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">نبذة مختصرة</label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            placeholder="ملخص مهني قصير..."
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-700">التعليم</label>
            <button
              type="button"
              onClick={() => setEducation((p) => [...p, emptyEdu()])}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              + إضافة
            </button>
          </div>
          {education.map((edu, i) => (
            <div key={i} className="mb-3 grid gap-2 sm:grid-cols-3">
              <input
                value={edu.school}
                onChange={(e) => updateEdu(i, "school", e.target.value)}
                placeholder="المدرسة / الجامعة"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <input
                value={edu.degree}
                onChange={(e) => updateEdu(i, "degree", e.target.value)}
                placeholder="الدرجة / التخصص"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <input
                value={edu.year}
                onChange={(e) => updateEdu(i, "year", e.target.value)}
                placeholder="السنة"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          ))}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-700">الخبرات</label>
            <button
              type="button"
              onClick={() => setExperience((p) => [...p, emptyExp()])}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              + إضافة
            </button>
          </div>
          {experience.map((exp, i) => (
            <div key={i} className="mb-3 space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  value={exp.company}
                  onChange={(e) => updateExp(i, "company", e.target.value)}
                  placeholder="الشركة"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
                <input
                  value={exp.role}
                  onChange={(e) => updateExp(i, "role", e.target.value)}
                  placeholder="المسمى"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
                <input
                  value={exp.period}
                  onChange={(e) => updateExp(i, "period", e.target.value)}
                  placeholder="الفترة (2020–2023)"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <textarea
                value={exp.desc}
                onChange={(e) => updateExp(i, "desc", e.target.value)}
                rows={2}
                placeholder="وصف مختصر للمهام"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">المهارات (افصل بفاصلة)</label>
            <textarea
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              rows={2}
              placeholder="إدارة مشاريع، Excel، تفاوض، React"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">اللغات (افصل بفاصلة)</label>
            <textarea
              value={languages}
              onChange={(e) => setLanguages(e.target.value)}
              rows={2}
              placeholder="العربية (أم)، الإنجليزية (متقدم)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handlePrint}
            disabled={!hasContent}
            className="flex-1 rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300"
          >
            🖨️ اطبع / احفظ كـ PDF
          </button>
          <button
            type="button"
            onClick={copyPlainText}
            disabled={!hasContent}
            className="flex-1 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {copied ? "تم النسخ ✓" : "نسخ النص"}
          </button>
        </div>
        <p className="text-xs text-slate-400 text-center">
          سيفتح مربع الطباعة في متصفحك — اختر «حفظ كـ PDF» أو الطابعة. النص العربي يُعرض بشكل صحيح بفضل محرك المتصفح. «نسخ النص» للصق في Word أو LinkedIn.
        </p>
      </div>

      {/* Live preview + print target */}
      <div
        id="cv-print-area"
        dir="rtl"
        className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none print:p-0"
      >
        <header className="border-b-2 border-slate-800 pb-4 mb-6">
          <h1 className="text-2xl font-extrabold text-slate-900">{name || "الاسم الكامل"}</h1>
          {jobTitle && <p className="mt-1 text-lg text-brand-700 font-semibold">{jobTitle}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            {phone && <span dir="ltr">{phone}</span>}
            {email && <span dir="ltr">{email}</span>}
            {city && <span>{city}</span>}
          </div>
        </header>

        {summary.trim() && (
          <section className="mb-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-2 border-b border-slate-200 pb-1">
              نبذة
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{summary}</p>
          </section>
        )}

        {experience.some((e) => e.company.trim() || e.role.trim()) && (
          <section className="mb-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-2 border-b border-slate-200 pb-1">
              الخبرات
            </h2>
            <div className="space-y-4">
              {experience
                .filter((e) => e.company.trim() || e.role.trim())
                .map((e, i) => (
                  <div key={i}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-slate-900">
                        {e.role || "—"} — {e.company || "—"}
                      </p>
                      {e.period && <span className="text-xs text-slate-500">{e.period}</span>}
                    </div>
                    {e.desc.trim() && (
                      <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{e.desc}</p>
                    )}
                  </div>
                ))}
            </div>
          </section>
        )}

        {education.some((e) => e.school.trim() || e.degree.trim()) && (
          <section className="mb-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-2 border-b border-slate-200 pb-1">
              التعليم
            </h2>
            <div className="space-y-2">
              {education
                .filter((e) => e.school.trim() || e.degree.trim())
                .map((e, i) => (
                  <div key={i} className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-slate-800">
                      <span className="font-semibold">{e.degree || "—"}</span>
                      {e.school ? ` — ${e.school}` : ""}
                    </p>
                    {e.year && <span className="text-xs text-slate-500">{e.year}</span>}
                  </div>
                ))}
            </div>
          </section>
        )}

        {skillList.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-2 border-b border-slate-200 pb-1">
              المهارات
            </h2>
            <p className="text-sm text-slate-700">{skillList.join(" · ")}</p>
          </section>
        )}

        {langList.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-2 border-b border-slate-200 pb-1">
              اللغات
            </h2>
            <p className="text-sm text-slate-700">{langList.join(" · ")}</p>
          </section>
        )}
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #cv-print-area,
          #cv-print-area * {
            visibility: visible;
          }
          #cv-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 1.5cm;
            box-shadow: none;
            border: none;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
