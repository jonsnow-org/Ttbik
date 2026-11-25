"use client";
// "Permissions & linked chats" (Telegram Business / Secretary mode): the user's OWN connections only. Shows whether the bot is linked to their account, the rights they
// granted in Telegram, WHO replies in their account (Nova or Sham Pro: changed here only, with an explicit confirmation; the chat's /model never changes it),
// their own instructions, the activity log (every reply with the model that wrote it), pause/resume, and forgetting the stored data. Unlinking is done in Telegram.
import { useCallback, useEffect, useState } from "react";
import { Button, Caption, Cell, Section, Spinner, Switch, Textarea } from "@telegram-apps/telegram-ui";
import { api } from "./parts";
import { haptic } from "../_tma/sdk";

type Name = { ar: string; en: string };
type Act = { at: string; chatId: string; model: string; dir: "in" | "own" | "out" | "skip" | "fail"; text: string; note: string };
type Conn = { id: string; enabled: boolean; model: string; rights: Record<string, boolean>; instructions: string; since: string | null; activity: Act[] };
type Data = { available: boolean; models: { id: string; name: Name }[]; rights: string[]; connections: Conn[] };

const RIGHT_AR: Record<string, string> = {
  can_reply: "الرد على الرسائل", can_read_messages: "تعليم الرسائل كمقروءة", can_delete_sent_messages: "حذف رسائل البوت", can_delete_all_messages: "حذف كل الرسائل",
  can_edit_name: "تعديل الاسم", can_edit_bio: "تعديل النبذة", can_edit_profile_photo: "تعديل الصورة", can_edit_username: "تعديل اسم المستخدم",
  can_change_gift_settings: "إعدادات الهدايا", can_view_gifts_and_stars: "رؤية الهدايا والنجوم", can_convert_gifts_to_stars: "تحويل الهدايا إلى نجوم",
  can_transfer_and_upgrade_gifts: "نقل الهدايا وترقيتها", can_transfer_stars: "تحويل النجوم", can_manage_stories: "إدارة القصص",
};
const USED = new Set(["can_reply", "can_read_messages"]);       // the only rights this bot uses today

