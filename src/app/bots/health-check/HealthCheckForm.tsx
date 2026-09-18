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
    ipAddress?: string | null;
    maxConnections?: number | null;
    allowedUpdates?: string[];
    hasCustomCertificate?: boolean;
    isHttps?: boolean;
    host?: string | null;
    tokenEmbeddedInUrl?: boolean;
    hostIsIp?: boolean;
  };
  error?: string;
};

function menuLabel(menu?: MenuButton) {
  if (!menu?.type || menu.type === "unknown") return "غير معروف";
  if (menu.type === "web_app") {
    const label = menu.text?.trim() ? `ويب آب («${menu.text.trim()}»)` : "ويب آب";
    return menu.webAppUrl ? `${label} — ${menu.webAppUrl}` : label;
  }
  if (menu.type === "commands") return "قائمة الأوامر";
  if (menu.type === "default") return "الافتراضي (أوامر)";
  return menu.type;
}

function enabledRights(rights?: Record<string, boolean>) {
  if (!rights) return [];
  return Object.entries(rights).filter(([, v]) => v).map(([k]) => k);
}

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

function omittedCoreUpdates(allowed?: string[]) {
  if (!allowed || allowed.length === 0) return [];
  const set = new Set(allowed);
  const core = ["message", "callback_query"];
  return core.filter((t) => !set.has(t));
}

function isPrivateWebhookHost(host?: string | null) {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.startsWith("192.168.") ||
    h.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
  );
}

function isRawIpHost(host?: string | null, flagged?: boolean) {
  if (flagged) return true;
  if (!host) return false;
  const h = host.split(":")[0];
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h);
}

function commandsMissingDescriptions(cmds?: BotCommand[]) {
  if (!cmds || cmds.length === 0) return false;
  return cmds.every((c) => !c.description?.trim());
}

function readiness(result: Result): { tone: "ok" | "warn" | "bad"; title: string; notes: string[] } {
  const notes: string[] = [];
  const w = result.webhook;
  const b = result.bot;
  if (!w?.url) notes.push("لا يوجد ويبهوك — البوت لن يستقبل تحديثات إلا عبر getUpdates اليدوي.");
  const pending = w?.pendingUpdateCount ?? 0;
  if (pending > 10) notes.push(`تراكم تحديثات معلّق (${pending}) — الويبهوك قد يكون متوقفاً أو بطيئاً.`);
  else if (pending > 0) notes.push(`يوجد تحديثات معلّقة (${pending}) — الويبهوك ربما متأخر قليلاً.`);
  if (w?.lastErrorMessage) {
    const when = fmtDate(w.lastErrorDate);
    notes.push(when ? `آخر خطأ ويبهوك (${when}): ${w.lastErrorMessage}` : `آخر خطأ ويبهوك: ${w.lastErrorMessage}`);
  } else if (w?.lastErrorDate) {
    notes.push(`يوجد تاريخ خطأ ويبهوك بدون نص: ${fmtDate(w.lastErrorDate)}`);
  }
  if (w?.url && w.isHttps === false) notes.push("رابط الويبهوك ليس HTTPS — تليجرام يرفض الاستقبال غالباً.");
  if (w?.lastSyncErrorDate) notes.push("يوجد خطأ مزامنة أخير على الويبهوك.");
  if (w?.url && isPrivateWebhookHost(w.host)) {
    notes.push("مضيف الويبهوك محلي/خاص — خوادم تليجرام على الإنترنت لن تصله.");
  }
  if (w?.url && isRawIpHost(w.host, w.hostIsIp) && !isPrivateWebhookHost(w.host)) {
    notes.push("مضيف الويبهوك عنوان IP خام — شهادات TLS على IP غالباً تفشل؛ استخدم نطاقاً.");
  }
  if (w?.url && w.maxConnections != null && w.maxConnections < 10) {
    notes.push(`أقصى اتصالات منخفض (${w.maxConnections}) — قد يتراكم الطابور تحت الحمل.`);
  }
  const omitted = omittedCoreUpdates(w?.allowedUpdates);
  if (w?.url && omitted.length) {
    notes.push(`allowedUpdates تستبعد أنواعاً أساسية (${omitted.join(", ")}) — البوت قد لا يستقبل رسائل أو أزرار الأزرار.`);
  }
  if (b?.canJoinGroups === false) notes.push("البوت ممنوع من الانضمام للمجموعات في BotFather.");
  if (b?.canJoinGroups && enabledRights(b.groupAdminRights).length === 0) {
    notes.push("الانضمام للمجموعات مسموح لكن لا توجد صلاحيات أدمن افتراضية للمجموعات.");
  }
  if (b?.canJoinGroups && b.canReadAllGroupMessages === false) {
    notes.push("وضع الخصوصية مفعّل: البوت لا يقرأ رسائل المجموعة إلا إذا ذُكر أو رُدّ عليه — عطّله من BotFather إن كان البوت يعتمد على كل الرسائل.");
  }
  if ((b?.commands?.length ?? 0) === 0) notes.push("قائمة الأوامر فارغة في BotFather.");
  if (commandsMissingDescriptions(b?.commands)) {
    notes.push("الأوامر مسجلة بدون وصف في BotFather — القائمة تظهر ناقصة للزبون.");
  }
  if (!b?.description?.trim() && !b?.shortDescription?.trim()) notes.push("لا يوجد وصف مسجل في BotFather.");
  if ((b?.commands?.length ?? 0) > 0 && (b?.commandsAr?.length ?? 0) === 0) notes.push("لا توجد قائمة أوامر عربية (لغة ar) في BotFather.");
  if ((b?.commands?.length ?? 0) === 0 && ((b?.commandsPrivate?.length ?? 0) > 0 || (b?.commandsGroups?.length ?? 0) > 0)) {
    notes.push("الأوامر الافتراضية فارغة لكن توجد أوامر لنطاق المحادثات الخاصة أو المجموعات.");
  }
  if (w?.tokenEmbeddedInUrl) notes.push("رابط الويبهوك يحتوي التوكن نفسه — أي سجل خادم يحتفظ بالرابط يعرّض التوكن للتسريب.");
  if ((b?.profilePhotoCount ?? 0) === 0) notes.push("لا توجد صورة ملف شخصي في BotFather.");
  if ((b?.description?.trim() || b?.shortDescription?.trim()) && !b?.descriptionAr?.trim() && !b?.shortDescriptionAr?.trim()) {
    notes.push("لا يوجد وصف عربي (لغة ar) في BotFather.");
  }
  if (b?.botFatherName?.trim() && b.firstName && b.botFatherName.trim() !== b.firstName) {
    notes.push(`اسم BotFather («${b.botFatherName.trim()}») يختلف عن first_name («${b.firstName}»).`);
  }
  if (notes.some((n) => n.startsWith("آخر خطأ") || n.startsWith("تراكم") || n.includes("ليس HTTPS") || n.startsWith("يوجد تاريخ خطأ") || n.startsWith("allowedUpdates") || n.startsWith("مضيف الويبهوك محلي") || n.startsWith("مضيف الويبهوك عنوان IP") || n.startsWith("رابط الويبهوك يحتوي التوكن"))) {
    return { tone: "bad", title: "البوت حي لكن الويبهوك فيه مشكلة", notes };
  }
  if (notes.length) return { tone: "warn", title: "البوت حي ويحتاج ضبطاً قبل الإطلاق", notes };
  return { tone: "ok", title: "جاهز للتشغيل: ويبهوك سليم وأوامر مسجلة", notes: [] };
}
