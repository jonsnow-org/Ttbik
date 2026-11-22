import fs from "fs";
import path from "path";

const app = (file: string) => fs.readFileSync(path.join(__dirname, "..", "..", "app", "mini-app", file), "utf8");

describe("media mini-app video player (inline, never a floating window)", () => {
  const page = () => app("page.tsx");

  it("has no floating/portal player and no dock styles", () => {
    const src = page();
    expect(src).not.toContain("createPortal");
    expect(src).not.toContain("playerFrame");
    expect(src).not.toContain("media-mini-app-player-float");
    expect(app("mini-app.css")).not.toContain("player-float");
  });

  it("plays the tapped video inside its own card and stops it when the card scrolls away", () => {
    const src = page();
    expect(src).toContain("onError={() => onPlayError(item.id)}");
    expect(src).toContain("setPlayingId(null)");
    expect(src).toContain("A playing video lives only inside its own card");
  });

  it("actively starts the muted autoplay preview and tries the site-stream fallback once", () => {
    const src = page();
    expect(src).toContain("const started = video.play()");
    expect(src).toContain("video.muted = true");
    expect(src).toContain("const onAutoPreviewError = useCallback((id: string) =>");
    expect(src).toContain("autoPreviewAttempts.current[id] = 1");
    expect(src).toContain("onError={() => onAutoPreviewError(item.id)}");
    expect(src).toContain("mediaStreamUrl(item.id, !!viaVercel[item.id], item.squad_code)");
  });
});


describe("media mini-app failure handling", () => {
  const src = () => app("page.tsx");
  it("has no too-big fallback UI: big clips are compressed by the bot so they stream", () => {
    const s = src();
    expect(s).not.toContain("tooBig");
    expect(s).not.toContain("افتحه في البوت");
  });
  it("falls back to the clip's own first frame when the stored thumbnail link has expired", () => {
    const s = src();
    expect(s).toContain("frameFailed");
    expect(s).toContain('+ "#t=0.5"');
  });
});


describe("Cloudflare media stream Worker origin routing", () => {
  const worker = fs.readFileSync(path.join(__dirname, "..", "..", "..", "cloudflare", "media-stream-worker.js"), "utf8");
  const wrangler = fs.readFileSync(path.join(__dirname, "..", "..", "..", "cloudflare", "media-stream.wrangler.jsonc"), "utf8");

  it("resolves Telegram file paths through the permanent site gate, not a Vercel-only origin", () => {
    expect(worker).toContain('const DEFAULT_MEDIA_PATH_ORIGIN = "https://ttbik-gate.jonsnowx1r.workers.dev"');
    expect(worker).toContain("mediaPathOrigin(env)");
    expect(worker).toContain("/api/media-path?id=");
    expect(worker).toContain("vercel\\.app");
    expect(worker).not.toContain('const SITE = "https://ttbik.vercel.app"');
  });

  it("keeps the media Worker deploy config separate and stores no bot secret in it", () => {
    expect(wrangler).toContain('"name": "media-stream"');
    expect(wrangler).toContain('"main": "media-stream-worker.js"');
    expect(wrangler).toContain('"MEDIA_PATH_ORIGIN": "https://ttbik-gate.jonsnowx1r.workers.dev"');
    expect(wrangler).not.toMatch(/"BOT_TOKEN"\s*:/);
  });
});

describe("media mini-app reels (full review follow-ups)", () => {
  const s = () => app("page.tsx");
  it("stopping a card that scrolled away never stops the reel that already took over", () => {
    expect(s()).toContain("setPlayingId((cur) => (cur === playingId ? null : cur))");
  });
  it("keeps ads in the reel feed: a full-screen ad card every 6th reel that disappears when unfilled", () => {
    const src = s();
    expect(src).toContain("function ReelAd()");
    expect(src).toContain("plain && index > 0 && index % 6 === 0 && <ReelAd />");
    expect(app("mini-app.css")).toContain(".media-reels > .media-reel-ad");
  });
});
