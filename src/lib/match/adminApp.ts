/**
 * «🛡 لوحة القيادة» for the Mini App. Server-side only. Every call is gated by
 * the bot's own isMatchAdmin() on the initData-verified Telegram id, and every
 * write calls the SAME functions the bot's admin buttons call (matchBotLogic),
 * so Telegram alerts/confirmations to the admin keep working exactly as now.
 * Reads mirror the bot's admin lists (same filters, same take: 20).
 */
import { funnelSummary } from "@/lib/match/growth";
import { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditAdmin, recentAudit } from "@/lib/match/appStore";
import { UPDATE_BROADCAST_TEXT, runUpdateBroadcast, updateBroadcastAudience } from "@/lib/match/social";
import { miniAppUrl } from "@/lib/match/hybrid";
import {
  adminStatsData, decideProfileByUserId, decideVerification, inboxAction, isMatchAdmin, replyToInbox, resolveMatchReport,
  runBroadcast, runUnban, sendSearchDiagnostics, withAdminVia,
} from "@/lib/matchBotLogic";

export type AdminResult = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown> = {}): AdminResult => ({ status: 200, body: { ok: true, ...body } });
const bad = (error: string, status = 400): AdminResult => ({ status, body: { ok: false, error } });

/** Badge counts for the tab (pending profiles / verifications / reports / inbox). */
export async function adminBadges(botId: string) {
  const [profiles, verifications, reportsSearch, reportsChat, inbox] = await Promise.all([
    prisma.matchProfile.count({ where: { status: "PENDING" } }),
    prisma.matchProfile.count({ where: { verificationStatus: "PENDING" } }),
    prisma.matchReport.count({ where: { status: "PENDING", source: "SEARCH" } }),
    prisma.matchReport.count({ where: { status: "PENDING", source: "RANDOM_CHAT" } }),
    prisma.adminMessage.count({ where: { status: "PENDING" } }),
  ]);
  void botId;
  return { profiles, verifications, reportsSearch, reportsChat, inbox, total: profiles + verifications + reportsSearch + reportsChat + inbox };
}

const short = (id: string) => id.slice(-6);

