"use client";
// Owner panel → Promotion supervisor (src/lib/promoSupervisor.ts). Our projects and their links; the groups the bot is a member of (registered when the bot is added,
// DISABLED until the owner confirms the group's rules allow links); cadence / daily limit / quiet hours per group; a preview that sends nothing; the full log.
// Posts are always sent BY THE BOT inside groups it belongs to — never by the owner's personal account (Telegram Business only reaches private chats).
import { useCallback, useEffect, useState } from "react";
import { Button, Caption, Cell, Input, Section, Select, Spinner, Switch, Textarea } from "@telegram-apps/telegram-ui";

type Api = <T = any>(op: string, body?: Record<string, unknown>) => Promise<T>;
type Project = { id: number; title: string; link: string; pitch: string; enabled: boolean };
type Target = { chatId: string; title: string; username: string; type: string; status: string; allowLinks: boolean; enabled: boolean; cadenceH: number; maxPerDay: number; quietFrom: number; quietTo: number; lastPostAt: string | null; nextAt: string | null; note: string; addedBy: string };
type Log = { at: string; chatId: string; projectId: number | null; status: string; text: string; note: string; composer: string };
type Data = { on: string; projects: Project[]; targets: Target[]; log: Log[]; limits: { minCadenceH: number; maxCadenceH: number; maxPerDayCap: number } };

