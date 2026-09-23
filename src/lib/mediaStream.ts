// Where the media mini-app plays videos from. The Cloudflare Worker
// (cloudflare/media-stream-worker.js) streams straight from Telegram, so
// video bytes don't count against the Vercel plan; /api/media-stream on
// Vercel stays as the automatic fallback if the Worker is unreachable.
export const MEDIA_STREAM_BASE = (process.env.NEXT_PUBLIC_MEDIA_STREAM_BASE || "https://media-stream.jonsnowx1r.workers.dev").replace(/\/$/, "");

export function mediaStreamUrl(id: string, fallback = false) {
  return fallback || !MEDIA_STREAM_BASE ? `/api/media-stream?id=${encodeURIComponent(id)}` : `${MEDIA_STREAM_BASE}/?id=${encodeURIComponent(id)}`;
}
