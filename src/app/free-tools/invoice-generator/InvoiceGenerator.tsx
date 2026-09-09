"use client";

import { useState } from "react";

type LineItem = { desc: string; qty: string; price: string };

const emptyItem = (): LineItem => ({ desc: "", qty: "1", price: "" });

export default function InvoiceGenerator() {
  const [docType, setDocType] = useState<"invoice" | "contract">("invoice");
  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sellerName, setSellerName] = useState("");
  const [sellerInfo, setSellerInfo] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerInfo, setBuyerInfo] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);
  const [taxPercent, setTaxPercent] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState("ر.س");
  const [copied, setCopied] = useState(false);

  function updateItem(i: number, field: keyof LineItem, val: string) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: val } : it)));
  }

  const parsedItems = items
    .map((it) => ({
      desc: it.desc.trim(),
      qty: parseFloat(it.qty.replace(/,/g, ".")) || 0,
      price: parseFloat(it.price.replace(/,/g, ".")) || 0,
    }))
    .filter((it) => it.desc || it.price);

  const subtotal = parsedItems.reduce((s, it) => s + it.qty * it.price, 0);
  const taxRate = parseFloat(taxPercent.replace(/,/g, ".")) || 0;
  const taxAmount = (subtotal * taxRate) / 100;
  const total = subtotal + taxAmount;

  function fmt(n: number) {
    return n.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function handlePrint() {
    window.print();
  }

  async function copySummary() {
    const lines = [
      docType === "invoice" ? "فاتورة" : "عقد خدمة",
      docNumber ? `رقم: ${docNumber}` : null,
      docDate ? `التاريخ: ${docDate}` : null,
      sellerName ? `من: ${sellerName}` : null,
      buyerName ? `إلى: ${buyerName}` : null,
      `المجموع الفرعي: ${fmt(subtotal)} ${currency}`,
      taxRate > 0 ? `ضريبة (${taxRate}%): ${fmt(taxAmount)} ${currency}` : null,
      `الإجمالي: ${fmt(total)} ${currency}`,
    ].filter(Boolean) as string[];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  const hasContent = sellerName.trim() || buyerName.trim() || parsedItems.length > 0;

  return (
    <div className="space-y-8">
      <div className="print:hidden rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
        <h2 className="text-lg font-bold text-slate-900">بيانات المستند</h2>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setDocType("invoice")}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${
              docType === "invoice"
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            فاتورة
          </button>
          <button
            type="button"
            onClick={() => setDocType("contract")}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${
              docType === "contract"
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            عقد خدمة بسيط
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">رقم المستند</label>
            <input
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              placeholder="INV-001"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">التاريخ</label>
            <input
              type="date"
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">العملة</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="ر.س">ر.س (ريال سعودي)</option>
              <option value="د.إ">د.إ (درهم)</option>
              <option value="ج.م">ج.م (جنيه)</option>
              <option value="د.ك">د.ك (دينار)</option>
              <option value="USD">USD</option>
              <option value="TON">TON</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              {docType === "invoice" ? "البائع / المورد" : "مقدّم الخدمة"}
            </label>
            <input
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              placeholder="الاسم أو اسم الشركة"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
            <textarea
              value={sellerInfo}
              onChange={(e) => setSellerInfo(e.target.value)}
              rows={2}
              placeholder="العنوان، الجوال، البريد..."
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              {docType === "invoice" ? "المشتري / العميل" : "العميل"}
            </label>
            <input
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="الاسم أو اسم الشركة"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
            <textarea
              value={buyerInfo}
              onChange={(e) => setBuyerInfo(e.target.value)}
              rows={2}
              placeholder="العنوان، الجوال، البريد..."
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-700">البنود / الخدمات</label>
            <button
              type="button"
              onClick={() => setItems((p) => [...p, emptyItem()])}
              className="text-xs font-bold text-brand-600 hover:underline"
            >
              + إضافة بند
            </button>
          </div>
          {items.map((it, i) => (
            <div key={i} className="mb-2 grid gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-12">
              <input
                value={it.desc}
                onChange={(e) => updateItem(i, "desc", e.target.value)}
                placeholder="وصف البند أو الخدمة"
                className="sm:col-span-6 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                value={it.qty}
                onChange={(e) => updateItem(i, "qty", e.target.value)}
                placeholder="الكمية"
                className="sm:col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                value={it.price}
                onChange={(e) => updateItem(i, "price", e.target.value)}
                placeholder="السعر"
                className="sm:col-span-3 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))}
                  className="sm:col-span-1 text-xs text-red-500"
                >
                  حذف
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">نسبة الضريبة % (اختياري)</label>
            <input
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
              placeholder="15"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">ملاحظات / شروط</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={docType === "contract" ? "مدة التنفيذ، طريقة الدفع، شروط الإلغاء..." : "شروط الدفع، رقم التحويل..."}
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
            onClick={copySummary}
            disabled={!hasContent}
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {copied ? "تم النسخ ✓" : "نسخ الملخص"}
          </button>
        </div>
        <p className="text-xs text-slate-400 text-center">
          سيفتح مربع الطباعة — اختر «حفظ كـ PDF». النص العربي يظهر صحيحاً بفضل محرك المتصفح.
        </p>
      </div>

      {/* Preview + print target */}
      <div
        id="invoice-print-area"
        dir="rtl"
        className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none print:p-0"
      >
        <header className="border-b-2 border-slate-800 pb-4 mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              {docType === "invoice" ? "فاتورة" : "عقد خدمة"}
            </h1>
            {docNumber && <p className="mt-1 text-sm text-slate-600">رقم: {docNumber}</p>}
            {docDate && <p className="text-sm text-slate-600">التاريخ: {docDate}</p>}
          </div>
          <div className="text-left text-sm text-slate-500" dir="ltr">
            سوق تولز
          </div>
        </header>

        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500 mb-1">
              {docType === "invoice" ? "من" : "مقدّم الخدمة"}
            </p>
            <p className="font-bold text-slate-900">{sellerName || "—"}</p>
            {sellerInfo.trim() && (
              <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{sellerInfo}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-slate-500 mb-1">
              {docType === "invoice" ? "إلى" : "العميل"}
            </p>
            <p className="font-bold text-slate-900">{buyerName || "—"}</p>
            {buyerInfo.trim() && (
              <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{buyerInfo}</p>
            )}
          </div>
        </div>

        {docType === "contract" && (
          <p className="mb-4 text-sm leading-relaxed text-slate-700">
            اتفق الطرفان على أن يقدّم الطرف الأول الخدمات الموضحة أدناه للطرف الثاني مقابل المبالغ
            المذكورة، وفق الشروط الواردة في هذا المستند.
          </p>
        )}

        {parsedItems.length > 0 && (
          <div className="mb-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-slate-500">
                  <th className="py-2 text-right font-semibold">البند</th>
                  <th className="py-2 text-center font-semibold w-16">الكمية</th>
                  <th className="py-2 text-left font-semibold w-24">السعر</th>
                  <th className="py-2 text-left font-semibold w-28">المجموع</th>
                </tr>
              </thead>
              <tbody>
                {parsedItems.map((it, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 text-slate-900">{it.desc}</td>
                    <td className="py-2 text-center text-slate-700">{it.qty}</td>
                    <td className="py-2 text-left text-slate-700" dir="ltr">
                      {fmt(it.price)} {currency}
                    </td>
                    <td className="py-2 text-left font-medium text-slate-900" dir="ltr">
                      {fmt(it.qty * it.price)} {currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mb-6 flex flex-col items-end gap-1 text-sm">
          <div className="flex gap-8">
            <span className="text-slate-500">المجموع الفرعي</span>
            <span className="font-medium text-slate-900 w-32 text-left" dir="ltr">
              {fmt(subtotal)} {currency}
            </span>
          </div>
          {taxRate > 0 && (
            <div className="flex gap-8">
              <span className="text-slate-500">ضريبة ({taxRate}%)</span>
              <span className="font-medium text-slate-900 w-32 text-left" dir="ltr">
                {fmt(taxAmount)} {currency}
              </span>
            </div>
          )}
          <div className="flex gap-8 border-t border-slate-300 pt-2 mt-1">
            <span className="font-bold text-slate-900">الإجمالي</span>
            <span className="font-extrabold text-slate-900 w-32 text-left" dir="ltr">
              {fmt(total)} {currency}
            </span>
          </div>
        </div>

        {notes.trim() && (
          <section className="mb-6">
            <h2 className="text-sm font-bold text-slate-500 mb-2 border-b border-slate-200 pb-1">
              ملاحظات / شروط
            </h2>
            <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">{notes}</p>
          </section>
        )}

        {docType === "contract" && (
          <div className="mt-10 grid gap-8 sm:grid-cols-2 text-sm text-slate-600">
            <div>
              <p className="mb-8">توقيع مقدّم الخدمة</p>
              <div className="border-b border-slate-400 w-40" />
            </div>
            <div>
              <p className="mb-8">توقيع العميل</p>
              <div className="border-b border-slate-400 w-40" />
            </div>
          </div>
        )}

        {!hasContent && (
          <p className="text-center text-sm text-slate-400 py-12">
            املأ بيانات البائع أو العميل أو أضف بنداً لترى المعاينة.
          </p>
        )}
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #invoice-print-area,
          #invoice-print-area * {
            visibility: visible;
          }
          #invoice-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
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
