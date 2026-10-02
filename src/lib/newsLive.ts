/** Official YouTube live desks. We embed the channel live, we do not rebroadcast. */
export type LiveDesk = {
  name: string;
  channelId: string;
  /** Stable live video when the channel publishes one; otherwise channel live_stream. */
  videoId?: string;
};

export const LIVE_DESKS: LiveDesk[] = [
  { name: "بي بي سي عربي", channelId: "UCelk6aHijZq-GJBBB9YpReA" },
  { name: "الجزيرة", channelId: "UCfiwzLy-8yKzIbsmZTzxDgw", videoId: "bNyUyrR0PHo" },
];

export function liveEmbedSrc(desk: LiveDesk) {
  if (desk.videoId) return `https://www.youtube-nocookie.com/embed/${desk.videoId}?rel=0`;
  return `https://www.youtube-nocookie.com/embed/live_stream?channel=${desk.channelId}&rel=0`;
}

const MAJOR = /(هرمز|إيران|ايران|زلزال|حرب|غارات|إطلاق|اطلاق|اغتيال|انفجار|مجزرة|رئيس|ترامب|ترمب)/;

export function isMajorStory(title: string) {
  return MAJOR.test(title);
}