export async function handleAdminAction(bot: TelegramBot, botRow: BotRow, adminId: string, action: string, body: any): Promise<AdminResult> {
  // Never trust the client: re-check on EVERY admin request.
  if (!isMatchAdmin(adminId)) return bad("غير مصرح", 403);
  const chatId = Number(adminId);
  return withAdminVia("app", async () => {
    switch (action) {
      case "admin_overview": {
        const [stats, badges] = await Promise.all([adminStatsData(botRow.id), adminBadges(botRow.id)]);
        return ok({ stats, badges });
      }
      case "admin_funnel": {
        // 📈 Conversion funnel (last 7 / 30 days): distinct users per step.
        const [d7, d30] = await Promise.all([funnelSummary(7), funnelSummary(30)]);
        return ok({ items: d7.map((r, i) => ({ ...r, users30: d30[i].users, events30: d30[i].events })) });
      }
      case "admin_profiles": {
        const profiles = await prisma.matchProfile.findMany({ where: { status: "PENDING" }, orderBy: { created_at: "asc" }, take: 20 });
        return ok({ items: profiles.map((p) => ({ userId: p.userId, shortId: short(p.userId), name: p.name, age: p.age, gender: p.gender, country: p.country, city: p.city, job: p.job, education: p.education, maritalStatus: p.maritalStatus, hasPhoto: !!p.photoFileId, at: p.created_at })) });
      }
      case "admin_profile_decide": {
        const userId = String(body.userId || "").replace(/[^0-9]/g, "");
        if (!userId) return bad("آيدي غير صالح");
        await decideProfileByUserId(bot, chatId, userId, body.approve === true);
        return ok({ message: body.approve === true ? "✅ تم القبول" : "❌ تم الرفض" });
      }
      case "admin_verifications": {
        const items = await prisma.matchProfile.findMany({ where: { verificationStatus: "PENDING" }, orderBy: { created_at: "asc" }, take: 20 });
        return ok({ items: items.map((p) => ({ userId: p.userId, shortId: short(p.userId), name: p.name })), note: "صورة الهوية تبقى في محادثة البوت فقط (لا تُعرض في التطبيق)." });
      }
      case "admin_verify_decide": {
        const userId = String(body.userId || "").replace(/[^0-9]/g, "");
        if (!userId) return bad("آيدي غير صالح");
        await decideVerification(bot, adminId, userId, body.approve === true);
        return ok({ message: body.approve === true ? "✅ تم التوثيق" : "❌ تم الرفض" });
      }
      case "admin_reports": {
        const source = body.source === "RANDOM_CHAT" ? "RANDOM_CHAT" : "SEARCH";
        const reports = await prisma.matchReport.findMany({ where: { status: "PENDING", source }, orderBy: { created_at: "asc" }, take: 20 });
        const ids = [...new Set(reports.flatMap((r) => [r.reporterId, r.targetId]))];
        const profs = await prisma.matchProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, name: true } });
        const name = new Map(profs.map((p) => [p.userId, p.name]));
        const counts = await prisma.matchReport.groupBy({ by: ["targetId"], where: { status: "PENDING", targetId: { in: reports.map((r) => r.targetId) } }, _count: { _all: true } });
        const cnt = new Map(counts.map((c) => [c.targetId, c._count._all]));
        return ok({
          items: reports.map((r) => ({
            id: r.id, source: r.source, reason: r.reason, at: r.created_at,
            reporter: { id: r.reporterId, shortId: short(r.reporterId), name: name.get(r.reporterId) ?? null },
            target: { id: r.targetId, shortId: short(r.targetId), name: name.get(r.targetId) ?? null, pending: cnt.get(r.targetId) ?? 1 },
          })),
        });
      }
      case "admin_report_resolve": {
        const act = body.act === "ban" ? "ban" : body.act === "mute" ? "mute" : "ignore";
        const r = await resolveMatchReport(bot, chatId, String(body.reportId || ""), act);
        return r === "ok" ? ok({ message: { ban: "⛔ تم الحظر", mute: "🔇 كتم 24س", ignore: "🙈 تم التجاهل" }[act] }) : bad(r === "missing" ? "البلاغ غير موجود." : "تمت مراجعة هذا البلاغ مسبقاً.");
      }
      case "admin_inbox": {
        const msgs = await prisma.adminMessage.findMany({ where: { status: "PENDING" }, orderBy: { created_at: "asc" }, take: 20 });
        const profs = await prisma.matchProfile.findMany({ where: { userId: { in: msgs.map((m) => m.senderId) } }, select: { userId: true, name: true } });
        const name = new Map(profs.map((p) => [p.userId, p.name]));
        return ok({ items: msgs.map((m) => ({ id: m.id, senderId: m.senderId, shortId: short(m.senderId), name: name.get(m.senderId) ?? null, text: m.text, at: m.created_at })) });
      }
      case "admin_inbox_action": {
        const kind = body.kind === "ban" ? "ban" : body.kind === "mute" ? "mute" : "read";
        const r = await inboxAction(bot, chatId, String(body.messageId || ""), kind);
        return r === "ok" ? ok({ message: "تم" }) : bad("الرسالة غير موجودة.");
      }
      case "admin_inbox_reply": {
        const text = String(body.text || "").trim().slice(0, 3500);
        if (!text) return bad("اكتب الرد");
        const m = await prisma.adminMessage.findUnique({ where: { id: String(body.messageId || "") } });
        if (!m) return bad("الرسالة غير موجودة.");
        await replyToInbox(bot, chatId, m.id, m.senderId, text);
        return ok({ message: "✅ تم إرسال ردك إلى المستخدم." });
      }
      case "admin_lookup": {
        const targetId = String(body.userId || "").replace(/[^0-9]/g, "");
        if (!targetId) return bad("آيدي غير صالح.");
        const user = await prisma.matchUser.findUnique({ where: { id: targetId } });
        if (!user) return bad("لم يتم العثور على مستخدم بهذا الآيدي.", 404);
        const profile = await prisma.matchProfile.findUnique({ where: { userId: targetId } });
        const [likesReceived, reportsReceived, reportsGiven] = await Promise.all([
          prisma.matchLike.count({ where: { toUserId: targetId } }),
          prisma.matchReport.count({ where: { targetId } }),
          prisma.matchReport.count({ where: { reporterId: targetId } }),
        ]);
        return ok({
          user: {
            id: targetId, phoneVerified: user.phoneVerified, isBanned: user.isBanned,
            mutedUntil: user.mutedUntil && user.mutedUntil > new Date() ? user.mutedUntil : null,
            balance: Number(user.balance || 0), vipUntil: user.vipUntil, likesReceived, reportsReceived, reportsGiven,
          },
          profile: profile && { name: profile.name, status: profile.status, isHidden: profile.isHidden, verification: profile.verificationStatus },
        });
      }
      case "admin_unban": {
        const targetId = String(body.userId || "");
        await runUnban(bot, chatId, targetId);
        return ok({ message: "✅ تم رفع الحظر/الكتم (إن وُجد المستخدم)" });
      }
      case "admin_broadcast": {
        const text = String(body.text || "").trim();
        if (!text) return bad("اكتب نص البث");
        await runBroadcast(bot, chatId, text, botRow.id); // app already shows a confirm dialog
        return ok({ message: "📢 تم البث — النتيجة وصلتك في محادثة البوت" });
      }
      case "admin_update_broadcast_preview": {
        // 📢 «حدّث ملفك» campaign: preview (exact text + audience) before sending.
        const a = await updateBroadcastAudience(botRow.id, adminId);
        return ok({ text: UPDATE_BROADCAST_TEXT, ...a });
      }
      case "admin_update_broadcast_send": {
        if (body.confirm !== true) return bad("أكّد الإرسال");
        const r = await runUpdateBroadcast(bot, botRow.id, miniAppUrl(botRow.id), adminId);
        await auditAdmin(adminId, "update_broadcast", null, `delivered=${r.totalDelivered} failed=${r.totalFailed} remaining=${r.remaining}`, "app");
        await bot.api.sendMessage(chatId, `📢 بث «حدّث ملفك»: وصل ${r.totalDelivered} · فشل ${r.totalFailed}${r.remaining ? ` · متبقٍ ${r.remaining} (اضغط الإرسال مرة أخرى للمتابعة)` : ""} من أصل ${r.audience}.`).catch(() => null);
        return ok({ ...r, message: `وصل ${r.totalDelivered} · فشل ${r.totalFailed}${r.remaining ? ` · متبقٍ ${r.remaining}` : ""}` });
      }
      case "admin_diagnostics": {
        await sendSearchDiagnostics(bot, botRow.id, chatId);
        return ok({ message: "🩺 أُرسل تقرير فحص البحث إلى محادثة البوت" });
      }
      case "admin_audit":
        return ok({ items: await recentAudit(40) });
      default:
        return bad("إجراء غير معروف");
    }
  });
}
