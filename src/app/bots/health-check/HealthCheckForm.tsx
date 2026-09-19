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
    notes.push(`المعرف @${b.username.trim()} لا ينتهي بـ bot.`);
  }
  if (!b?.firstName?.trim()) notes.push("الاسم الظاهر (first_name) فارغ.");
  if (w?.url && w.hostIsPrivate) {
    notes.push("مضيف الويبهوك عنوان خاص/محلي — تليجرام لا يصل إليه من الإنترنت.");
  }
  if (w?.url && w.hostIsIp) notes.push("مضيف الويبهوك عنوان IP خام — فضّل نطاقاً.");
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
  if (!b?.description?.trim() && !b?.shortDescription?.trim()) notes.push("لا يوجد وصف في BotFather.");
  if (!b?.descriptionAr?.trim() && !b?.shortDescriptionAr?.trim()) {
    notes.push("لا يوجد وصف عربي (language_code=ar) في BotFather.");
  }
  if (w?.tokenEmbeddedInUrl) notes.push("رابط الويبهوك يحتوي التوكن — خطر تسريب.");
  if ((b?.profilePhotoCount ?? 0) === 0) notes.push("لا توجد صورة ملف شخصي.");
  if (b?.menuButton?.type === "web_app" && !b.menuButton.webAppUrl) {
    notes.push("زر القائمة مضبوط كـ Web App بلا رابط.");
  }
  return notes;
}
