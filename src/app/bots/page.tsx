import type { Metadata } from "next";
import Link from "next/link";
import { isOwnerServer } from "@/lib/isOwner";
import AdSlot from "@/components/AdSlot";
import BotsDeployForm from "./BotsDeployForm";
import { LIVE_BOTS } from "@/lib/liveBots";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/bots";

export const metadata: Metadata = {
  title: "تفعيل بوت تليجرام — سوق تولز",
  description:
    "فعّل بوت تليجرام يعمل فعلياً على توكنك الخاص خلال دقائق: مشاهدة إعلانات وربح نقاط، محفظة، وإحالة. منتج جاهز تملكه وتشغّله فوراً — بدون كتابة أي شيء.",
  keywords: [
    "بوت تليجرام",
    "تفعيل بوت تليجرام",
    "بوت مستضاف",
    "سوق تولز",
    "توكن BotFather",
    "بعد تفعيل البوت",
    "إعادة توليد التوكن",
    "اسم مستخدم البوت",
    "ويبهوك البوت",
    "setWebhook",
    "حذف البوت من BotFather",
    "استرجاع توكن البوت",
    "إضافة البوت لمجموعة",
    "setprivacy",
    "setjoingroups",
    "حد رسائل تليجرام",
    "flood",
  ],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "تفعيل بوت تليجرام — سوق تولز",
    description:
      "بوت يعمل على توكنك. طلب واحد = بوت واحد. لا سحب نقدي ولا كود للتحميل.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/opengraph-image` }],
  },
  twitter: {
    card: "summary_large_image",
    title: "تفعيل بوت تليجرام — سوق تولز",
    description: "منتج جاهز على توكنك. طلب واحد = بوت واحد. لا سحب نقدي.",
    images: [`${SITE}/opengraph-image`],
  },
};

const TERMS = [
  "المنتج بوت يعمل على توكنك — ليس ملف كود للتحميل.",
  "طلب معتمد واحد = بوت واحد. لا يُعاد استخدام رمز الطلب.",
  "لا يوجد سحب نقدي عبر سوق تولز. النقاط داخل البوت فقط.",
];

const PREP = [
  "أنشئ بوتاً من @BotFather وانسخ التوكن فقط — لا تلصقه في محادثة عامة.",
  "اختياري: افحص التوكن من فاحص الصحة قبل التفعيل.",
  "رمز طلب معتمد واحد لكل بوت. المالك يتجاوز للاختبار فقط.",
];

const AFTER = [
  "افتح البوت في تليجرام وأرسل /start.",
  "إن لم يرد: افحص الويبهوك من فاحص الصحة — الفحص لا يستهلك رمز الطلب.",
  "لا تشارك التوكن ولا تعد استخدام رمز طلب لبوت ثانٍ.",
];
