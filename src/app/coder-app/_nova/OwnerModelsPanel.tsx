"use client";
// Owner panel (Settings): (1) WHO can use each model — one clear switch per model, wired to the same access check the bot and the model picker use
// (src/lib/coderModels.ts modelUsableBy); (2) WHICH media engine makes image / speech / video for each model, with the live health of every Studio behind it
// (src/lib/mediaEngines.ts). Shared by the Nova UI and the telegram-ui screens. Server decides; the owner is checked on every call.
import { useCallback, useEffect, useState } from "react";
import { Button, Caption, Cell, Input, Section, Select, Spinner, Switch } from "@telegram-apps/telegram-ui";

type Api = <T = any>(op: string, body?: Record<string, unknown>) => Promise<T>;
type Opt = { id: string; ar: string; en: string; hint: { ar: string; en: string } };
type Probe = { id: string; role: { ar: string; en: string }; ok: boolean; phase: string; detail: string };
type Line = { kind: "image" | "audio" | "video"; ar: string; en: string; studio: string };
type ModelMedia = { id: string; engine: string; options: Opt[]; lines: Line[]; studios: Probe[] };
type OwnerModel = { id: string; name: { ar: string; en: string }; price_stars: number | null; visible: boolean; isDefault: boolean; ready: boolean; access?: "everyone" | "owner_only" | "on_but_not_ready" };

const ICON = { image: "🖼", audio: "🔊", video: "🎬" } as const;

export function accessText(m: OwnerModel, ar: boolean): string {
  const a = m.access || (m.visible ? (m.ready ? "everyone" : "on_but_not_ready") : "owner_only");
  if (a === "everyone") return ar ? "✅ متاح لجميع المستخدمين في البوت وفي التطبيق" : "✅ Visible to all users in the bot and the app";
  if (a === "on_but_not_ready") return ar ? "⚠️ مفعّل للجميع لكنه غير جاهز بعد (لا يوجد توكن الاستوديو)، لذلك لا يراه غيرك" : "⚠️ Switched on for everyone but not ready (no Studio token), so only you see it";
  return ar ? "🔒 مخفي: للمالك فقط الآن. غيرك لا يراه ولا يستطيع استخدامه" : "🔒 Owner only right now. Nobody else can see or pick it";
}

