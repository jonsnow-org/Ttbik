"use client";
// Owner panel, Telegram tab: switches for the new Telegram bot features (Bot API 10.x). Each one is a real switch: on Telegram's side (setMySettings, read back with getMe)
// or in our own stored settings. Every change is sent at once and shows Telegram's real answer, including a refusal. Defaults are off, except rich messages for the owner.
import { useCallback, useEffect, useState } from "react";
import { Button, Caption, Cell, Section, Select, Spinner, Switch } from "@telegram-apps/telegram-ui";

type Api = <T = any>(op: string, body?: Record<string, unknown>) => Promise<T>;
type Info = { username: string; guest: boolean; topics: boolean; usersCreateTopics: boolean; sidebar: boolean; business?: boolean };
type State = { rich: string; guestMode: string; businessMode?: string; info: Info | null; invite: string; error: string };

export default function OwnerTelegram({ ar, api, haptic }: { ar: boolean; api: Api; haptic: (k: "success" | "error") => void }) {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try { setS(await api<State>("tg_features")); setErr(""); } catch (e: any) { setErr(String(e?.message || e)); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const set = async (key: string, value: unknown) => {
    setBusy(key); setErr("");
    try { await api("tg_set", { key, value }); haptic("success"); await load(); } catch (e: any) { setErr(String(e?.message || e)); haptic("error"); }
    setBusy("");
  };
  const aud = (v: string) => ({ off: ar ? "مُطفأ" : "Off", owner: ar ? "للمالك فقط" : "Owner only", all: ar ? "للجميع" : "Everyone" } as Record<string, string>)[v] || v;
  if (!s) return <Section>{err ? <Cell multiline before="⚠️">{err}</Cell> : <Cell before={<Spinner size="s" />}>{ar ? "جارٍ القراءة من تيليجرام…" : "Reading from Telegram…"}</Cell>}</Section>;
  const i = s.info;
  return (
    <>
      {(err || s.error) && <Section><Cell multiline before="⚠️">{err || s.error}</Cell></Section>}
      <Section header={ar ? "📝 الرسائل الغنية" : "📝 Rich messages"}
        footer={ar ? "الإجابة الطويلة (فوق 4096 حرفًا) والجداول تُرسل رسالة واحدة بتنسيق Markdown كامل مع اتجاه عربي صحيح وبثّ مباشر وزر إيقاف أصلي. عند أي رفض من تيليجرام يعود البوت تلقائيًا للطريقة القديمة."
          : "Long answers (over 4096 characters) and tables go out as ONE message with full Markdown, correct RTL, live streaming and the native Stop button. If Telegram refuses, the bot falls back to the old way."}>
        <Select header={ar ? "من يحصل عليها" : "Who gets it"} value={s.rich} disabled={busy === "rich"} onChange={(e) => void set("rich", e.target.value)}>
          {["off", "owner", "all"].map((v) => <option key={v} value={v}>{aud(v)}</option>)}
        </Select>
      </Section>
      <Section header={ar ? "🧵 وضع المواضيع في المحادثة الخاصة" : "🧵 Topics in private chats"}
        footer={ar ? "يحوّل محادثة البوت إلى مواضيع. يردّ البوت داخل الموضوع الذي كُتب فيه. تشترك المواضيع في ذاكرة المحادثة نفسها (الفصل بين ذاكرة موضوع وآخر غير مُفعَّل)."
          : "Turns the bot chat into topics. The bot answers inside the topic it was written in. Topics share the chat's memory (per-topic memory is not separated)."}>
        <Cell Component="label" after={<Switch checked={Boolean(i?.topics)} disabled={!i || busy === "has_topics_enabled"} onChange={(e) => void set("has_topics_enabled", e.currentTarget.checked)} />}>{ar ? "تفعيل المواضيع" : "Enable topics"}</Cell>
        <Cell Component="label" after={<Switch checked={Boolean(i?.usersCreateTopics)} disabled={!i?.topics || busy === "allows_users_to_create_topics"} onChange={(e) => void set("allows_users_to_create_topics", e.currentTarget.checked)} />}>{ar ? "السماح للمستخدمين بإنشاء مواضيع" : "Let users create topics"}</Cell>
        <Cell Component="label" after={<Switch checked={Boolean(i?.sidebar)} disabled={!i?.topics || busy === "has_topic_sidebar"} onChange={(e) => void set("has_topic_sidebar", e.currentTarget.checked)} />}>{ar ? "عرض المواضيع في شريط جانبي" : "Show topics in a sidebar"}</Cell>
      </Section>
      <Section header={ar ? "👻 وضع الضيف" : "👻 Guest mode"}
        footer={ar ? "إذا ذكر أحدٌ البوت في محادثة ليس فيها يردّ ردًّا قصيرًا واحدًا (بلا أدوات ولا ذاكرة ولا حسابات ولا ملفات). الرد ظاهر لكل من في تلك المحادثة، وحدّ المستخدم ستة أسئلة في الساعة. «للمالك فقط» يردّ عليك أنت وحدك. المفتاح يفتح الإعداد عند تيليجرام والمعالجة عندنا معًا."
          : "When someone mentions the bot in a chat it is not in, it gives ONE short reply (no tools, memory, accounts or files). Everyone in that chat sees it; six questions an hour per user. 'Owner only' answers you alone. One switch sets both Telegram's setting and our handler."}>
        <Select header={ar ? "من يُجاب" : "Who is answered"} value={s.guestMode} disabled={!i || busy === "guest"} onChange={(e) => void set("guest", e.target.value)}>
          {["off", "owner", "all"].map((v) => <option key={v} value={v}>{aud(v)}</option>)}
        </Select>
        <Cell><Caption>{ar ? `عند تيليجرام الآن: ${i?.guest ? "مفتوح" : "مغلق"}` : `On Telegram now: ${i?.guest ? "open" : "closed"}`}</Caption></Cell>
      </Section>
      <Section header={ar ? "💼 الرد داخل حساب المستخدم (Telegram Business)" : "💼 Replies inside the user's account (Telegram Business)"}
        footer={ar ? "يربط المستخدم البوت بحسابه من إعدادات تيليجرام ويختار المحادثات والصلاحيات، ويختار من التطبيق المصغّر من يردّ باسمه: نوفا أو شام برو. كل رد يُسجَّل باسم النموذج، ولا تحويل لنموذج آخر عند الفشل، وقائمة الحظر تُطبَّق على الجميع. يجب أيضًا تفعيل Secretary Mode للبوت يدويًا من @BotFather."
          : "The user links the bot in Telegram settings (chats + rights) and picks in the Mini App who replies for them: Nova or Sham Pro. Every reply is logged with its model, no fallback to another model, the deny-list applies to everyone. Secretary Mode must also be enabled manually in @BotFather."}>
        <Select header={ar ? "من يُسمح له" : "Who may use it"} value={s.businessMode || "off"} disabled={busy === "business"} onChange={(e) => void set("business", e.target.value)}>
          {["off", "owner", "all"].map((v) => <option key={v} value={v}>{aud(v)}</option>)}
        </Select>
        <Cell><Caption>{ar ? `عند تيليجرام الآن (Secretary Mode): ${i?.business ? "مفعّل" : "غير مفعّل — فعّله من @BotFather"}` : `On Telegram now (Secretary Mode): ${i?.business ? "enabled" : "disabled — enable it in @BotFather"}`}</Caption></Cell>
      </Section>
      <Section header={ar ? "🎟 دعوة 10 أشخاص دفعة واحدة" : "🎟 Invite up to 10 people at once"}
        footer={ar ? "افتح الرابط من حسابك واختر حتى عشرة أشخاص: يُنشأ لهم محادثة مع البوت ويستطيع البوت مراسلتهم. مفيد للترويج." : "Open the link from your account and pick up to ten people: a private chat with the bot is created and the bot can write to them. Useful for promotion."}>
        {s.invite
          ? <Cell multiline subtitle={<span dir="ltr">{s.invite}</span>} after={<Button size="s" mode="bezeled" onClick={() => { try { void navigator.clipboard.writeText(s.invite); haptic("success"); } catch { haptic("error"); } }}>{ar ? "نسخ" : "Copy"}</Button>}>{ar ? "رابط الدعوة" : "Invite link"}</Cell>
          : <Cell multiline>{ar ? "اسم المستخدم غير معروف (تعذّر القراءة من تيليجرام)." : "Username unknown (could not read from Telegram)."}</Cell>}
      </Section>
      <Section><Cell><Button size="s" mode="bezeled" onClick={() => void load()}>{ar ? "🔄 اقرأ من تيليجرام" : "🔄 Read from Telegram"}</Button></Cell></Section>
    </>
  );
}
