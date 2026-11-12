import fs from "fs";
import path from "path";

const app = (file: string) => fs.readFileSync(path.join(__dirname, "..", "..", "app", "mini-app", file), "utf8");

describe("media mini-app persistent video player", () => {
  const page = () => app("page.tsx");
  const css = () => app("mini-app.css");

  it("keeps the active video mounted in a portal instead of destroying it on scroll", () => {
    const src = page();
    expect(src).toContain('import { createPortal } from "react-dom"');
    expect(src).toContain('data-mini-player="true"');
    expect(src).toContain('data-player-anchor={playingId === item.id && !isAudio ? item.id : undefined}');
    expect(src).toContain("document.body");
    expect(src).toContain('setPlayerFrame({ mode: "dock" })');
    expect(src).toContain("return isAudio ? null : cur");
  });

  it("shows a fixed safe-area-aware dock above the Telegram navigation bar", () => {
    const styles = css();
    expect(styles).toContain(".media-mini-app-player-float--dock");
    expect(styles).toContain("bottom: calc(6.35rem + max(env(safe-area-inset-bottom, 0px), var(--tg-viewport-safe-area-inset-bottom, 0px), var(--tg-viewport-content-safe-area-inset-bottom, 0px)))");
    expect(styles).toContain("aspect-ratio: 9 / 16");
    expect(styles).toContain("prefers-reduced-motion: reduce");
  });

  it("actively starts the muted autoplay preview and tries the Vercel fallback once", () => {
    const src = page();
    expect(src).toContain("const started = video.play()");
    expect(src).toContain("video.muted = true");
    expect(src).toContain("const onAutoPreviewError = (id: string)");
    expect(src).toContain("autoPreviewAttempts.current[id] = 1");
    expect(src).toContain("onError={() => onAutoPreviewError(item.id)}");
    expect(src).toContain("mediaStreamUrl(item.id, !!viaVercel[item.id], item.squad_code)");
  });

  it("preserves the portal player when the global media cleanup pauses off-card media", () => {
    const src = page();
    expect(src).toContain('media.dataset.miniPlayer === "true" && media.dataset.playerId === playingId');
    expect(src).toContain('preload="auto"');
  });
});
