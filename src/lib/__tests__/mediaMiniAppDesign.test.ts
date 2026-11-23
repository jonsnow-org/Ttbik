import fs from "fs";
import path from "path";

const read = (file: string) =>
  fs.readFileSync(path.join(__dirname, "..", "..", "app", "mini-app", file), "utf8");

describe("media mini-app visual refresh", () => {
  const page = () => read("page.tsx");
  const css = () => read("mini-app.css");

  it("keeps the visual system scoped to the media app and retains Telegram safe areas", () => {
    const styles = css();
    expect(styles).toContain(".media-mini-app-shell");
    expect(styles).toContain("--media-safe-bottom");
    expect(styles).toContain("env(safe-area-inset-bottom");
    expect(styles).toContain(".media-reels");
    expect(styles).toContain(".media-reel-actions");
    expect(styles).toContain('.media-mini-app-nav-item[aria-current="page"] > span:nth-child(2)');
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps all existing feed destinations and interactions while adding clear UI hooks", () => {
    const source = page();
    expect(source).toContain("media-mini-app-header");
    expect(source).toContain("media-mini-app-nav-item");
    expect(source).toContain("media-mini-app-content");
    expect(source).toContain("media-feed-card");
    expect(source).toContain("media-feed-actions");
    expect(source).toContain("media-profile-card");
    expect(source).toContain("media-usage-card");
    expect(source).toContain("media-admin-panel");
    expect(source).toContain("aria-label=\"تحديث الخلاصة\"");
    expect(source).toContain("aria-label=\"صندوق الرسائل\"");
    expect(source).toContain("aria-label=\"الإشعارات\"");
    expect(source).toContain("aria-label=\"ابحث في الوسائط\"");
    expect(source).toContain("aria-label=\"مسح البحث\"");
    expect(source).toContain("setSearch(\"\")");
  });

  it("does not replace the live Telegram, feed or media action handlers", () => {
    const source = page();
    expect(source).toContain("fetch(`/api/media-feed?${qs}`");
    expect(source).toContain('fetch("/api/media-social"');
    expect(source).toContain("mediaStreamUrl(item.id, !!viaVercel[item.id], item.squad_code)");
    expect(source).toContain("forwardInTelegram(item)");
    expect(source).toContain("watchSupportAd()");
    expect(source).toContain("resolveReport(rep,");
  });
});
