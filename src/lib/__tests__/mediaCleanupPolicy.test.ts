import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "..", "..", "app", "api", "media-cleanup", "route.ts"), "utf8");

describe("media cleanup sweep policy", () => {
  it("removes permanently invalid files and, after a grace period, clips Telegram says are too big to stream", () => {
    expect(src).toContain("wrong file identifier");
    expect(src).toContain("TOO_BIG_GRACE_MS = 24 * 3600_000");
    expect(src).toContain("/file is too big/.test(description) && age > TOO_BIG_GRACE_MS");
  });
  it("never deletes on rate limits, server errors or timeouts", () => {
    expect(src).toContain("if (!permanentInvalid && !tooBigAndStale) return;");
    expect(src).toContain("Temporary network errors must never trigger deletion.");
  });
  it("scans a few hundred posts in parallel batches inside the 60s budget", () => {
    expect(src).toContain("SCAN_LIMIT = 300");
    expect(src).toContain("PARALLEL = 8");
    expect(src).toContain("maxDuration = 60");
  });
});

describe("media feed: swapping a file does not re-notify followers", () => {
  it("skips the follower notification when the bot sends silent:true", () => {
    const feed = fs.readFileSync(path.join(__dirname, "..", "..", "app", "api", "media-feed", "route.ts"), "utf8");
    expect(feed).toContain("body.silent !== true");
    const py = fs.readFileSync(path.join(__dirname, "..", "..", "..", "media-bot", "services", "feed.py"), "utf8");
    expect(py).toContain('"silent": True');
  });
});
