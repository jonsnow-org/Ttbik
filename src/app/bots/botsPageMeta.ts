import type { Metadata } from "next";
import { SITE, PATH } from "./botsPageCopy";

export const botsMetadata: Metadata = {
  title: "تفعيل بوت تليجرام — سوق تولز",
  description:
    "فعّل بوت تليجرام يعمل على توكنك. طلب واحد = بوت واحد. لا سحب نقدي ولا كود للتحميل.",
  keywords: [
    "بوت تليجرام",
    "تفعيل بوت تليجرام",
    "بوت مستضاف",
    "سوق تولز",
    "توكن BotFather",
    "setChatTitle",
    "setChatDescription",
    "setChatPhoto",
    "deleteChatPhoto",
    "leaveChat",
    "pinChatMessage",
    "unpinChatMessage",
    "unpinAllChatMessages",
    "تثبيت رسالة تليجرام",
    "فك تثبيت المجموعة",
  ],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "تفعيل بوت تليجرام — سوق تولز",
    description: "بوت يعمل على توكنك. طلب واحد = بوت واحد. لا سحب نقدي ولا كود للتحميل.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/og/cover.jpg`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "تفعيل بوت تليجرام — سوق تولز",
    description: "منتج جاهز على توكنك. طلب واحد = بوت واحد. لا سحب نقدي.",
    images: [`${SITE}/og/cover.jpg`],
  },
};
