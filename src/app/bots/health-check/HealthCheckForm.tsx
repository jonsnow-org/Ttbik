"use client";

import { useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

type BotCommand = { command: string; description: string };
type MenuButton = { type?: string; text?: string; webAppUrl?: string };
type Result = {
  bot?: {
    id?: number;
    username: string;
    firstName: string;
    botFatherName?: string;
    botFatherNameAr?: string;
    canJoinGroups: boolean;
    canReadAllGroupMessages: boolean;
    supportsInlineQueries?: boolean;
    hasMainWebApp?: boolean;
    canConnectToBusiness?: boolean;
    addedToAttachmentMenu?: boolean;
    profilePhotoCount?: number;
    commands?: BotCommand[];
    commandsAr?: BotCommand[];
    commandsPrivate?: BotCommand[];
    commandsGroups?: BotCommand[];
    commandsAdmins?: BotCommand[];
    description?: string;
    shortDescription?: string;
    descriptionAr?: string;
    shortDescriptionAr?: string;
    menuButton?: MenuButton;
    groupAdminRights?: Record<string, boolean>;
    channelAdminRights?: Record<string, boolean>;
  };
  webhook?: {
    url: string | null;
    pendingUpdateCount: number;
    lastErrorMessage: string | null;
    lastErrorDate?: string | null;
    lastSyncErrorDate?: string | null;
    port?: number | null;
    portAllowed?: boolean;
    maxConnections?: number | null;
    isHttps?: boolean;
    hostIsIp?: boolean;
    hostIsPrivate?: boolean;
    tokenEmbeddedInUrl?: boolean;
    hasCustomCertificate?: boolean;
    host?: string | null;
    ipAddress?: string | null;
    allowedUpdates?: string[];
  };
  error?: string;
};

function rightsTrue(rights?: Record<string, boolean>): string[] {
  if (!rights) return [];
  return Object.entries(rights)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

function namesDiffer(a?: string, b?: string): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return Boolean(x && y && x !== y);
}

function maskWebhookUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\d{6,12}:[A-Za-z0-9_-]{20,}/g, "[token]");
    return `${u.origin}${path}${u.search ? "?…" : ""}`;
  } catch {
    return url.replace(/\d{6,12}:[A-Za-z0-9_-]{20,}/g, "[token]").slice(0, 80);
  }
}

