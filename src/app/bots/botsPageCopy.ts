import { SITE_URL } from "@/lib/siteUrl";

export const SITE = SITE_URL;
export const PATH = "/bots";

export const TERMS = [
  "المنتج بوت يعمل على توكنك — ليس ملف كود للتحميل.",
  "طلب معتمد واحد = بوت واحد. لا يُعاد استخدام رمز الطلب.",
  "لا يوجد سحب نقدي عبر سوق تولز. النقاط داخل البوت فقط.",
];

export const PREP = [
  "أنشئ بوتاً من @BotFather وانسخ التوكن فقط — لا تلصقه في محادثة عامة.",
  "اختياري: افحص التوكن من فاحص الصحة قبل التفعيل.",
  "رمز طلب معتمد واحد لكل بوت. المالك يتجاوز للاختبار فقط.",
];

export const AFTER = [
  "افتح البوت في تليجرام وأرسل /start.",
  "إن لم يرد: افحص الويبهوك من فاحص الصحة — الفحص لا يستهلك رمز الطلب.",
  "لا تشارك التوكن ولا تعد استخدام رمز طلب لبوت ثانٍ.",
];

export const LIMITS = [
  "اسم المستخدم والوصف والصورة تُضبط من @BotFather — ليس من هذا النموذج.",
  "عنوان المجموعة وصورتها وخروج البوت (setChatTitle / setChatDescription / setChatPhoto / deleteChatPhoto / leaveChat) من تليجرام فقط. الموقع لا يغيّر عنوان مجموعة ولا صورتها ولا يُخرج البوت نيابة عنك. لا رمز طلب إضافياً.",
  "تثبيت الرسائل وفكه (pinChatMessage / unpinChatMessage / unpinAllChatMessages) من تليجرام فقط. الموقع لا يثبّت ولا يفك تثبيتاً نيابة عنك.",
  "روابط الدعوة (exportChatInviteLink / createChatInviteLink / editChatInviteLink / revokeChatInviteLink) من تليجرام فقط. الموقع لا يُنشئ رابط دعوة ولا يلغيه نيابة عنك. لا رمز طلب إضافياً.",
  "حظر الأعضاء وتقييد الصلاحيات (banChatMember / unbanChatMember / restrictChatMember / promoteChatMember) من تليجرام فقط. الموقع لا يحظر ولا يرفع حظراً ولا يقيّد صلاحيات نيابة عنك. لا رمز طلب إضافياً.",
  "صلاحيات المجموعة وطلبات الانضمام (setChatPermissions / approveChatJoinRequest / declineChatJoinRequest) من تليجرام فقط. الموقع لا يغيّر صلاحيات المجموعة ولا يوافق على طلب انضمام نيابة عنك. لا رمز طلب إضافياً.",
  "قائمة المشرفين وبيانات العضو وعدد الأعضاء (getChatAdministrators / getChatMember / getChatMemberCount / getChat) من تليجرام فقط. الموقع لا يعرض قائمة مشرفين ولا عضواً ولا عدد أعضاء نيابة عنك. لا رمز طلب إضافياً.",
  "قائمة أوامر البوت واسمه المعروض (setMyCommands / deleteMyCommands / getMyCommands / setMyName) من تليجرام و@BotFather فقط. الموقع لا يضع قائمة / ولا يغيّر اسم البوت المعروض نيابة عنك. لا رمز طلب إضافياً.",
  "وصف البوت الطويل والقصير (setMyDescription / getMyDescription / setMyShortDescription / getMyShortDescription) من تليجرام و@BotFather فقط. الموقع لا يضع وصف البوت ولا يقرأه نيابة عنك. لا رمز طلب إضافياً.",
  "صلاحيات المشرف الافتراضية للبوت (setMyDefaultAdministratorRights / getMyDefaultAdministratorRights) من تليجرام فقط. الموقع لا يضع هذه الصلاحيات ولا يقرأها نيابة عنك. لا رمز طلب إضافياً.",
  "زر قائمة الدردشة (setChatMenuButton / getChatMenuButton) من تليجرام فقط. الموقع لا يضع زر قائمة ولا يقرأه نيابة عنك. لا رمز طلب إضافياً.",
  "صورة البوت المعروضة (setMyProfilePhoto / deleteMyProfilePhoto / getMyName) من تليجرام و@BotFather فقط. الموقع لا يضع صورة البوت ولا يحذفها ولا يقرأ الاسم المعروض نيابة عنك. لا رمز طلب إضافياً.",
  "الويبهوك والتحديثات (setWebhook / deleteWebhook / getWebhookInfo / getUpdates) من تليجرام فقط. فاحص الصحة يقرأ حالة الويبهوك فقط ولا يسجّل ويبهوكاً مخصصاً ولا يلغي الويبهوك نيابة عنك. لا رمز طلب إضافياً.",
  "النقاط داخل البوت فقط — لا سحب نقدي عبر سوق تولز.",
];

export const INCLUDES = [
  "تشغيل القالب على توكن BotFather الذي تلصقه أنت",
  "بوت واحد لكل رمز طلب معتمد — بلا إعادة استخدام الرمز",
  "نقاط داخل البوت فقط — بلا سحب نقدي من سوق تولز",
  "ليس ملف كود وليس تحميل مصدر",
];

export const STEPS = [
  {
    name: "احصل على رمز طلب معتمد",
    text: "طلب واحد = بوت واحد. المالك يمكنه تجاوز بوابة الدفع للاختبار.",
  },
  {
    name: "انسخ بوتاً من BotFather",
    text: "انسخ بوتاً جديداً في تليجرام وانسخ التوكن. لا ترسل التوكن لأحد.",
  },
  {
    name: "الصق التوكن في النموذج",
    text: "الصق التوكن ورمز الطلب ثم فعّل. المنتج بوت عامل على توكنك، ليس كوداً للتحميل.",
  },
];
