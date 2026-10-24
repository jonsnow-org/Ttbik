"use client";

import { useMemo, useState } from "react";

type Expense = { id: number; title: string; amount: number; payer: string; people: string[] };

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("ar", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);

export default function SharedCosts() {
  const [namesText, setNamesText] = useState("أحمد\nسارة\nمحمد");
  const [currency, setCurrency] = useState("TRY");
  const [title, setTitle] = useState("الفاتورة");
  const [amountText, setAmountText] = useState("300");
  const [payer, setPayer] = useState("أحمد");
  const [included, setIncluded] = useState<string[]>(["أحمد", "سارة", "محمد"]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [error, setError] = useState("");

  const people = useMemo(() => [...new Set(namesText.split(/[\n,،]+/).map((n) => n.trim()).filter(Boolean))], [namesText]);
  const validIncluded = included.filter((n) => people.includes(n));

  const result = useMemo(() => {
    const balances = new Map(people.map((p) => [p, 0]));
    for (const e of expenses) {
      balances.set(e.payer, (balances.get(e.payer) ?? 0) + e.amount);
      const share = e.amount / e.people.length;
      for (const person of e.people) balances.set(person, (balances.get(person) ?? 0) - share);
    }
    const creditors = [...balances].filter(([, n]) => n > 0.005).map(([name, amount]) => ({ name, amount })).sort((a,b) => b.amount-a.amount);
    const debtors = [...balances].filter(([, n]) => n < -0.005).map(([name, amount]) => ({ name, amount: -amount })).sort((a,b) => b.amount-a.amount);
    const transfers: { from: string; to: string; amount: number }[] = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(debtors[i].amount, creditors[j].amount);
      if (amount > 0.005) transfers.push({ from: debtors[i].name, to: creditors[j].name, amount });
      debtors[i].amount -= amount; creditors[j].amount -= amount;
      if (debtors[i].amount < 0.01) i++;
      if (creditors[j].amount < 0.01) j++;
    }
    return { balances: [...balances], transfers, total: expenses.reduce((s,e)=>s+e.amount,0) };
  }, [people, expenses]);

  function addExpense() {
    const amount = Number(amountText.replace(",", "."));
    if (!people.length) { setError("أضف أسماء المشاركين أولاً."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError("أدخل مبلغاً صحيحاً أكبر من صفر."); return; }
    if (!people.includes(payer)) { setError("اختر شخصاً من قائمة المشاركين دفع الفاتورة."); return; }
    if (!validIncluded.length) { setError("اختر شخصاً واحداً على الأقل لتقسيم هذه المصروفات عليه."); return; }
    setExpenses((old) => [...old, { id: Date.now(), title: title.trim() || "مصروف", amount, payer, people: validIncluded }]);
    setError("");
    setTitle("");
    setAmountText("");
  }

  async function shareSummary() {
    const lines = [
      "ملخص تقسيم المصاريف — شام AI",
      ...expenses.map((e) => `${e.title}: ${money(e.amount, currency)} — دفعها ${e.payer} — مقسمة على ${e.people.join("، ")}`),
      `الإجمالي: ${money(result.total, currency)}`,
      "التسوية المقترحة:",
      ...(result.transfers.length ? result.transfers.map((t) => `${t.from} يدفع إلى ${t.to}: ${money(t.amount, currency)}`) : ["لا توجد مبالغ مستحقة حالياً."]),
    ];
    const text = lines.join("\n");
    try {
      if (navigator.share) await navigator.share({ title: "تقسيم المصاريف", text });
      else { await navigator.clipboard.writeText(text); alert("نُسخ الملخص. يمكنك إرساله إلى المجموعة."); }
    } catch { /* Sharing can be cancelled by the user. */ }
  }

  return (
    <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" dir="rtl">
      <div>
        <label className="mb-2 block text-sm font-bold text-slate-800" htmlFor="shared-names">أسماء المشاركين — اسم في كل سطر</label>
        <textarea id="shared-names" value={namesText} onChange={(e)=>{setNamesText(e.target.value);setIncluded([]);setError("");}} rows={3} className="w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder={"أحمد\nسارة\nمحمد"} />
        <p className="mt-1 text-xs text-slate-500">يمكنك الفصل بين الأسماء بأسطر أو بفواصل. الأسماء لا تغادر متصفحك.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-bold" htmlFor="shared-currency">العملة</label>
          <select id="shared-currency" value={currency} onChange={(e)=>setCurrency(e.target.value)} className="w-full rounded-xl border border-slate-300 p-3">
            <option value="TRY">ليرة تركية (TRY)</option><option value="USD">دولار (USD)</option><option value="EUR">يورو (EUR)</option><option value="SAR">ريال سعودي (SAR)</option><option value="AED">درهم إماراتي (AED)</option><option value="EGP">جنيه مصري (EGP)</option><option value="SYP">ليرة سورية (SYP)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold" htmlFor="shared-title">اسم المصروف</label>
          <input id="shared-title" value={title} onChange={(e)=>setTitle(e.target.value)} className="w-full rounded-xl border border-slate-300 p-3" placeholder="غداء، فندق، بنزين..." />
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold" htmlFor="shared-amount">المبلغ</label>
          <input id="shared-amount" inputMode="decimal" value={amountText} onChange={(e)=>setAmountText(e.target.value)} className="w-full rounded-xl border border-slate-300 p-3" placeholder="300" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold" htmlFor="shared-payer">من دفع المبلغ؟</label>
          <select id="shared-payer" value={payer} onChange={(e)=>setPayer(e.target.value)} className="w-full rounded-xl border border-slate-300 p-3">
            {people.map((p)=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-bold">قسّم هذا المصروف بالتساوي على:</p>
        <div className="flex flex-wrap gap-2">
          {people.map((p)=><label key={p} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm ${validIncluded.includes(p)?"border-sky-600 bg-sky-50":"border-slate-200"}`}>
            <input type="checkbox" checked={validIncluded.includes(p)} onChange={(e)=>setIncluded((old)=>e.target.checked?[...old.filter(n=>n!==p),p]:old.filter(n=>n!==p))} />
            {p}
          </label>)}
        </div>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button type="button" onClick={addExpense} className="w-full rounded-xl bg-sky-700 px-4 py-3 font-bold text-white hover:bg-sky-800">＋ إضافة المصروف</button>

      {expenses.length > 0 && <>
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3"><h2 className="font-extrabold text-slate-900">المصاريف المضافة ({expenses.length})</h2><button type="button" onClick={()=>setExpenses([])} className="text-sm font-bold text-red-700">مسح الكل</button></div>
          <ul className="mt-3 divide-y divide-slate-200">
            {expenses.map((e)=><li key={e.id} className="flex items-start justify-between gap-3 py-3 text-sm"><div><p className="font-bold">{e.title}</p><p className="text-xs text-slate-500">دفعها {e.payer} · {e.people.length} مشاركين</p></div><div className="text-left font-bold" dir="ltr">{money(e.amount,currency)}<button type="button" onClick={()=>setExpenses(old=>old.filter(x=>x.id!==e.id))} className="mr-2 text-xs font-normal text-red-700">حذف</button></div></li>)}
          </ul>
          <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 font-extrabold"><span>الإجمالي</span><span>{money(result.total,currency)}</span></div>
        </div>
        <div>
          <h2 className="mb-3 text-lg font-extrabold">الرصيد النهائي لكل شخص</h2>
          <div className="grid gap-2 sm:grid-cols-2">{result.balances.map(([name,balance])=><div key={name} className="flex items-center justify-between rounded-xl border border-slate-200 p-3"><span className="font-bold">{name}</span><span className={`text-sm font-extrabold ${balance>0.005?"text-emerald-700":balance< -0.005?"text-red-700":"text-slate-500"}`}>{Math.abs(balance)<0.005?"متوازن":balance>0? `له ${money(balance,currency)}`:`عليه ${money(-balance,currency)}`}</span></div>)}</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="text-lg font-extrabold text-emerald-950">التسوية بأقل عدد من التحويلات</h2>
          <p className="mt-1 text-sm text-emerald-900">بدلاً من أن يحوّل الجميع للجميع، هذه اقتراحات لتصفية الأرصدة.</p>
          {result.transfers.length ? <ul className="mt-3 space-y-2">{result.transfers.map((t,i)=><li key={i} className="rounded-xl bg-white p-3 text-sm"><strong>{t.from}</strong> يدفع إلى <strong>{t.to}</strong> <span className="font-extrabold">{money(t.amount,currency)}</span></li>)}</ul>:<p className="mt-3 font-bold">لا توجد مبالغ مستحقة.</p>}
        </div>
        <button type="button" onClick={shareSummary} className="w-full rounded-xl border border-slate-300 px-4 py-3 font-bold text-slate-800 hover:bg-slate-50">مشاركة / نسخ ملخص المجموعة</button>
      </>}
      <p className="text-xs leading-6 text-slate-500">الأداة للحساب والتنظيم فقط؛ لا تنفّذ تحويلات مالية. تتم الحسابات محلياً في جهازك ولا تحفظ بيانات المجموعة على الخادم.</p>
    </section>
  );
}