function collectNotes(result: Result): string[] {
  const notes: string[] = [];
  const w = result.webhook;
  const b = result.bot;
  if (!w?.url) notes.push("لا يوجد ويبهوك — البوت لن يستقبل تحديثات إلا عبر getUpdates.");
  if (w?.url && w.isHttps === false) notes.push("رابط الويبهوك ليس HTTPS — تليجرام يرفض الاستقبال غالباً.");
  if (w?.hostIsPrivate) notes.push(`مضيف الويبهوك خاص/محلي (${w.host ?? "—"}) ولن يصل من تليجرام.`);
  if (w?.hostIsIp) notes.push(`الويبهوك يشير إلى IP مباشر (${w.host ?? "—"}) — يفضّل نطاقاً.`);
  if (w?.tokenEmbeddedInUrl) notes.push("التوكن مضمّن في رابط الويبهوك — انقله لمسار آمن.");
  if (w?.hasCustomCertificate) notes.push("شهادة مخصّصة على الويبهوك — تأكد أنها ما زالت صالحة.");
  if (w?.lastErrorMessage) notes.push(`آخر خطأ ويبهوك: ${w.lastErrorMessage}`);
  if (w?.lastErrorDate) notes.push(`وقت آخر خطأ ويبهوك: ${w.lastErrorDate}`);
  if (w?.lastSyncErrorDate) notes.push(`آخر خطأ مزامنة ويبهوك: ${w.lastSyncErrorDate}`);
  if ((w?.pendingUpdateCount ?? 0) > 100) {
    notes.push(`تحديثات معلّقة مرتفعة (${w?.pendingUpdateCount}) — الويبهوك قد يكون متوقفاً أو بطيئاً.`);
  } else if ((w?.pendingUpdateCount ?? 0) > 0) {
    notes.push(`تحديثات معلّقة: ${w?.pendingUpdateCount} — ليست حرجة بعد.`);
  }
  if (w?.url && w.portAllowed === false) {
    notes.push(`منفذ الويبهوك غير مسموح (${w.port}). المسموح: 443 / 80 / 88 / 8443.`);
  }
  if ((w?.maxConnections ?? 0) > 100) {
    notes.push(`maxConnections=${w?.maxConnections} أعلى من حد تليجرام الشائع (100).`);
  }
  if (w?.url && w.maxConnections != null && w.maxConnections > 0 && w.maxConnections < 10) {
    notes.push(`maxConnections=${w.maxConnections} منخفض — قد يختنق الويبهوك تحت ضغط التحديثات.`);
  }
  if (w?.url && (w.maxConnections == null || w.maxConnections === 0)) {
    notes.push("الويبهوك مفعّل دون قيمة maxConnections ظاهرة.");
  }
  const au = w?.allowedUpdates ?? [];
  if (w?.url && au.length > 0) {
    if (!au.includes("message")) notes.push("allowed_updates لا يتضمن message — الرسائل العادية قد لا تصل.");
    if (!au.includes("callback_query")) notes.push("allowed_updates لا يتضمن callback_query — أزرار الإنلاين قد لا تعمل.");
  }
  if ((b?.commands?.length ?? 0) === 0) notes.push("قائمة الأوامر فارغة في BotFather.");
  const scopedCount = (b?.commandsPrivate?.length ?? 0) + (b?.commandsGroups?.length ?? 0) + (b?.commandsAdmins?.length ?? 0);
  if ((b?.commands?.length ?? 0) === 0 && scopedCount > 0) {
    notes.push("الأوامر العامة فارغة بينما توجد أوامر بنطاق خاص/مجموعات/مشرفين.");
  }
  const defSlugs = new Set((b?.commands ?? []).map((c) => c.command));
  const arSlugs = new Set((b?.commandsAr ?? []).map((c) => c.command));
  if (defSlugs.size && arSlugs.size) {
    const missingAr = [...defSlugs].filter((x) => !arSlugs.has(x));
    if (missingAr.length) notes.push(`أوامر عامة بلا نسخة عربية: ${missingAr.slice(0, 6).map((x) => "/" + x).join(" ")}`);
    const extraAr = [...arSlugs].filter((x) => !defSlugs.has(x));
    if (extraAr.length) notes.push(`أوامر عربية بلا نسخة افتراضية: ${extraAr.slice(0, 6).map((x) => "/" + x).join(" ")}`);
  }
  const allCmds = [
    ...(b?.commands ?? []),
    ...(b?.commandsAr ?? []),
    ...(b?.commandsPrivate ?? []),
    ...(b?.commandsGroups ?? []),
    ...(b?.commandsAdmins ?? []),
  ];
  const emptyDesc = [...new Set(allCmds.filter((c) => !c.description?.trim()).map((c) => `/${c.command}`))];
  if (emptyDesc.length) notes.push(`أوامر بلا وصف: ${emptyDesc.slice(0, 6).join(" ")}`);
  const longDesc = [...new Set(allCmds.filter((c) => (c.description?.trim().length ?? 0) > 256).map((c) => `/${c.command}`))];
  if (longDesc.length) notes.push(`وصف أمر أطول من 256: ${longDesc.slice(0, 6).join(" ")}`);
  const badSlug = [...new Set(allCmds.filter((c) => !/^[a-z0-9_]{1,32}$/.test(c.command)).map((c) => `/${c.command}`))];
  if (badSlug.length) notes.push(`صيغة أمر غير صالحة: ${badSlug.slice(0, 6).join(" ")}`);
  const full = b?.description?.trim() ?? "";
  const shortD = b?.shortDescription?.trim() ?? "";
  if (full && !shortD) notes.push("وصف كامل موجود بلا وصف قصير في BotFather.");
  if (!full && shortD) notes.push("وصف قصير موجود بلا وصف كامل في BotFather.");
  if ((full.length ?? 0) > 512) notes.push("الوصف الكامل أطول من 512 حرفاً.");
  if ((shortD.length ?? 0) > 120) notes.push("الوصف القصير أطول من 120 حرفاً.");
  const fullAr = b?.descriptionAr?.trim() ?? "";
  const shortAr = b?.shortDescriptionAr?.trim() ?? "";
  if (fullAr && !shortAr) notes.push("وصف عربي كامل موجود بلا وصف عربي قصير.");
  if (!fullAr && shortAr) notes.push("وصف عربي قصير موجود بلا وصف عربي كامل.");
  if (full && !fullAr) notes.push("وصف كامل موجود بلا نسخة عربية.");
  if (shortD && !shortAr) notes.push("وصف قصير موجود بلا نسخة عربية.");
  if (fullAr && !full) notes.push("وصف عربي كامل موجود بلا وصف كامل افتراضي.");
  if (shortAr && !shortD) notes.push("وصف عربي قصير موجود بلا وصف قصير افتراضي.");
  if (b?.canJoinGroups === false) notes.push("البوت لا يستطيع الانضمام للمجموعات (can_join_groups=false).");
  if (b?.canJoinGroups && b?.canReadAllGroupMessages === false) {
    notes.push("ينضم للمجموعات لكن لا يقرأ كل الرسائل — وضع الخصوصية مفعّل.");
  }
  if ((b?.commandsGroups?.length ?? 0) > 0 && b?.canJoinGroups === false) {
    notes.push("أوامر مجموعات معرّفة بينما البوت لا يستطيع الانضمام للمجموعات.");
  }
  if (b?.supportsInlineQueries === false) notes.push("الاستعلامات المضمّنة غير مفعّلة في BotFather.");
  const uname = (b?.username ?? "").toLowerCase();
  if (uname && !uname.endsWith("bot")) notes.push(`المعرّف @${b?.username} لا ينتهي بـ bot — شرط تليجرام للبوتات العامة.`);
  if ((b?.profilePhotoCount ?? 0) === 0) notes.push("لا توجد صورة بروفايل للبوت في BotFather.");
  if (b?.hasMainWebApp) notes.push("ويب آب رئيسي مفعّل (has_main_web_app).");
  if (b?.canConnectToBusiness) notes.push("البوت يمكنه الاتصال بحسابات Telegram Business.");
  if (b?.addedToAttachmentMenu) notes.push("البوت مضاف لقائمة المرفقات.");
  const menu = b?.menuButton;
  if (menu?.type === "web_app" && !menu.webAppUrl) {
    notes.push("زر القائمة من نوع web_app بلا رابط.");
  }
  if (menu?.type === "web_app" && menu.webAppUrl && !menu.webAppUrl.startsWith("https://")) {
    notes.push("رابط ويب آب زر القائمة ليس HTTPS.");
  }
  if ((b?.commandsAdmins?.length ?? 0) > 0 && rightsTrue(b?.groupAdminRights).length === 0) {
    notes.push("أوامر للمشرفين معرّفة بينما صلاحيات الأدمن الافتراضية للمجموعات فارغة.");
  }
  if (namesDiffer(b?.firstName, b?.botFatherName)) {
    notes.push(`اسم getMe (${b?.firstName}) يختلف عن اسم BotFather (${b?.botFatherName}).`);
  }
  if (b?.botFatherNameAr && namesDiffer(b?.botFatherName, b?.botFatherNameAr)) {
    notes.push(`اسم BotFather العربي (${b.botFatherNameAr}) يختلف عن الاسم الافتراضي.`);
  }
  if (w?.url && w.isHttps === true && w.hasCustomCertificate) {
    notes.push("HTTPS مفعّل مع شهادة مخصّصة — راقب صلاحية الشهادة.");
  }
  return notes;
}
