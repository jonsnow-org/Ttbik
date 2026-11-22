"use client";
// Owner panel, Models tab: (1) WHO can use each model — one clear switch per model, wired to the same access check the bot and the model picker use
// (src/lib/coderModels.ts modelUsableBy); (2) WHICH media engine makes image / speech / video for each model, with the live health of every Studio behind it
// (src/lib/mediaEngines.ts). Shared by the Nova UI and the telegram-ui screens. Server decides; the owner is checked on every call.
import { useCallback, useEffect, useState } from "react";
import { MESH_URL, MODEL_MESH } from "@/lib/meshNode";
import { Button, Caption, Cell, Input, Section, Select, Spinner, Switch } from "@telegram-apps/telegram-ui";

type Api = <T = any>(op: string, body?: Record<string, unknown>) => Promise<T>;
type Opt = { id: string; ar: string; en: string; hint: { ar: string; en: string } };
type Probe = { id: string; role: { ar: string; en: string }; ok: boolean; phase: string; detail: string; media?: { image: boolean; audio: boolean; video: boolean } };
type Line = { kind: "image" | "audio" | "video"; ar: string; en: string; studio: string };
type ModelMedia = { id: string; engine: string; options: Opt[]; lines: Line[]; studios: Probe[] };
type PhotoWeight = { modelId: string; displayName: string; sourceModel: string; modelRepo: string; endpoint: string; ready: boolean; phase: string; checkpointSha256: string | null; sourceRevision: string | null; memoryGb: number | null; detail: string };
type OwnerModel = { id: string; name: { ar: string; en: string }; price_stars: number | null; visible: boolean; isDefault: boolean; ready: boolean; access?: "everyone" | "owner_only" | "on_but_not_ready" };

const MESH_LABEL: Record<string, string> = { sham: "Sham 1", sham_v2: "Sham Pro", coder: "Nova" };
const ICON = { image: "🖼", audio: "🔊", video: "🎬" } as const;

export function accessText(m: OwnerModel, ar: boolean): string {
  const a = m.access || (m.visible ? (m.ready ? "everyone" : "on_but_not_ready") : "owner_only");
  if (a === "everyone") return ar ? "✅ متاح لجميع المستخدمين في البوت وفي التطبيق" : "✅ Visible to all users in the bot and the app";
  if (a === "on_but_not_ready") return ar ? "⚠️ مفعّل للجميع لكنه غير جاهز بعد (لا يوجد توكن الاستوديو)، لذلك لا يراه غيرك" : "⚠️ Switched on for everyone but not ready (no Studio token), so only you see it";
  return ar ? "🔒 مخفي: للمالك فقط الآن. غيرك لا يراه ولا يستطيع استخدامه" : "🔒 Owner only right now. Nobody else can see or pick it";
}

