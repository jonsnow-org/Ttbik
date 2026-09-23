// Shared recording/export helpers for the in-browser video studios
// (AudioVisualizerStudio, StoryVideoStudio).

export type VideoFormat = "mp4" | "webm" | "mov";

export const FORMAT_LABELS: Record<VideoFormat, { label: string; hint: string; mime: string }> = {
  mp4: { label: "MP4", hint: "الأنسب لواتساب وإنستغرام وتيك توك", mime: "video/mp4" },
  webm: { label: "WebM", hint: "أخف حجماً — للمتصفحات ويوتيوب", mime: "video/webm" },
  mov: { label: "MOV", hint: "لأجهزة آيفون وماك", mime: "video/quicktime" },
};

// Prefer MP4 when the browser can record it natively (recent Chrome/Safari):
// it plays everywhere, so most people never need a conversion step at all.
export function pickRecording(): { mimeType: string; format: "mp4" | "webm" } {
  const candidates: { mimeType: string; format: "mp4" | "webm" }[] = [
    { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", format: "mp4" },
    { mimeType: "video/mp4", format: "mp4" },
    { mimeType: "video/webm;codecs=vp9,opus", format: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", format: "webm" },
    { mimeType: "video/webm", format: "webm" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: "", format: "webm" };
}

export function formatSize(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// ffmpeg.wasm is ~30MB, so it's only fetched the first time someone asks
// for a format the browser didn't record natively — never on page load.
let ffmpegPromise: Promise<any> | null = null;
function loadFfmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      // The @ffmpeg/ffmpeg ESM files are served as-is from /public/ffmpeg
      // (copied from node_modules by scripts/copy-ffmpeg.mjs): webpack would
      // otherwise rewrite the worker's own dynamic import() of the core and
      // every conversion fails with "Cannot find module 'blob:...'".
      const ffmpegUrl = "/ffmpeg/index.js";
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import(/* webpackIgnore: true */ ffmpegUrl),
        import("@ffmpeg/util"),
      ]);
      const ffmpeg = new FFmpeg();
      const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
      return ffmpeg;
    })().catch((e) => {
      ffmpegPromise = null;
      throw e;
    });
  }
  return ffmpegPromise;
}

export async function convertVideo(
  source: Blob,
  from: "mp4" | "webm",
  target: VideoFormat,
  onProgress: (pct: number) => void,
): Promise<Blob> {
  const ffmpeg = await loadFfmpeg();
  const handler = ({ progress }: { progress: number }) =>
    onProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
  ffmpeg.on("progress", handler);
  try {
    const { fetchFile } = await import("@ffmpeg/util");
    const input = `in.${from}`;
    const out = `out.${target}`;
    await ffmpeg.writeFile(input, await fetchFile(source));
    let args: string[];
    if (target === "webm") {
      args = ["-i", input, "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "2M", "-c:a", "libvorbis", out];
    } else if (from === "mp4") {
      // Already H.264 — MOV is just a different container, no re-encode needed.
      args = ["-i", input, "-c", "copy", "-movflags", "+faststart", out];
    } else {
      args = ["-i", input, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out];
    }
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`ffmpeg exit ${code}`);
    const data = new Uint8Array((await ffmpeg.readFile(out)) as Uint8Array);
    await ffmpeg.deleteFile(input).catch(() => {});
    await ffmpeg.deleteFile(out).catch(() => {});
    return new Blob([data], { type: FORMAT_LABELS[target].mime });
  } finally {
    ffmpeg.off("progress", handler);
  }
}

// Browsers (and some Android file managers) fall back to a bare "download"
// name when the suggested filename has non-Latin characters, so an Arabic
// title becomes a dated Latin name instead.
export function safeFileBase(raw: string, fallback: string) {
  const ascii = raw.trim().replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 50);
  if (ascii.length >= 3) return ascii;
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  return `${fallback}-${stamp}`;
}

export function canShareFiles() {
  if (typeof navigator === "undefined" || typeof File === "undefined") return false;
  try {
    const probe = new File([new Blob(["x"], { type: "video/mp4" })], "probe.mp4", { type: "video/mp4" });
    return !!(navigator as any).canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

// Android in-app browsers (Chrome Custom Tabs — what opens when a link is
// tapped inside Telegram/WhatsApp/Gmail) silently ignore <a download> on a
// blob: URL, which is exactly the "the download button does nothing" report
// (owner, 2026-09-23). The Web Share API hands the actual file to the OS
// share sheet instead, which works there (save to Files/Drive, send to
// WhatsApp/Telegram, etc.).
export async function shareVideo(blob: Blob, filename: string): Promise<"shared" | "cancelled" | "failed"> {
  try {
    const file = new File([blob], filename, { type: blob.type });
    await (navigator as any).share({ files: [file], title: filename });
    return "shared";
  } catch (e: any) {
    return e?.name === "AbortError" ? "cancelled" : "failed";
  }
}

export function downloadVideo(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Removing the anchor/revoking the URL in the same tick can make Chrome
  // drop the filename (saved as plain "download") or cancel the download.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}
