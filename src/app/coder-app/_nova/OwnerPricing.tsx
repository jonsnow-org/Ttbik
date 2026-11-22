"use client";
// Owner panel, "Pricing" tab: everything that costs money lives here and nowhere else — the plans (Stars price, period, shown price, on/off),
// the extra Stars price of each model, and assigning a plan to a user by hand. The server checks the owner on every call.
import { useCallback, useEffect, useState } from "react";
import { Button, Caption, Cell, Input, Section, Select, Spinner, Switch } from "@telegram-apps/telegram-ui";
import { STR, type Lang } from "../i18n";

type Api = <T = any>(op: string, body?: Record<string, unknown>) => Promise<T>;
type Plan = { id: string; name: { ar: string; en: string }; price_label: string; price_stars?: number | null; days?: number; active: boolean };
type Model = { id: string; name: { ar: string; en: string }; price_stars: number | null };

export default function OwnerPricing({ lang, api, haptic, models, reload }: { lang: Lang; api: Api; haptic: (k: "success" | "error") => void; models: Model[]; reload: () => void | Promise<void> }) {
  const t = STR[lang];
  const ar = lang === "ar";
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [assign, setAssign] = useState({ userId: "", planId: "plus", days: "30" });
  const load = useCallback(async () => {
    try { const b = await api<{ owner?: { plans: Plan[] } }>("billing"); setPlans(b.owner?.plans || []); setErr(""); } catch (e: any) { setErr(String(e?.message || e)); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const savePlan = async (id: string, patch: Record<string, unknown>) => {
    try { await api("plan_update", { id, ...patch }); haptic("success"); await load(); } catch (e: any) { setErr(String(e?.message || e)); haptic("error"); }
  };
  if (err && !plans) return <Section><Cell multiline before="⚠️">{err}</Cell></Section>;
  if (!plans) return <Section><Cell before={<Spinner size="s" />}>{ar ? "جارٍ التحميل…" : "Loading…"}</Cell></Section>;
  return (
    <>
      <Section header={`🏷️ ${t.ownerPricing}`} footer={ar ? "سعر الخطة بالنجوم ومدتها وما يظهر للمستخدم. إيقاف الخطة يخفيها عن الشراء." : "A plan's Stars price, period and shown price. Switching a plan off hides it from purchase."}>
        {err && <Cell multiline before="⚠️">{err}</Cell>}
        {plans.map((p) => (
          <div key={p.id}>
            <Cell Component="label" subtitle={<span dir="ltr">{p.id}</span>} after={<Switch checked={p.active} onChange={(e) => void savePlan(p.id, { active: e.currentTarget.checked })} />}>{p.name[lang]}</Cell>
            <Input header={`${t.starsPrice} ⭐`} dir="ltr" inputMode="numeric" defaultValue={p.price_stars ?? ""} onBlur={(e) => { const v = e.currentTarget.value.trim(); if (String(p.price_stars ?? "") !== v) void savePlan(p.id, { price_stars: v ? Number(v) : null }); }} />
            <Input header={t.periodDays} dir="ltr" inputMode="numeric" defaultValue={p.days ?? 30} onBlur={(e) => { const v = e.currentTarget.value; if (String(p.days ?? 30) !== v) void savePlan(p.id, { days: Number(v) || 30 }); }} />
            <Input header={t.priceLabel} defaultValue={p.price_label} onBlur={(e) => { const v = e.currentTarget.value; if (v !== p.price_label) void savePlan(p.id, { price_label: v }); }} />
          </div>
        ))}
      </Section>
      <Section header={ar ? "⭐ سعر إضافي لكل نموذج" : "⭐ Extra price per model"}
        footer={ar ? "فارغ = النموذج ضمن خطة المستخدم. رقم = يُدفع بالنجوم إضافة إلى الخطة." : "Empty = included in the user's plan. A number = charged in Stars on top of the plan."}>
        {models.map((m) => (
          <Input key={m.id} header={`${(ar ? m.name?.ar : m.name?.en) || m.id} ⭐`} type="number" dir="ltr" defaultValue={m.price_stars ?? ""}
            onBlur={async (e) => { try { await api("model_update", { id: m.id, price_stars: e.currentTarget.value }); haptic("success"); await reload(); } catch { haptic("error"); } }} />
        ))}
      </Section>
      <Section header={t.assignPlan}>
        <Input header={t.userId} dir="ltr" inputMode="numeric" value={assign.userId} onChange={(e) => setAssign({ ...assign, userId: e.target.value })} />
        <Select header={t.currentPlan} value={assign.planId} onChange={(e) => setAssign({ ...assign, planId: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name[lang]}</option>)}</Select>
        <Input header={t.planDays} dir="ltr" inputMode="numeric" value={assign.days} onChange={(e) => setAssign({ ...assign, days: e.target.value })} />
        <Cell><Button size="s" mode="bezeled" onClick={async () => { try { await api("plan_assign", assign); haptic("success"); setNote(t.saved); } catch (e: any) { haptic("error"); setNote(String(e?.message || e)); } }}>{t.assign}</Button></Cell>
        {note && <Cell multiline><Caption>{note}</Caption></Cell>}
      </Section>
    </>
  );
}
