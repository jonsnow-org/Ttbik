/** Official YouTube live desks. We embed the official stream; we do not rebroadcast. */
export type LiveDesk = {
  name: string;
  channelId: string;
  /** Prefer a stable/current live video id when the channel keeps one; else channel live_stream. */
  videoId?: string;
};

/**
 * Desks verified for Arabic news live embeds.
 * - الجزيرة: بث حي معروف ومستمر على يوتيوب
 * - بي بي سي عربي: بث القناة الرسمي /live
 * - فرانس 24 عربي: بث القناة الرسمي /live
 * videoId يُحدَّث عند الحاجة؛ liveWatchUrl يبقى يعمل دائماً.
 */
export const LIVE_DESKS: LiveDesk[] = [
  {
    name: "الجزيرة",
    channelId: "UCfiwzLy-8yKzIbsmZTzxDgw",
    videoId: "bNyUyrR0PHo",
  },
  {
    name: "بي بي سي عربي",
    channelId: "UCelk6aHijZq-GJBBB9YpReA",
    videoId: "ieHD2KktCZA",
  },
  {
    name: "فرانس 24 عربي",
    channelId: "UCQdkRB6zr5k9vBxOGAzWB5A",
    videoId: "A40HmRVHm6E",
  },
];

/** Embed on youtube.com (nocookie often shows «غير متوفّر» for live). */
export function liveEmbedSrc(desk: LiveDesk) {
  if (desk.videoId) {
    return `https://www.youtube.com/embed/${desk.videoId}?rel=0&modestbranding=1`;
  }
  return `https://www.youtube.com/embed/live_stream?channel=${desk.channelId}&rel=0&modestbranding=1`;
}

/** Always-working fallback: open the official live page on YouTube. */
export function liveWatchUrl(desk: LiveDesk) {
  if (desk.videoId) return `https://www.youtube.com/watch?v=${desk.videoId}`;
  return `https://www.youtube.com/channel/${desk.channelId}/live`;
}

const MAJOR = /(هرمز|إيران|ايران|زلزال|حرب|غارات|إطلاق|اطلاق|اغتيال|انفجار|مجزرة|رئيس|ترامب|ترمب)/;

export function isMajorStory(title: string) {
  return MAJOR.test(title);
}
