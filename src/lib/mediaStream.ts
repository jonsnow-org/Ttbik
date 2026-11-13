// Where the media mini-app plays videos from. The Cloudflare Worker
// (cloudflare/media-stream-worker.js) streams bytes straight from Telegram.
// It resolves short-lived Telegram file paths through the permanent site gate
// (Oracle first, standby second). If the Worker is unavailable, /api/media-stream
// is requested from the current site host and the gate routes it to the active origin.
export const MEDIA_STREAM_BASE = (process.env.NEXT_PUBLIC_MEDIA_STREAM_BASE || "https://media-stream.jonsnowx1r.workers.dev").replace(/\/$/, "");

export function mediaStreamUrl(id: string, fallback = false, squadCode = "") {
  const query = `id=${encodeURIComponent(id)}`;
  if (squadCode) {
    return `/api/media-stream?${query}&squad=${encodeURIComponent(squadCode)}`;
  }
  return fallback || !MEDIA_STREAM_BASE ? `/api/media-stream?${query}` : `${MEDIA_STREAM_BASE}/?${query}`;
}
