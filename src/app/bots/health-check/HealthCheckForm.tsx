"use client";

import { useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

const RIGHTS_AR: Record<string, string> = {
  is_anonymous: "مشرف مجهول",
  can_manage_chat: "إدارة المحادثة",
  can_delete_messages: "حذف الرسائل",
  can_manage_video_chats: "إدارة المكالمات",
  can_restrict_members: "تقييد الأعضاء",
  can_promote_members: "ترقية المشرفين",
  can_change_info: "تعديل المعلومات",
  can_invite_users: "دعوة أعضاء",
  can_post_stories: "نشر قصص",
  can_edit_stories: "تعديل القصص",
  can_delete_stories: "حذف القصص",
  can_post_messages: "نشر المنشورات",
  can_edit_messages: "تعديل المنشورات",
  can_pin_messages: "تثبيت الرسائل",
  can_manage_topics: "إدارة المواضيع",
};

type MenuButton = {
  type?: string;
  text?: string;
  webAppUrl?: string;
};

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
  return Object.entries(rights)
    .filter(([, v]) => v)
    .map(([k]) => RIGHTS_AR[k] || k);
}

function readiness(result: Result): { tone: "ok" | "warn" | "bad"; title: string; notes: string[] } {
  const notes: string[] = [];
  const w = result.webhook;
  if (!w?.url) notes.push("لا يوجد ويبهوك — البوت لن يستقبل تحديثات إلا عبر getUpdates اليدوي.");
  if ((w?.pendingUpdateCount ?? 0) > 10) notes.push(`تراكم تحديثات معلّق (${w?.pendingUpdateCount}) — الويبهوك قد يكون متوقفاً أو بطيئاً.`);
  if (w?.lastErrorMessage) notes.push(`آخر خطأ ويبهوك: ${w.lastErrorMessage}`);
  if (w?.url && w.isHttps === false) notes.push("رابط الويبهوك ليس HTTPS — تليجرام يرفض الاستقبال غالباً.");
  if (w?.lastSyncErrorDate) notes.push("يوجد خطأ مزامنة أخير على الويبهوك.");
  if ((result.bot?.commands?.length ?? 0) === 0) notes.push("قائمة الأوامر فارغة في BotFather.");
  if (!result.bot?.description?.trim() && !result.bot?.shortDescription?.trim()) {
    notes.push("لا يوجد وصف مسجل في BotFather.");
  }
  if ((result.bot?.commands?.length ?? 0) > 0 && (result.bot?.commandsAr?.length ?? 0) === 0) {
    notes.push("لا توجد قائمة أوامر عربية (لغة ar) في BotFather.");
  }
  if ((result.bot?.profilePhotoCount ?? 0) === 0) {
    notes.push("لا توجد صورة ملف شخصي في BotFather.");
  }
  if (
    (result.bot?.description?.trim() || result.bot?.shortDescription?.trim()) &&
    !result.bot?.descriptionAr?.trim() &&
    !result.bot?.shortDescriptionAr?.trim()
  ) {
    notes.push("لا يوجد وصف عربي (لغة ar) في BotFather.");
  }
  if (notes.some((n) => n.startsWith("آخر خطأ") || n.startsWith("تراكم") || n.includes("ليس HTTPS"))) {
    return { tone: "bad", title: "البوت حي لكن الويبهوك فيه مشكلة", notes };
  }
  if (notes.length) {
    return { tone: "warn", title: "البوت حي ويحتاج ضبطاً قبل الإطلاق", notes };
  }
  return { tone: "ok", title: "جاهز للتشغيل: ويبهوك سليم وأوامر مسجلة", notes: [] };
}
