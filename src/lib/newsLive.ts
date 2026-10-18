/** Official YouTube live desks. We embed the official stream; we do not rebroadcast. */
export type LiveDesk = {
  name: string;
  channelId: string;
  videoId?: string;
};

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
];

/** English desks. Embed only; Sham AI does not rebroadcast. European + US English channels. */
export const EN_LIVE_DESKS: LiveDesk[] = [
  {
    name: "Al Jazeera English",
    channelId: "UCNye-wNBqNL5ZzHSJj3l8Bg",
    videoId: "gCNeDWCI0vo",
  },
  {
    name: "BBC News",
    channelId: "UC16niRr50-MSBwiO3YDb3RA",
    videoId: "9Auq9mYxFEE",
  },
  {
    name: "Sky News",
    channelId: "UCoMdktPbSTixAyNGwb-UYkQ",
    videoId: "xDWQ3LkccY8",
  },
  {
    name: "DW News",
    channelId: "UCknLrEdhRCp1aegoMqRaCZg",
    videoId: "tZT2MCYu6Zw",
  },
  {
    name: "France 24 English",
    channelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg",
    videoId: "Ap-UM1O9RBU",
  },
  {
    name: "Euronews",
    channelId: "UCyoGb3SMlTlB8CLGVH4c8Rw",
    videoId: "pykpO5kQJ98",
  },
  {
    name: "CNN Headlines",
    channelId: "UCupvZG-5ko_eiXAupbDfxWw",
    videoId: "GotlA1KKWoo",
  },
];

export function liveEmbedSrc(desk: LiveDesk) {
  if (desk.videoId) {
    return `https://www.youtube.com/embed/${desk.videoId}?rel=0&modestbranding=1`;
  }
  return `https://www.youtube.com/embed/live_stream?channel=${desk.channelId}&rel=0&modestbranding=1`;
}

export function liveWatchUrl(desk: LiveDesk) {
  if (desk.videoId) return `https://www.youtube.com/watch?v=${desk.videoId}`;
  return `https://www.youtube.com/channel/${desk.channelId}/live`;
}

const MAJOR = /(هرمز|إيران|ايران|زلزال|حرب|غارات|إطلاق|اطلاق|اغتيال|انفجار|مجزرة|رئيس|ترامب|ترمب)/;

export function isMajorStory(title: string) {
  return MAJOR.test(title);
}