export default function LinkedAccount({ ar }: { ar: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [pick, setPick] = useState<{ id: string; model: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try { setD(await api<Data>("biz")); setErr(""); } catch (e: any) { setErr(String(e?.message || e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setErr("");
    try { await api("biz_set", body); haptic("success"); setPick(null); await load(); } catch (e: any) { setErr(String(e?.message || e)); haptic("error"); }
    setBusy("");
  };
  const name = (id: string) => { const m = d?.models.find((x) => x.id === id); return m ? (ar ? m.name.ar : m.name.en) : id; };
  const when = (iso: string) => new Intl.DateTimeFormat(ar ? "ar-SY" : "en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  if (!d) return <Section>{err ? <Cell multiline before="⚠️">{err}</Cell> : <Cell before={<Spinner size="s" />}>{ar ? "جارٍ التحميل…" : "Loading…"}</Cell>}</Section>;
  const how = ar
    ? "للربط: إعدادات تيليجرام ← Telegram Business ← Chatbots (روبوتات المحادثة)، اكتب اسم هذا البوت، اختر المحادثات المسموح بها والصلاحيات. للفصل نهائيًا: من المكان نفسه."
    : "To link: Telegram Settings → Telegram Business → Chatbots, enter this bot's username, pick the allowed chats and rights. To unlink: same place.";
  return (
    <>
      {err && <Section><Cell multiline before="⚠️">{err}</Cell></Section>}
      {!d.available && <Section><Cell multiline before="ℹ️">{ar ? "ميزة الرد داخل حسابك غير مفعّلة حاليًا من المالك. يمكنك الربط، لكن لن يُرسل أي رد باسمك." : "Replying inside your account is switched off by the owner right now. You can link, but nothing will be sent on your behalf."}</Cell></Section>}
      {d.connections.length === 0 && (
        <Section header={ar ? "🔗 الحساب المرتبط" : "🔗 Linked account"} footer={how}>
          <Cell multiline>{ar ? "لم تربط هذا البوت بحسابك بعد." : "You have not linked this bot to your account yet."}</Cell>
        </Section>
      )}
      {d.connections.map((c) => (
        <div key={c.id}>
          <Section header={ar ? "🔗 الحساب المرتبط" : "🔗 Linked account"} footer={how}>
            <Cell multiline subtitle={c.since ? (ar ? "منذ " : "Since ") + when(c.since) : undefined}
              after={<Switch checked={c.enabled} disabled={busy === "en" + c.id} aria-label="enabled" onChange={(e) => void act("en" + c.id, { id: c.id, what: "enabled", on: e.currentTarget.checked })} />}>
              {c.enabled ? (ar ? "✅ متصل ويعمل" : "✅ Connected and active") : (ar ? "⏸ متوقف (لن يُرسل شيء)" : "⏸ Paused (nothing is sent)")}
            </Cell>
          </Section>
          <Section header={ar ? "🤖 من يردّ باسمك في حسابك" : "🤖 Who replies in your account"}
            footer={ar ? "هذا الاختيار مستقل عن نموذج المحادثة مع البوت: تبديل /model لا يغيّره. إن تعذّر على النموذج الرد لا يُرسل شيء ولا يُستخدم نموذج آخر." : "Independent of the chat model: /model never changes it. If the model cannot answer, nothing is sent and no other model is used."}>
            {d.models.map((m) => (
              <Cell key={m.id} Component="label" before={c.model === m.id ? "✓" : "○"} onClick={() => { if (m.id !== c.model) setPick({ id: c.id, model: m.id }); }}>{ar ? m.name.ar : m.name.en}</Cell>
            ))}
            {pick && pick.id === c.id && (
              <Cell multiline after={<Button size="s" loading={busy === "m" + c.id} onClick={() => void act("m" + c.id, { id: c.id, what: "model", model: pick.model, confirm: true })}>{ar ? "تأكيد" : "Confirm"}</Button>}>
                {ar ? `تأكيد: سيردّ ${name(pick.model)} بدل ${name(c.model)} على رسائل حسابك من الآن.` : `Confirm: ${name(pick.model)} will reply instead of ${name(c.model)} from now on.`}
                {" "}<Button size="s" mode="plain" onClick={() => setPick(null)}>{ar ? "إلغاء" : "Cancel"}</Button>
              </Cell>
            )}
          </Section>
          <Section header={ar ? "🛡 الصلاحيات الممنوحة (من تيليجرام)" : "🛡 Granted rights (from Telegram)"}
            footer={ar ? "تُغيَّر من إعدادات تيليجرام فقط. يستخدم البوت حاليًا صلاحيتي الرد وتعليم الرسائل كمقروءة، ويتحقق منهما قبل كل إجراء." : "Changed in Telegram settings only. The bot uses only Reply and Mark-as-read, checked before every action."}>
            {d.rights.filter((r) => c.rights[r] || USED.has(r)).map((r) => (
              <Cell key={r} before={c.rights[r] ? "✅" : "⛔"}>{ar ? RIGHT_AR[r] || r : r}</Cell>
            ))}
          </Section>
          <Section header={ar ? "📝 تعليماتك للرد" : "📝 Your reply instructions"} footer={ar ? "مثال: «قدّم الأسعار من القائمة، ولا تؤكد أي موعد قبل أن أوافق»." : "e.g. \"Quote prices from the list; never confirm an appointment before I approve.\""}>
            <Textarea value={draft[c.id] ?? c.instructions} onChange={(e) => setDraft({ ...draft, [c.id]: e.currentTarget.value })} placeholder={ar ? "اكتب تعليماتك هنا" : "Write your instructions"} />
            <Cell><Button size="s" mode="bezeled" loading={busy === "i" + c.id} onClick={() => void act("i" + c.id, { id: c.id, what: "instructions", text: draft[c.id] ?? c.instructions })}>{ar ? "حفظ" : "Save"}</Button></Cell>
          </Section>
          <Section header={ar ? "🧾 سجل النشاط" : "🧾 Activity log"}>
            {c.activity.length === 0 && <Cell>{ar ? "لا نشاط بعد." : "No activity yet."}</Cell>}
            {c.activity.map((a, i) => (
              <Cell key={i} multiline before={{ in: "📩", own: "👤", out: "📤", skip: "⏭", fail: "⚠️" }[a.dir]}
                subtitle={`${when(a.at)} · ${name(a.model)}${a.note ? " · " + a.note : ""}`}>
                {a.text || (ar ? "—" : "—")}
              </Cell>
            ))}
          </Section>
          <Section footer={ar ? "يحذف ما خزّناه عن هذا الربط وسجله. لإلغاء الربط نفسه استخدم إعدادات تيليجرام." : "Deletes what we stored about this link and its log. To unlink, use Telegram settings."}>
            <Cell><Button size="s" mode="bezeled" loading={busy === "f" + c.id} onClick={() => void act("f" + c.id, { id: c.id, what: "forget" })}>{ar ? "🗑 حذف بياناتي لهذا الربط" : "🗑 Delete my data for this link"}</Button></Cell>
            <Cell><Caption>{ar ? "يُعاد إنشاء الربط تلقائيًا عند وصول أي رسالة جديدة ما دام البوت مربوطًا في تيليجرام." : "The link is re-created automatically on the next message while the bot is still linked in Telegram."}</Caption></Cell>
          </Section>
        </div>
      ))}
      <Section><Cell><Button size="s" mode="bezeled" onClick={() => void load()}>{ar ? "🔄 تحديث" : "🔄 Refresh"}</Button></Cell></Section>
    </>
  );
}
