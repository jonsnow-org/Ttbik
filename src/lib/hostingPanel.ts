// The owner's «🌐 الاستضافة» panel in the Athar bot: see both servers, switch the gate, move the bots' webhooks, move the settings to Oracle.
// Owner-only (the caller checks). Texts are Arabic with short English. See docs/HOSTING.md.
import { InlineKeyboard, type Bot as TelegramBot } from "grammy";
import { HOSTING, MODES, gateState, gateUrl, openEnvWindow, probeOrigin, rehookBots, setGateMode, type Mode } from "@/lib/hostingOps";

const MODE_NAME: Record<Mode, string> = { auto: "تلقائي (Oracle أولاً ثم Vercel)", oracle: "Oracle فقط", vercel: "Vercel فقط (الاحتياطي)" };
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16) + " UTC";
const mark = (p: { ok: boolean; ms: number; status: number }) => (p.ok ? `✅ ${p.ms}ms` : `❌ ${p.status || "لا اتصال"}`);

export function panelKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔁 تلقائي", "hg:auto").text("🖥 Oracle فقط", "hg:oracle").text("☁️ Vercel فقط", "hg:vercel").row()
    .text("🔗 نقل الويبهوكات إلى البوابة", "hg:hooks").row()
    .text("📥 نقل الإعدادات إلى Oracle", "hg:env").row()
    .text("🔄 تحديث الحالة", "hg:refresh");
}

export async function panelText(): Promise<string> {
  const [gate, oracle, vercel] = await Promise.all([gateState(), probeOrigin(HOSTING.oracleUrl), probeOrigin(HOSTING.vercelUrl)]);
  const lines = ["🌐 الاستضافة · Hosting", ""];
  if (!gate) lines.push("البوابة: ❌ لا ترد (قد لا تكون نُشرت بعد)");
  else {
    const pinned = gate.mode !== "auto" && gate.until > Date.now();
    lines.push(`البوابة: ✅ · الوضع: ${MODE_NAME[gate.mode]}${pinned ? ` حتى ${hhmm(gate.until)}` : ""}`);
    if (gate.downUntil > Date.now()) lines.push("⚠️ Oracle فشل قبل لحظات، والبوابة تخدم من Vercel مؤقتاً.");
  }
  lines.push(`Oracle: ${mark(oracle)}`, `Vercel: ${mark(vercel)}`, "");
  lines.push("التثبيت على خادم يعود إلى «تلقائي» بعد 12 ساعة وحده.");
  return lines.join("\n");
}

/** A tap on one of the panel's inline buttons. Returns nothing; it edits or answers in the chat itself. */
export async function handleHostingCallback(bot: TelegramBot, chatId: number, data: string, messageId?: number): Promise<void> {
  const send = (t: string, kb?: InlineKeyboard) => bot.api.sendMessage(chatId, t, kb ? { reply_markup: kb } : undefined).catch(() => null);
  const refresh = async () => {
    const text = await panelText();
    if (messageId) { const ok = await bot.api.editMessageText(chatId, messageId, text, { reply_markup: panelKeyboard() }).then(() => true).catch(() => false); if (ok) return; }
    await send(text, panelKeyboard());
  };
  const mode = data.slice(3);
  if ((MODES as readonly string[]).includes(mode)) {
    const r = await setGateMode(mode as Mode);
    await send(r.ok ? `✅ الوضع الآن: ${MODE_NAME[mode as Mode]}${mode !== "auto" && r.until ? ` (حتى ${hhmm(r.until)})` : ""}` : `❌ لم يتغيّر الوضع: ${r.error}`);
    return refresh();
  }
  if (data === "hg:refresh") return refresh();
  if (data === "hg:hooks") {
    const rows = await rehookBots(gateUrl(), true);
    const todo = rows.filter((r) => r.note === "would change").length;
    const bad = rows.filter((r) => !r.ok).length;
    await send(`🔗 نقل الويبهوكات إلى البوابة\n${rows.length} بوتاً: ${todo} سيتغيّر، ${rows.length - todo - bad} هناك أصلاً${bad ? `، ${bad} تعذّر فحصه` : ""}.\nالتنفيذ يمكن التراجع عنه بنفس الزر بعد ضبط العنوان.`, todo ? new InlineKeyboard().text(`نفّذ (${todo})`, "hg:hooks!") : undefined);
    return;
  }
  if (data === "hg:hooks!") {
    const rows = await rehookBots(gateUrl(), false);
    const ok = rows.filter((r) => r.ok).length;
    await send(`${ok === rows.length ? "✅" : "⚠️"} الويبهوكات: ${ok}/${rows.length} على البوابة.${rows.some((r) => !r.ok) ? "\n" + rows.filter((r) => !r.ok).map((r) => `• ${r.template}: ${r.note}`).join("\n") : ""}`);
    return;
  }
  if (data === "hg:env") {
    const until = await openEnvWindow(15);
    await send(`📥 فُتحت نافذة نقل الإعدادات حتى ${hhmm(until.getTime())} (مرة واحدة).\nخادم Oracle يطلبها كل دقيقتين تقريباً وينسخها بنفسه، ثم يبني الموقع. لا تفعل شيئاً آخر.`);
    return;
  }
}