export default function OwnerModelsPanel({ ar, api, haptic, models, reload }: { ar: boolean; api: Api; haptic: (k: "success" | "error") => void; models: OwnerModel[]; reload: () => void | Promise<void> }) {
  const [media, setMedia] = useState<ModelMedia[] | null>(null);
  const [photoWeights, setPhotoWeights] = useState<PhotoWeight[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [meshOn, setMeshOn] = useState<boolean | null>(null);
  const [meshNodes, setMeshNodes] = useState<Record<string, number>>({});
  const [denyText, setDenyText] = useState("");
  const [denySaved, setDenySaved] = useState("");
  const name = (m: { id: string; name?: { ar: string; en: string } }) => (m.name && (ar ? m.name.ar : m.name.en)) || m.id;
  const mediaName = (id: string) => name(models.find((x) => x.id === id) || { id });
  const loadMedia = useCallback(async () => {
    setBusy("status");
    setErr("");
    try { const result = await api<{ models: ModelMedia[]; photoWeights?: PhotoWeight[] }>("media_status"); setMedia(result.models); setPhotoWeights(result.photoWeights || []); } catch (e: any) { setErr(String(e?.message || e)); }
    setBusy("");
  }, [api]);
  useEffect(() => { void loadMedia(); }, [loadMedia]);
  useEffect(() => { void api<{ policy?: { deny?: string[] } }>("tldm_policy", { for: "all" }).then((r) => {
    const d = (r.policy?.deny || []).join("\n");
    setDenyText(d); setDenySaved(d);
  }).catch(() => null); }, [api]);
  // the owner's ONE switch for users' devices in the terminal mesh (src/lib/meshPolicy.ts); users never see anything about it
  const loadMesh = useCallback(async () => {
    try { setMeshOn(Boolean((await api<{ on?: boolean }>("mesh_devices")).on)); } catch { setMeshOn(null); }
    const out: Record<string, number> = {};
    await Promise.all(Object.values(MODEL_MESH).map(async (mesh) => {
      try { const r = await fetch(`${MESH_URL}/m/${mesh}/health`, { cache: "no-store" }); out[mesh] = Number((await r.json()).nodes_online) || 0; } catch { out[mesh] = -1; }
    }));
    setMeshNodes(out);
  }, [api]);
  useEffect(() => { void loadMesh(); const id = setInterval(() => void loadMesh(), 20000); return () => clearInterval(id); }, [loadMesh]);
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
          ? "المفتاح يتحكم في ظهور النموذج لجميع المستخدمين في البوت وفي قائمة النماذج بالتطبيق معًا. أنت المالك تستخدم كل النماذج دائمًا حتى المخفية. إخفاء نوفا يوقف ردها على غيرك. النموذج غير الجاهز لا يظهر لغيرك حتى لو فعّلته. الأسعار في تبويب «التسعير»."
          : "The switch shows or hides the model for all users in the bot and in the app's model list together. You, the owner, always see every model. A model that is not ready stays hidden from others even when switched on. Prices are in the Pricing tab."}
      >
        {models.map((m) => (
          <div key={m.id}>
            <Cell Component="label" multiline subtitle={accessText(m, ar)}
              after={<Switch checked={Boolean(m.visible)} disabled={busy === "vis-" + m.id} onChange={(e) => void setVisible(m, e.currentTarget.checked)} />}>
              {ar ? `${name(m)}: ${m.visible ? "متاح لجميع المستخدمين" : "مخفي"}` : `${name(m)}: ${m.visible ? "available to all users" : "hidden"}`}
            </Cell>
          </div>
        ))}
      </Section>
      <Section
        header={ar ? "🕸 شبكة الأجهزة" : "🕸 Device mesh"}
        footer={ar
          ? "مفتاح واحد لكل المستخدمين، مطفأ افتراضيًا. عند تشغيله ينضم جهاز كل مستخدم أثناء فتح التطبيق إلى شبكة النموذج الذي اختاره فقط، بصمت ودون أي إشعار. الجهاز لا ينفّذ أوامر لأحد، يقدّم حوسبة قابلة للتحقق ودروسًا موثّقة فقط، ولا يشارك بيانات شخصية، وقائمة المنع تنطبق. عند إطفائه تغادر الأجهزة خلال نصف دقيقة."
          : "One switch for all users, off by default. When on, each user's device joins the mesh of the model they selected while the app is open, silently with no notice. A device never runs commands for anyone, offers only verifiable compute and verified lessons, shares no personal data, and the deny list applies. When off, devices leave within half a minute."}
      >
        <Cell Component="label" multiline
          subtitle={Object.entries(MODEL_MESH).map(([model, mesh]) => `${MESH_LABEL[model]}: ${meshNodes[mesh] === undefined ? "…" : meshNodes[mesh] < 0 ? "?" : meshNodes[mesh]}`).join(" · ")}
          after={<Switch checked={Boolean(meshOn)} disabled={meshOn === null || busy === "mesh"} onChange={async (e) => {
            const on = e.currentTarget.checked; setBusy("mesh"); setErr("");
            try { const r = await api<{ on?: boolean }>("mesh_devices", { on }); setMeshOn(Boolean(r.on)); haptic("success"); }
            catch (err: any) { setErr(String(err?.message || err)); haptic("error"); }
            setBusy(""); void loadMesh();
          }} />}>
          {ar ? (meshOn ? "أجهزة المستخدمين: مشاركة" : "أجهزة المستخدمين: متوقفة") : (meshOn ? "Users' devices: sharing" : "Users' devices: off")}
        </Cell>
      </Section>
      <Section
        header={ar ? "🛡 قائمة منع المالك (T-LDM)" : "🛡 Owner deny list (T-LDM)"}
        footer={ar
          ? "T-LDM يعمل تلقائيًا لجميع المستخدمين على شام برو ونوفا، كلٌّ برأسه المستقل، دون أي مفتاح. هذه القائمة هي الضمانة الوحيدة: كل أمر يطابق نمطًا فيها يُرفض عند الجميع ولا يمكن تجاوزه، وتنطبق كذلك على شبكة الأجهزة."
          : "T-LDM runs automatically for every user on Sham Pro and Nova, each with its own head, with no switch. This list is the one guarantee: any command matching a pattern here is refused for everybody and cannot be overridden; it also applies to the device mesh."}
      >
        <Input header={ar ? "قائمة منع المالك (سطر لكل نمط، أو re:تعبير). لا يمكن لأي مستخدم تجاوزها." : "Owner deny list (one pattern per line, or re:regex). Users cannot override it."}
          value={denyText} onChange={(e) => setDenyText(e.currentTarget.value)}
          after={<Button size="s" mode="bezeled" loading={busy === "tldm-deny"} disabled={denyText === denySaved} onClick={async () => {
            setBusy("tldm-deny"); setErr("");
            try { const r = await api<{ policy?: { deny?: string[] } }>("tldm_policy", { for: "all", deny: denyText }); const d = (r.policy?.deny || []).join("\n"); setDenyText(d); setDenySaved(d); haptic("success"); }
            catch (err: any) { setErr(String(err?.message || err)); haptic("error"); }
            setBusy("");
          }}>{ar ? "حفظ المنع" : "Save list"}</Button>} />
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
        <Section
          header={ar ? "🧬 أوزان الصور المستقلة لكل نموذج" : "🧬 Independent image weights for every model"}
          footer={ar ? "كل صف يربط النموذج باستوديوه ومستودع أوزانه الخاصين. لا يُقبل التوليد إلا عندما تكون الحالة جاهزة والمستودع وبصمة checkpoint مطابقين. لا يوجد تحويل تلقائي إلى نموذج آخر." : "Each row maps one selected model to its own private image Studio and weight repository. Generation is accepted only when the Studio is ready and its repository and checkpoint SHA-256 match. There is no automatic switch to another model."}
        >
          {!photoWeights.length && !err && <Cell before={<Spinner size="s" />}>{ar ? "جارٍ فحص أوزان الصور…" : "Checking image weights…"}</Cell>}
          {photoWeights.map((w) => {
            const memory = w.memoryGb == null ? "" : " · " + w.memoryGb.toFixed(2) + " GB RAM";
            const hash = w.checkpointSha256 ? w.checkpointSha256.slice(0, 12) + "…" : (ar ? "لا توجد بصمة" : "no checkpoint hash");
            const detail = w.detail ? " · " + w.detail : "";
            const subtitle = w.sourceModel + " · " + w.modelRepo + " · " + hash + memory + detail;
            const labels: Record<string, string> = { coder: "Nova", sham_v2: "Sham Pro" };
            return <Cell key={w.modelId} multiline after={w.ready ? "✅" : "❌"} subtitle={subtitle}>
              {(ar ? (labels[w.modelId] || w.displayName) : w.displayName) + " — " + (ar ? (w.ready ? "جاهز" : "غير جاهز") : w.phase)}
            </Cell>;
          })}
        </Section>
        <Cell><Button size="s" mode="bezeled" loading={busy === "status"} onClick={() => void loadMedia()}>{ar ? "🔄 افحص الآن" : "🔄 Check now"}</Button></Cell>
      </Section>
    </>
  );
}
