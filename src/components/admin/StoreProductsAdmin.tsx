"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoreProduct } from "@/types";

const EMPTY_FORM = {
  title_ar: "",
  affiliate_url: "",
  category: "عام",
  price_display: "",
  image_url: "",
  description_ar: "",
};

/**
 * Owner-only CRUD for /store's products -- no code change or redeploy
 * needed to add, edit, reorder or remove a product. Kept intentionally
 * simple (one flat list, inline edit) since this is expected to be used
 * by the owner and, per her plan, by the engineer working on promotion --
 * neither has direct database access, so this UI is the only way either
 * of them can manage real products.
 */
export default function StoreProductsAdmin() {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addBusy, setAddBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<StoreProduct>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/store-products");
      const data = await res.json();
      if (res.ok) setProducts(data.products || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addProduct() {
    setError(null);
    if (!addForm.title_ar.trim() || !addForm.affiliate_url.trim()) {
      setError("الاسم ورابط العمولة مطلوبان.");
      return;
    }
    setAddBusy(true);
    try {
      const res = await fetch("/api/admin/store-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "فشل الإضافة");
        return;
      }
      setAddForm(EMPTY_FORM);
      await load();
    } finally {
      setAddBusy(false);
    }
  }

  function startEdit(p: StoreProduct) {
    setEditingId(p.id);
    setEditForm({ ...p });
  }

  async function saveEdit(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/store-products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditingId(null);
        await load();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(p: StoreProduct) {
    setBusyId(p.id);
    try {
      await fetch(`/api/admin/store-products/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !p.is_active }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function removeProduct(id: string) {
    if (!confirm("حذف هذا المنتج نهائياً؟")) return;
    setBusyId(id);
    try {
      await fetch(`/api/admin/store-products/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="mb-3 text-sm font-bold text-emerald-800">🛍️ إدارة منتجات المتجر (/store)</p>

      <div className="mb-4 space-y-2 rounded-xl bg-white p-3">
        <p className="text-xs font-bold text-slate-600">إضافة منتج جديد</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            placeholder="اسم المنتج *"
            value={addForm.title_ar}
            onChange={(e) => setAddForm((f) => ({ ...f, title_ar: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            placeholder="رابط العمولة (affiliate) *"
            value={addForm.affiliate_url}
            onChange={(e) => setAddForm((f) => ({ ...f, affiliate_url: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            placeholder="القسم (مثال: إلكترونيات)"
            value={addForm.category}
            onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            placeholder="السعر المعروض (مثال: $25)"
            value={addForm.price_display}
            onChange={(e) => setAddForm((f) => ({ ...f, price_display: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            placeholder="رابط صورة المنتج"
            value={addForm.image_url}
            onChange={(e) => setAddForm((f) => ({ ...f, image_url: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
          />
          <textarea
            placeholder="وصف قصير"
            value={addForm.description_ar}
            onChange={(e) => setAddForm((f) => ({ ...f, description_ar: e.target.value }))}
            rows={2}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
          />
        </div>
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        <button
          disabled={addBusy}
          onClick={() => void addProduct()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {addBusy ? "جارٍ الإضافة..." : "+ إضافة المنتج"}
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">جارٍ التحميل...</p>
      ) : products.length === 0 ? (
        <p className="text-xs text-slate-500">لا توجد منتجات بعد.</p>
      ) : (
        <div className="space-y-2">
          {products.map((p) => (
            <div key={p.id} className="rounded-xl bg-white p-3">
              {editingId === p.id ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    value={editForm.title_ar ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, title_ar: e.target.value }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  />
                  <input
                    value={editForm.affiliate_url ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, affiliate_url: e.target.value }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  />
                  <input
                    value={editForm.category ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  />
                  <input
                    value={editForm.price_display ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, price_display: e.target.value }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  />
                  <input
                    value={editForm.image_url ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, image_url: e.target.value }))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs sm:col-span-2"
                  />
                  <input
                    type="number"
                    value={editForm.sort_order ?? 0}
                    onChange={(e) => setEditForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                    placeholder="ترتيب الظهور"
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={busyId === p.id}
                      onClick={() => void saveEdit(p.id)}
                      className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      حفظ
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-50">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-lg">🛍️</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold">{p.title_ar}</p>
                    <p className="text-[10px] text-slate-500">
                      {p.category} · ترتيب {p.sort_order} · {p.is_active ? "فعّال" : "معطّل"}
                    </p>
                  </div>
                  <button
                    onClick={() => startEdit(p)}
                    className="rounded-lg bg-sky-100 px-2 py-1 text-[10px] font-bold text-sky-700"
                  >
                    تعديل
                  </button>
                  <button
                    disabled={busyId === p.id}
                    onClick={() => void toggleActive(p)}
                    className="rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700 disabled:opacity-50"
                  >
                    {p.is_active ? "تعطيل" : "تفعيل"}
                  </button>
                  <button
                    disabled={busyId === p.id}
                    onClick={() => void removeProduct(p.id)}
                    className="rounded-lg bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-600 disabled:opacity-50"
                  >
                    حذف
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