// ---------- the coin platform's owner panel (shown in the Zenobia bot: /platform) ----------
import { getConfig, patchOverride } from "@/lib/znbtConfig";
import { readSnapshot } from "@/lib/znbtIndex";
import { prisma } from "@/lib/prisma";

export function platformKeyboard(open: boolean): InlineKeyboard {
  return (open ? new InlineKeyboard().text("⛔ إغلاق المنصة", "zp:off") : new InlineKeyboard().text("🪙 فتح المنصة للجميع", "zp:on")).row().text("🔄 تحديث", "zp:refresh");
}
export async function platformText(): Promise<{ text: string; open: boolean }> {
  const cfg = await getConfig().catch(() => null);
  const snap = await readSnapshot().catch(() => null);
  const reports = await prisma.$queryRawUnsafe(`SELECT COUNT(DISTINCT curve)::int AS n FROM znbt_reports`).then((r) => Number((r as { n: number }[])[0]?.n ?? 0)).catch(() => 0);
  const open = !!cfg?.open;
  const lines = ["🪙 Palmyra Launch · تدمر لانش", ""];
  lines.push(`المنصة: ${open ? "✅ مفتوحة للجميع (يستطيع أي شخص إطلاق عملة)" : "⛔ مغلقة (صفحة الإنشاء تعرض «لم يُفتح بعد»)"}`);
  lines.push(`ZNBt: ${cfg?.curve ? `✅ مُطلقة (${cfg.curve.slice(0, 6)}…${cfg.curve.slice(-4)})${cfg.launchedAt ? " · " + cfg.launchedAt.slice(0, 10) : ""}` : "لم تُطلَق بعد: افتح صفحة الإطلاق أولاً"}`);
  lines.push(`العملات المفهرسة: ${snap?.coins?.length ?? 0}${snap ? "" : " (لا فهرس بعد)"}`);
  lines.push(`عملات عليها بلاغات: ${reports}`);
  lines.push("", `الإدارة (إخفاء وسحب الرسوم): ${HOSTING.gateUrl}/zenobia/coins.html#admin`, `الإطلاق: ${HOSTING.gateUrl}/zenobia/launch.html`);
  return { text: lines.join("\n"), open };
}
/** A tap on «zp:*». The platform cannot be opened before ZNBt itself exists. */
export async function handlePlatformCallback(bot: TelegramBot, chatId: number, data: string, messageId?: number): Promise<void> {
  const send = (t: string) => bot.api.sendMessage(chatId, t, { link_preview_options: { is_disabled: true } }).catch(() => null);
  if (data === "zp:on" || data === "zp:off") {
    const cfg = await getConfig();
    if (data === "zp:on" && !cfg.curve) await send("⚠️ لن أفتح المنصة قبل أن تُطلَق ZNBt (لم أجد عملتك على السلسلة بعد). افتح صفحة الإطلاق أولاً.");
    else await send((await patchOverride({ open: data === "zp:on" })).open ? "✅ فُتحت منصة العملات: يستطيع أي شخص إطلاق عملة الآن." : "⛔ أُغلقت منصة العملات.");
  }
  const p = await platformText();
  if (messageId) { const ok = await bot.api.editMessageText(chatId, messageId, p.text, { reply_markup: platformKeyboard(p.open), link_preview_options: { is_disabled: true } }).then(() => true).catch(() => false); if (ok) return; }
  await bot.api.sendMessage(chatId, p.text, { reply_markup: platformKeyboard(p.open), link_preview_options: { is_disabled: true } }).catch(() => null);
}
