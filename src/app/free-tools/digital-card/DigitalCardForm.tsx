"use client";

import { useState } from "react";
import Link from "next/link";

type LinkRow = { label: string; url: string };

export default function DigitalCardForm() {
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [theme, setTheme] = useState<"simple" | "dark" | "brand">("simple");
  const [links, setLinks] = useState<LinkRow[]>([{ label: "", url: "" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    publicUrl: string;
    editToken: string;
    slug: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  function addLink() {
    if (links.length >= 12) return;
    setLinks([...links, { label: "", url: "" }]);
  }

  function updateLink(i: number, field: "label" | "url", value: string) {
    const next = [...links];
    next[i] = { ...next[i], [field]: value };
    setLinks(next);
  }

  function removeLink(i: number) {
    setLinks(links.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setError("");
    setResult(null);
    if (!title.trim()) {
      setError("العنوان مطلوب");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/tools/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          bio: bio.trim() || undefined,
          avatarUrl: avatarUrl.trim() || undefined,
          slug: slug.trim() || undefined,
          theme,
          links: links.filter((l) => l.label.trim() && l.url.trim()),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "فشل الإنشاء");
        return;
      }
      setResult({
        publicUrl: data.publicUrl,
        editToken: data.editToken,
        slug: data.slug,
      });
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  function copyUrl() {
    if (!result) return;
    navigator.clipboard.writeText(result.publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function copyToken() {
    if (!result) return;
    navigator.clipboard.writeText(result.editToken).then(() => {
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      {!result ? (
        <div className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              الاسم / العنوان *
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: متجر أحمد"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              maxLength={80}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              نبذة قصيرة
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="جملة أو اثنتين عنك أو عن مشروعك"
              rows={2}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              maxLength={280}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              رابط صورة (اختياري)
            </label>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              dir="ltr"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              معرّف الرابط المخصص (اختياري)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400" dir="ltr">
                /c/
              </span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="ahmad-shop"
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                dir="ltr"
                maxLength={24}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              أحرف إنجليزية صغيرة وأرقام و - فقط. اتركه فارغاً للتوليد التلقائي.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              المظهر
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { v: "simple", label: "بسيط" },
                  { v: "dark", label: "داكن" },
                  { v: "brand", label: "علامة" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setTheme(opt.v)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    theme === opt.v
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              الروابط (حتى 12)
            </label>
            <div className="grid gap-2">
              {links.map((l, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <input
                    value={l.label}
                    onChange={(e) => updateLink(i, "label", e.target.value)}
                    placeholder="اسم الزر"
                    className="w-28 rounded-xl border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                    maxLength={40}
                  />
                  <input
                    value={l.url}
                    onChange={(e) => updateLink(i, "url", e.target.value)}
                    placeholder="https://..."
                    className="min-w-[12rem] flex-1 rounded-xl border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                    dir="ltr"
                  />
                  {links.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLink(i)}
                      className="rounded-xl px-2 text-sm text-red-500 hover:bg-red-50"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {links.length < 12 && (
              <button
                type="button"
                onClick={addLink}
                className="mt-2 text-xs font-semibold text-brand-700 hover:underline"
              >
                + إضافة رابط
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? "جاري الإنشاء..." : "إنشاء البطاقة"}
          </button>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="mb-1 text-xs font-semibold text-slate-500">رابط البطاقة العام:</p>
          <p className="break-all font-mono text-sm text-brand-700" dir="ltr">
            {result.publicUrl}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyUrl}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
            >
              {copied ? "✅ تم النسخ" : "نسخ الرابط"}
            </button>
            <a
              href={result.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-brand-300"
            >
              فتح البطاقة
            </a>
          </div>

          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-bold text-amber-800">
              ⚠️ رمز التعديل (احفظه الآن — لن يظهر مرة أخرى)
            </p>
            <p className="mt-1 break-all font-mono text-xs text-amber-900" dir="ltr">
              {result.editToken}
            </p>
            <button
              type="button"
              onClick={copyToken}
              className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
            >
              {tokenCopied ? "✅ تم النسخ" : "نسخ رمز التعديل"}
            </button>
            <p className="mt-1 text-[11px] text-amber-700">
              ستحتاجه لاحقاً لتعديل الروابط أو العنوان. لا تشاركه.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setResult(null);
              setTitle("");
              setBio("");
              setAvatarUrl("");
              setSlug("");
              setLinks([{ label: "", url: "" }]);
              setTokenCopied(false);
            }}
            className="mt-4 text-sm font-semibold text-brand-700 hover:underline"
          >
            إنشاء بطاقة أخرى
          </button>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-dashed border-brand-200 bg-brand-50/50 p-4 text-sm text-slate-600">
        بطاقة أعمال رقمية حقيقية على نطاق الموقع — صفحة عامة + عداد مشاهدات. راجع{" "}
        <Link href="/free-tools" className="font-bold text-brand-700 underline">
          باقي الأدوات المجانية
        </Link>
        .
      </div>
    </div>
  );
}
