// Shared by the /watch/[token] server page and its GET API route — kept in
// one place so both always agree on how an ad's raw `content` (a full URL
// for LINK/YOUTUBE, but often just a bare @handle for TWITTER/INSTAGRAM/
// TIKTOK/FACEBOOK) turns into the actual page the viewer gets sent to.
export function normalizeTargetUrl(type: string, content: string): string {
  const raw = content.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@/, "");
  switch (type) {
    case "TWITTER":
      return `https://x.com/${handle}`;
    case "INSTAGRAM":
      return `https://instagram.com/${handle}`;
    case "TIKTOK":
      return `https://tiktok.com/@${handle}`;
    case "FACEBOOK":
      return `https://facebook.com/${handle}`;
    case "YOUTUBE":
      return `https://youtube.com/${handle}`;
    default:
      return `https://${raw}`;
  }
}
