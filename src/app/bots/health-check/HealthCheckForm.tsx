"use client";

import { useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

type MenuButton = { type?: string; text?: string; webAppUrl?: string };
type BotCommand = { command: string; description: string };
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
    canConnectToBusiness?: boolean;
    hasMainWebApp?: boolean;
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
    maxConnections?: number | null;
    allowedUpdates?: string[];
    hasCustomCertificate?: boolean;
    isHttps?: boolean;
    host?: string | null;
    tokenEmbeddedInUrl?: boolean;
    hostIsIp?: boolean;
    hostIsPrivate?: boolean;
    ipAddress?: string | null;
    port?: number | null;
    portAllowed?: boolean;
  };
  error?: string;
};

function yn(v?: boolean) {
  return v ? "نعم" : "لا";
}

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ar");
  } catch {
    return iso;
  }
}

function hoursSince(iso?: string | null) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 36e5;
}

function enabledRights(rights?: Record<string, boolean>) {
  if (!rights) return [];
  return Object.entries(rights)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

function commandSlugs(cmds?: BotCommand[], limit = 8) {
  return (cmds ?? []).slice(0, limit).map((c) => `/${c.command}`).join(" ");
}

function slugSet(cmds?: BotCommand[]) {
  return new Set((cmds ?? []).map((c) => c.command.toLowerCase()));
}

function collectNotes(result: Result): string[] {
  const notes: string[] = [];
  const w = result.webhook;
  const b = result.bot;
  if (!w?.url) notes.push("لا يوجد ويبهوك — البوت لن يستقبل تحديثات إلا عبر getUpdates.");
  const pending = w?.pendingUpdateCount ?? 0;
  if (pending > 100) notes.push(`تراكم تحديثات كبير (${pending}) — الويبهوك قد يكون متوقفاً.`);
  else if (pending > 10) notes.push(`تراكم تحديثات معلّق (${pending}).`);
  else if (pending > 0) notes.push(`تحديثات معلّقة (${pending}).`);
  if (w?.lastErrorMessage) notes.push(`آخر خطأ ويبهوك: ${w.lastErrorMessage}`);
  if (w?.url && w.isHttps === false) notes.push("رابط الويبهوك ليس HTTPS.");
  if (w?.url && hoursSince(w.lastErrorDate) != null && hoursSince(w.lastErrorDate)! <= 24) {
    notes.push(`خطأ ويبهوك خلال آخر 24 ساعة (${fmtDate(w.lastErrorDate)}).`);
  }
  if (w?.url && hoursSince(w.lastSyncErrorDate) != null && hoursSince(w.lastSyncErrorDate)! <= 24) {
    notes.push(`خطأ مزامنة ويبهوك خلال آخر 24 ساعة (${fmtDate(w.lastSyncErrorDate)}).`);
  }
  if (w?.url && w.hasCustomCertificate) {
    notes.push("الويبهوك يستخدم شهادة TLS مخصصة — تأكد أن تليجرام يثق بها.");
  }
  if (w?.url && (w.host === "api.telegram.org" || (w.host || "").endsWith(".telegram.org"))) {
    notes.push("مضيف الويبهوك يشير إلى خوادم تليجرام — عيّن رابط خادمك.");
  }
  if (!b?.username?.trim()) {
    notes.push("البوت بلا @username.");
  } else if (!b.username.trim().toLowerCase().endsWith("bot")) {
    notes.push(`المعرّف @${b.username.trim()} لا ينتهي بـ bot.`);
  }
  if (!b?.firstName?.trim()) notes.push("الاسم الظاهر (first_name) فارغ.");
  if (w?.url && w.hostIsPrivate) {
    notes.push("مضيف الويبهوك عنوان خاص/محلي — تليجرام لا يصل إليه من الإنترنت.");
  }
  if (w?.url && w.hostIsIp) notes.push("مضيف الويبهوك عنوان IP خام — فضّل نطاقاً.");
  if (w?.url && w.portAllowed === false) {
    notes.push(`منفذ الويبهوك غير مسموح من تليجرام (${w.port}). المسموح: 443 / 80 / 88 / 8443.`);
  }
  if (w?.url && w.maxConnections != null && w.maxConnections > 100) {
    notes.push(`أقصى اتصالات أعلى من حد تليجرام 100 (الحالي ${w.maxConnections}).`);
  }
  if (b?.descriptionAr?.trim() && !b?.shortDescriptionAr?.trim()) {
    notes.push("يوجد وصف عربي كامل بلا وصف قصير عربي.");
  }
  if (b?.shortDescriptionAr?.trim() && !b?.descriptionAr?.trim()) {
    notes.push("يوجد وصف قصير عربي بلا وصف عربي كامل.");
  }
  if (w?.url && w.maxConnections != null && w.maxConnections < 10) {
    notes.push(`أقصى اتصالات منخفض (${w.maxConnections}).`);
  }
  const allowed = w?.allowedUpdates ?? [];
  if (w?.url && allowed.length > 0) {
    if (!allowed.includes("message")) notes.push("allowed_updates يستثني message — البوت لن يستقبل الرسائل العادية.");
    if (!allowed.includes("callback_query")) notes.push("allowed_updates يستثني callback_query — أزرار القوائم قد لا تعمل.");
  }
  if (b?.canJoinGroups === false) notes.push("البوت ممنوع من الانضمام للمجموعات.");
  if (b?.canJoinGroups && b.canReadAllGroupMessages === false) {
    notes.push("وضع الخصوصية مفعّل: البوت لا يقرأ كل رسائل المجموعة.");
  }
  if ((b?.commands?.length ?? 0) === 0) notes.push("قائمة الأوامر فارغة في BotFather.");
  if ((b?.commands?.length ?? 0) > 0 && (b?.commandsAr?.length ?? 0) === 0) {
    notes.push("توجد أوامر عامة بلا نسخة عربية (language_code=ar).");
  }
  if ((b?.commandsGroups?.length ?? 0) > 0 && b?.canJoinGroups === false) {
    notes.push("توجد أوامر نطاق المجموعات بينما البوت ممنوع من الانضمام للمجموعات.");
  }
  const defSlugs = slugSet(b?.commands);
  const privSlugs = slugSet(b?.commandsPrivate);
  const groupSlugs = slugSet(b?.commandsGroups);
  if (defSlugs.size > 0 && privSlugs.size > 0) {
    const missingInPrivate = [...defSlugs].filter((s) => !privSlugs.has(s));
    if (missingInPrivate.length > 0) {
      notes.push(`أوامر عامة غير موجودة في نطاق الخاص: ${missingInPrivate.slice(0, 6).map((s) => `/${s}`).join(" ")}`);
    }
  }
  if (defSlugs.size > 0 && groupSlugs.size > 0) {
    const missingInGroups = [...defSlugs].filter((s) => !groupSlugs.has(s));
    if (missingInGroups.length > 0) {
      notes.push(`أوامر عامة غير موجودة في نطاق المجموعات: ${missingInGroups.slice(0, 6).map((s) => `/${s}`).join(" ")}`);
    }
  }
  if (!b?.description?.trim() && !b?.shortDescription?.trim()) notes.push("لا يوجد وصف في BotFather.");
  if (!b?.descriptionAr?.trim() && !b?.shortDescriptionAr?.trim()) {
    notes.push("لا يوجد وصف عربي (language_code=ar) في BotFather.");
  }
  if (w?.tokenEmbeddedInUrl) notes.push("رابط الويبهوك يحتوي التوكن — خطر تسريب.");
  if ((b?.profilePhotoCount ?? 0) === 0) notes.push("لا توجد صورة ملف شخصي.");
  if (b?.addedToAttachmentMenu) notes.push("البوت مظهور في قائمة المرفقات.");
  if (b?.menuButton?.type === "web_app" && !b.menuButton.webAppUrl) {
    notes.push("زر القائمة مضبوط كـ Web App بلا رابط.");
  }
  const webAppUrl = b?.menuButton?.webAppUrl?.trim() || "";
  if (webAppUrl && !/^https:\/\//i.test(webAppUrl)) {
    notes.push("رابط زر Web App ليس HTTPS — تليجرام يرفضه.");
  }
  if (b?.hasMainWebApp && b?.menuButton?.type !== "web_app") {
    notes.push("Web App رئيسي مفعّل دون زر قائمة من نوع web_app.");
  }
  if (b?.description?.trim() && !b?.shortDescription?.trim()) {
    notes.push("يوجد وصف كامل بلا وصف قصير في BotFather.");
  }
  if (b?.shortDescription?.trim() && !b?.description?.trim()) {
    notes.push("يوجد وصف قصير بلا وصف كامل في BotFather.");
  }
  const firstLen = b?.firstName?.trim().length ?? 0;
  if (firstLen > 64) notes.push(`الاسم الظاهر أطول من حد تليجرام (64). الحالي ${firstLen}.`);
  const descLen = b?.description?.trim().length ?? 0;
  if (descLen > 512) notes.push(`الوصف الكامل أطول من حد تليجرام (512). الحالي ${descLen}.`);
  const shortLen = b?.shortDescription?.trim().length ?? 0;
  if (shortLen > 120) notes.push(`الوصف القصير أطول من حد تليجرام (120). الحالي ${shortLen}.`);
  if (w?.url && allowed.length > 0 && b?.supportsInlineQueries && !allowed.includes("inline_query")) {
    notes.push("الإنلاين مفعّل بينما allowed_updates يستثني inline_query.");
  }
  if (w?.url && allowed.length > 0 && b?.canConnectToBusiness && !allowed.includes("business_connection") && !allowed.includes("business_message")) {
    notes.push("بوابة الأعمال مفعّلة بينما allowed_updates لا يشمل تحديثات الأعمال.");
  }
  if ((b?.commandsAdmins?.length ?? 0) > 0 && b?.canJoinGroups === false) {
    notes.push("توجد أوامر نطاق مدار المحادثة بينما البوت ممنوع من الانضمام للمجموعات.");
  }
  const adminSlugs = slugSet(b?.commandsAdmins);
  if (defSlugs.size > 0 && adminSlugs.size > 0) {
    const missingInAdmins = [...defSlugs].filter((s) => !adminSlugs.has(s));
    if (missingInAdmins.length > 0) {
      notes.push(`أوامر عامة غير موجودة في نطاق مدار المحادثة: ${missingInAdmins.slice(0, 6).map((s) => `/${s}`).join(" ")}`);
    }
  }
  const allCmds = [
    ...(b?.commands ?? []),
    ...(b?.commandsAr ?? []),
    ...(b?.commandsPrivate ?? []),
    ...(b?.commandsGroups ?? []),
    ...(b?.commandsAdmins ?? []),
  ];
  const emptyDesc = allCmds.filter((c) => !c.description?.trim()).map((c) => `/${c.command}`);
  if (emptyDesc.length > 0) {
    notes.push(`أوامر بلا وصف: ${[...new Set(emptyDesc)].slice(0, 6).join(" ")}`);
  }
  const longDesc = allCmds.filter((c) => (c.description?.trim().length ?? 0) > 256).map((c) => `/${c.command}`);
  if (longDesc.length > 0) {
    notes.push(`وصف أمر أطول من حد تليجرام 256: ${[...new Set(longDesc)].slice(0, 6).join(" ")}`);
  }
  const badSlug = allCmds.filter((c) => !/^[a-z0-9_]{1,32}$/.test(c.command)).map((c) => `/${c.command}`);
  if (badSlug.length > 0) {
    notes.push(`صيغة أمر غير صالحة (أحرف/طول): ${[...new Set(badSlug)].slice(0, 6).join(" ")}`);
  }
  return notes;
}