export default function OwnerPromo({ ar, api, haptic }: { ar: boolean; api: Api; haptic: (k: "success" | "error") => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [np, setNp] = useState({ title: "", link: "", pitch: "" });
  const [sugg, setSugg] = useState<{ title: string; link: string; template: string }[] | null>(null);
  const [prev, setPrev] = useState<{ chatId: string; text: string; composer: string } | null>(null);
  const load = useCallback(async () => {
    try { setD(await api<Data>("promo")); setErr(""); } catch (e: any) { setErr(String(e?.message || e)); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const act = async (key: string, body: Record<string, unknown>, after?: (r: any) => void) => {
    setBusy(key); setErr("");
    try { const r = await api("promo_set", body); haptic("success"); after?.(r); await load(); } catch (e: any) { setErr(String(e?.message || e)); haptic("error"); }
    setBusy("");
  };
  const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat(ar ? "ar-SY" : "en-GB", { timeZone: "Europe/Istanbul", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) + " TRT" : "—");
  if (!d) return <Section>{err ? <Cell multiline before="⚠️">{err}</Cell> : <Cell before={<Spinner size="s" />}>{ar ? "جارٍ التحميل…" : "Loading…"}</Cell>}</Section>;
  const title = (id: number | null) => d.projects.find((p) => p.id === id)?.title || "—";
  const group = (id: string) => d.targets.find((t) => t.chatId === id)?.title || id;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const STATUS: Record<string, string> = ar ? { sent: "نُشر", skip: "تخطٍّ", fail: "فشل", info: "معلومة" } : { sent: "sent", skip: "skipped", fail: "failed", info: "info" };
  return (
    <>
      {err && <Section><Cell multiline before="⚠️">{err}</Cell></Section>}
      <Section header={ar ? "📣 مشرف الترويج" : "📣 Promotion supervisor"}
        footer={ar ? "ينشر البوت نفسه (لا حسابك الشخصي) رسائل ترويج قصيرة متنوعة لمشاريعنا في المجموعات التي هو عضو فيها فقط، وبعد تأكيدك أن قوانين كل مجموعة تسمح بالروابط. رسالة واحدة كل دورة على الأكثر، وفاصل 15 دقيقة بين أي منشورين، وحدّ يومي، وساعات هدوء، ولا يتكرر المشروع في المجموعة نفسها خلال 7 أيام. ربط Telegram Business لا يصل إلى المجموعات أصلًا."
          : "The bot itself (never your personal account) posts short, varied promos for our projects ONLY in groups it is a member of, after you confirm each group's rules allow links. At most one post per tick, 15 min between any two posts, a daily cap, quiet hours, and no project repeated in the same group within 7 days. Telegram Business cannot reach groups at all."}>
        <Select header={ar ? "الحالة" : "Status"} value={d.on} disabled={busy === "switch"} onChange={(e) => void act("switch", { what: "switch", value: e.target.value })}>
          <option value="off">{ar ? "مُطفأ" : "Off"}</option>
          <option value="owner">{ar ? "مُفعّل (للمالك فقط)" : "On (owner only)"}</option>
        </Select>
      </Section>

      <Section header={ar ? "🧩 مشاريعنا وروابطها" : "🧩 Our projects & links"}>
        {d.projects.length === 0 && <Cell multiline>{ar ? "لا مشاريع بعد. أضف بوت الوظائف والمتجر مثلًا، أو اقرأ بوتاتنا تلقائيًا." : "No projects yet. Add e.g. the jobs bot and the store, or read our bots automatically."}</Cell>}
        {d.projects.map((p) => (
          <Cell key={p.id} multiline subtitle={<span dir="ltr">{p.link}</span>} description={p.pitch || undefined}
            after={<span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <Switch checked={p.enabled} disabled={busy === `p${p.id}`} onChange={(e) => void act(`p${p.id}`, { what: "project_update", id: p.id, enabled: e.currentTarget.checked })} />
              <Button size="s" mode="plain" disabled={busy === `pd${p.id}`} onClick={() => void act(`pd${p.id}`, { what: "project_delete", id: p.id })}>🗑</Button>
            </span>}>{p.title}</Cell>
        ))}
        <Input header={ar ? "الاسم" : "Name"} placeholder={ar ? "بوت فرص العمل" : "Jobs bot"} value={np.title} onChange={(e) => setNp({ ...np, title: e.target.value })} />
        <Input header={ar ? "الرابط" : "Link"} placeholder="@JobsBot / https://t.me/…" value={np.link} onChange={(e) => setNp({ ...np, link: e.target.value })} />
        <Textarea header={ar ? "ماذا يقدّم (يساعد في صياغة الرسائل)" : "What it offers (helps write the posts)"} value={np.pitch} onChange={(e) => setNp({ ...np, pitch: e.target.value })} />
        <Cell>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="s" loading={busy === "add"} disabled={!np.title || !np.link} onClick={() => void act("add", { what: "project_add", ...np }, () => setNp({ title: "", link: "", pitch: "" }))}>{ar ? "➕ إضافة" : "➕ Add"}</Button>
            <Button size="s" mode="bezeled" loading={busy === "suggest"} onClick={() => void act("suggest", { what: "suggest" }, (r) => setSugg(r.suggestions || []))}>{ar ? "🤖 اقرأ بوتاتنا" : "🤖 Read our bots"}</Button>
          </span>
        </Cell>
        {sugg && (sugg.length === 0
          ? <Cell multiline><Caption>{ar ? "لا بوتات جديدة لإضافتها." : "No new bots to add."}</Caption></Cell>
          : sugg.map((s) => <Cell key={s.link} subtitle={<span dir="ltr">{s.link} · {s.template}</span>}
              after={<Button size="s" mode="bezeled" onClick={() => void act(`s${s.link}`, { what: "project_add", title: s.title, link: s.link, pitch: "" }, () => setSugg(sugg.filter((x) => x.link !== s.link)))}>➕</Button>}>{s.title}</Cell>))}
      </Section>

      <Section header={ar ? "👥 المجموعات المستهدفة" : "👥 Target groups"}
        footer={ar ? "تظهر المجموعة هنا تلقائيًا عند إضافة البوت إليها، مُعطّلة. فعّلها فقط بعد التأكد من أن قوانينها تسمح بنشر الروابط. إن كان وصف المجموعة يمنع الروابط أو أُخرج البوت منها يُوقف النشر فيها تلقائيًا ويُبلغك."
          : "A group appears here automatically when the bot is added to it, disabled. Enable it only after checking its rules allow links. If its description forbids links or the bot is removed, posting there stops automatically and you are told."}>
        {d.targets.length === 0 && <Cell multiline>{ar ? "لا مجموعات بعد. أضف البوت إلى مجموعة عامة تسمح بالروابط (عضوًا أو مشرفًا)." : "No groups yet. Add the bot to a public group that allows links (as a member or admin)."}</Cell>}
        {d.targets.map((t) => (
          <div key={t.chatId}>
            <Cell multiline subtitle={`${t.username ? "@" + t.username + " · " : ""}${t.type} · ${t.status}`} description={t.note || (ar ? `آخر نشر: ${when(t.lastPostAt)} · التالي: ${when(t.nextAt)}` : `Last: ${when(t.lastPostAt)} · Next: ${when(t.nextAt)}`)}>{t.title || t.chatId}</Cell>
            <Cell Component="label" after={<Switch checked={t.allowLinks} disabled={busy === `l${t.chatId}`} onChange={(e) => void act(`l${t.chatId}`, { what: "target_update", chatId: t.chatId, allowLinks: e.currentTarget.checked, ...(e.currentTarget.checked ? {} : { enabled: false }) })} />}>{ar ? "أكّدتُ أن قوانينها تسمح بالروابط" : "I confirmed its rules allow links"}</Cell>
            <Cell Component="label" after={<Switch checked={t.enabled} disabled={!t.allowLinks || busy === `e${t.chatId}`} onChange={(e) => void act(`e${t.chatId}`, { what: "target_update", chatId: t.chatId, enabled: e.currentTarget.checked })} />}>{ar ? "النشر فيها مُفعّل" : "Posting enabled"}</Cell>
            <Select header={ar ? "كل كم ساعة" : "Every (hours)"} value={String(t.cadenceH)} onChange={(e) => void act(`c${t.chatId}`, { what: "target_update", chatId: t.chatId, cadenceH: Number(e.target.value) })}>
              {[6, 12, 24, 48, 72, 168].map((h) => <option key={h} value={h}>{h}</option>)}
            </Select>
            <Select header={ar ? "حدّ يومي" : "Daily limit"} value={String(t.maxPerDay)} onChange={(e) => void act(`m${t.chatId}`, { what: "target_update", chatId: t.chatId, maxPerDay: Number(e.target.value) })}>
              {Array.from({ length: d.limits.maxPerDayCap }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            <Select header={ar ? "هدوء من (TRT)" : "Quiet from (TRT)"} value={String(t.quietFrom)} onChange={(e) => void act(`qf${t.chatId}`, { what: "target_update", chatId: t.chatId, quietFrom: Number(e.target.value) })}>
              {hours.map((h) => <option key={h} value={h}>{h}:00</option>)}
            </Select>
            <Select header={ar ? "هدوء حتى (TRT)" : "Quiet until (TRT)"} value={String(t.quietTo)} onChange={(e) => void act(`qt${t.chatId}`, { what: "target_update", chatId: t.chatId, quietTo: Number(e.target.value) })}>
              {hours.map((h) => <option key={h} value={h}>{h}:00</option>)}
            </Select>
            <Cell>
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button size="s" mode="bezeled" loading={busy === `v${t.chatId}`} onClick={() => void act(`v${t.chatId}`, { what: "verify", chatId: t.chatId }, (r) => setErr(r.ok ? "" : String(r.note || "")))}>{ar ? "🔎 تحقّق من تيليجرام" : "🔎 Check with Telegram"}</Button>
                {d.projects[0] && <Button size="s" mode="bezeled" loading={busy === `pv${t.chatId}`} onClick={() => void act(`pv${t.chatId}`, { what: "preview", chatId: t.chatId, projectId: d.projects.find((p) => p.enabled)?.id ?? d.projects[0].id }, (r) => setPrev({ chatId: t.chatId, text: r.text, composer: r.composer }))}>{ar ? "👁 معاينة (لا تُرسل)" : "👁 Preview (not sent)"}</Button>}
                <Button size="s" mode="plain" loading={busy === `d${t.chatId}`} onClick={() => void act(`d${t.chatId}`, { what: "target_delete", chatId: t.chatId })}>🗑</Button>
              </span>
            </Cell>
            {prev?.chatId === t.chatId && <Cell multiline subtitle={prev.composer === "nova" ? (ar ? "كتبها نوفا" : "Written by Nova") : (ar ? "قالب جاهز" : "Template")}><span style={{ whiteSpace: "pre-wrap" }}>{prev.text || (ar ? "لا نص جديد متاح" : "No fresh text")}</span></Cell>}
          </div>
        ))}
      </Section>

      <Section header={ar ? "🧾 السجل" : "🧾 Log"}>
        {d.log.length === 0 && <Cell>{ar ? "لا شيء بعد." : "Nothing yet."}</Cell>}
        {d.log.map((l, i) => (
          <Cell key={i} multiline subtitle={`${when(l.at)} · ${group(l.chatId)}${l.projectId ? " · " + title(l.projectId) : ""}${l.composer ? " · " + l.composer : ""}`} description={l.note || undefined}>
            {`${STATUS[l.status] || l.status}${l.text ? ": " + l.text.slice(0, 160) : ""}`}
          </Cell>
        ))}
        <Cell><Button size="s" mode="bezeled" onClick={() => void load()}>{ar ? "🔄 تحديث" : "🔄 Refresh"}</Button></Cell>
      </Section>
    </>
  );
}
