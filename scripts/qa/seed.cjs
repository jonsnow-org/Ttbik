// Seeds the LOCAL QA database only (refuses anything but localhost).
const { PrismaClient } = require("@prisma/client");
const url = process.env.DATABASE_URL || "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) { console.error("refusing: DATABASE_URL is not local"); process.exit(1); }
const prisma = new PrismaClient();
const BOT = { id: "qa-bot", token: "123456:QA-FAKE-TOKEN", ownerId: "9000", template: "MARRIAGE_BOT", webhookSecret: "qa-secret" };
const day = 86400000;
const people = [
  { id: "1001", name: "أحمد", gender: "MALE", age: 30, country: "مصر", status: "APPROVED", balance: 20 },
  { id: "1002", name: "سارة", gender: "FEMALE", age: 26, country: "مصر", status: "APPROVED", balance: 0.5, vip: true },
  { id: "1003", name: "منى", gender: "FEMALE", age: 28, country: "السعودية", status: "APPROVED", balance: 5, verify: "PENDING" },
  { id: "1004", name: "عمر", gender: "MALE", age: 35, country: "السعودية", status: "PENDING", balance: 0 },
  { id: "1005", name: "ليلى", gender: "FEMALE", age: 24, country: "مصر", status: "APPROVED", balance: 0.3, photo: "qa-photo-1005" },
  { id: "1006", name: "خالد", gender: "MALE", age: 40, country: "مصر", status: "APPROVED", balance: 0 },
  { id: "1007", name: null },
  { id: "9000", name: null }, // admin (SUPER_ADMIN_TELEGRAM_ID)
];
(async () => {
  const tables = ["MatchReport", "AdminMessage", "MatchLike", "MatchBlock", "MatchProfileVisit", "MatchPhotoPermission", "RandomChatQueue", "RandomChatSession", "MatchTransaction", "PartnerPreference", "MatchProfilePrivacy", "MatchProfile", "MatchUser"];
  for (const t of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => null);
  for (const t of ["match_app_messages", "match_anon_filters", "match_rate_limits", "match_admin_audit", "match_anon_rt", "match_app_presence", "match_app_daily", "match_app_passes", "match_app_compliments", "match_first_discount", "match_funnel_events", "match_expiry_reminders", "match_app_passes_log", "match_anon_state", "match_athar_moments", "match_share", "match_dm", "match_dm_unlock", "match_card_filter", "match_notifications", "match_broadcast_log"]) await prisma.$executeRawUnsafe(`DELETE FROM ${t}`).catch(() => null);
  await prisma.bot.upsert({ where: { id: BOT.id }, update: BOT, create: BOT });
  for (const p of people) {
    await prisma.matchUser.create({ data: { id: p.id, botId: BOT.id, phoneVerified: true, balance: p.balance ?? 0, vipUntil: p.vip ? new Date(Date.now() + 20 * day) : null } });
    if (!p.name) continue;
    await prisma.matchProfile.create({ data: {
      userId: p.id, gender: p.gender, name: p.name, age: p.age, country: p.country, job: "مهندس", education: "جامعي", attributes: "هادئ",
      contactMethod: "TELEGRAM", contactValue: "@qa_" + p.id, status: p.status, photoFileId: p.photo ?? null, verificationStatus: p.verify ?? "NONE",
    } });
    await prisma.partnerPreference.create({ data: { userId: p.id, country: "أي دولة", ageMin: 18, ageMax: 60 } });
  }
  await prisma.$executeRawUnsafe(`INSERT INTO match_anon_filters (user_id, filter, paid_until) VALUES ('1003', '{"gender":"MALE"}', now() + interval '10 days') ON CONFLICT (user_id) DO NOTHING`).catch((e) => console.error(e.message));
  await prisma.matchLike.createMany({ data: [{ fromUserId: "1001", toUserId: "1005" }, { fromUserId: "1005", toUserId: "1001" }, { fromUserId: "1002", toUserId: "1001" }] });
  await prisma.matchReport.createMany({ data: [{ reporterId: "1002", targetId: "1006", source: "SEARCH" }, { reporterId: "1003", targetId: "1006", source: "RANDOM_CHAT" }] });
  await prisma.adminMessage.create({ data: { senderId: "1001", text: "مرحباً بالإدارة — رسالة اختبار" } }).catch((e) => console.error("adminMessage", e.message));
  console.log("seeded");
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