export default function OwnerModelsPanel({ ar, api, haptic, models, reload }: { ar: boolean; api: Api; haptic: (k: "success" | "error") => void; models: OwnerModel[]; reload: () => void | Promise<void> }) {
  const [media, setMedia] = useState<ModelMedia[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const name = (m: { id: string; name?: { ar: string; en: string } }) => (m.name && (ar ? m.name.ar : m.name.en)) || m.id;
  const mediaName = (id: string) => name(models.find((x) => x.id === id) || { id });
  const loadMedia = useCallback(async () => {
    setBusy("status");
    setErr("");
    try { setMedia((await api<{ models: ModelMedia[] }>("media_status")).models); } catch (e: any) { setErr(String(e?.message || e)); }
    setBusy("");
  }, [api]);
  useEffect(() => { void loadMedia(); }, [loadMedia]);
  const setVisible = async (m: OwnerModel, visible: boolean) => {
    setBusy("vis-" + m.id);
    try { await api("model_update", { id: m.id, visible }); haptic("success"); await reload(); } catch (e: any) { setErr(String(e?.message || e)); haptic("error"); }
    setBusy("");
  };
  const pickEngine = async (model: string, engine: string) => {
    setBusy("eng-" + model);
    try { await api("media_engine", { model, engine }); haptic("success"); await loadMedia(); } catch (e: any) { setErr(String(e?.message || e)); haptic("error"); }
    setBusy("");
  };
  return (
    <>
      <Section
        header={ar ? "👁 من يستطيع استخدام كل نموذج؟" : "👁 Who can use each model?"}
        footer={ar
          ? "المفتاح يتحكم في ظهور النموذج لجميع المستخدمين في البوت وفي قائمة النماذج بالتطبيق معًا. أنت المالك تستخدم كل النماذج دائمًا حتى المخفية. إخفاء نوفا يوقف ردها على غيرك. النموذج غير الجاهز لا يظهر لغيرك حتى لو فعّلته. سعر النجوم: اتركه فارغًا ليكون النموذج ضمن خطة المستخدم، أو اكتب عددًا ليُدفع إضافة إلى الخطة."
          : "The switch shows or hides the model for all users in the bot and in the app's model list together. You, the owner, always see every model. A model that is not ready stays hidden from others even when switched on. Stars price: leave empty to include it in the user's plan, or enter an amount charged on top of the plan."}
      >
        {models.map((m) => (
          <div key={m.id}>
            <Cell Component="label" multiline subtitle={accessText(m, ar)}
              after={<Switch checked={Boolean(m.visible)} disabled={busy === "vis-" + m.id} onChange={(e) => void setVisible(m, e.currentTarget.checked)} />}>
              {ar ? `${name(m)}: ${m.visible ? "متاح لجميع المستخدمين" : "مخفي"}` : `${name(m)}: ${m.visible ? "available to all users" : "hidden"}`}
            </Cell>
            <Input header={ar ? `سعر النجوم الإضافي لـ ${name(m)} ⭐ (فارغ = ضمن الخطة)` : `Extra Stars price for ${name(m)} ⭐ (empty = in plan)`} type="number" dir="ltr" defaultValue={m.price_stars ?? ""}
              onBlur={async (e) => { try { await api("model_update", { id: m.id, price_stars: e.currentTarget.value }); haptic("success"); } catch { haptic("error"); } }} />
          </div>
        ))}
      </Section>
      <Section
        header={ar ? "🎨 ماذا يستخدم كل نموذج لتوليد الوسائط؟" : "🎨 What does each model use to make media?"}
        footer={ar
          ? "للقراءة والمتابعة: يبيّن لكل نموذج من أي استوديو تأتي صوره وصوته وفيديوه، وهل الاستوديو يعمل الآن. كل نموذج يستخدم استوديوهاته فقط، ونوفا منفصل تمامًا عن شام. لا يوجد تحويل صامت: إن فشل استوديو تظهر رسالة الفشل الحقيقية. الازدحام يُعالَج تلقائيًا بالطابور وبالاستوديو الاحتياطي لشام v2."
          : "Read-only status: for each model, which Studio makes its images, speech and video, and whether that Studio is alive now. Each model uses only its own Studios; Nova is fully separate from Sham. No silent switching: when a Studio fails, the real error is shown. Congestion is handled by the queue and Sham v2's overflow Studio."}
      >
        {!media && !err && <Cell before={<Spinner size="s" />}>{ar ? "جارٍ فحص الاستوديوهات…" : "Checking the Studios…"}</Cell>}
        {err && <Cell multiline before="⚠️">{err}</Cell>}
        {(media || []).map((mm) => (
          <div key={mm.id}>
            <Cell multiline subtitle={mm.id === "coder" ? (ar ? "ثابت، لا يوجد ما يُختار" : "Fixed, nothing to choose") : undefined}><b>{mediaName(mm.id)}</b></Cell>
            {mm.options.length > 0 && (
              <Select header={ar ? "محرك الوسائط لهذا النموذج" : "Media engine for this model"} value={mm.engine} disabled={busy === "eng-" + mm.id} onChange={(e) => void pickEngine(mm.id, e.target.value)}>
                {mm.options.map((o) => <option key={o.id} value={o.id}>{ar ? o.ar : o.en}</option>)}
              </Select>
            )}
            {mm.options.length > 0 && <Cell multiline><Caption>{(() => { const o = mm.options.find((x) => x.id === mm.engine); return o ? (ar ? o.hint.ar : o.hint.en) : ""; })()}</Caption></Cell>}
            {mm.lines.map((l) => <Cell key={l.kind} multiline before={ICON[l.kind]} subtitle={l.studio}>{ar ? l.ar : l.en}</Cell>)}
            {mm.studios.map((s) => (
              <Cell key={s.id} multiline after={s.ok ? "✅" : "❌"} subtitle={`${s.id}${s.ok ? "" : ` — ${s.phase}${s.detail ? ` · ${s.detail}` : ""}`}`}>{ar ? s.role.ar : s.role.en}</Cell>
            ))}
          </div>
        ))}
        <Cell><Button size="s" mode="bezeled" loading={busy === "status"} onClick={() => void loadMedia()}>{ar ? "🔄 افحص الآن" : "🔄 Check now"}</Button></Cell>
      </Section>
    </>
  );
}
