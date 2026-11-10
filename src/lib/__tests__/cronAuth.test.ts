// Every cron/internal status route answers only `Authorization: Bearer $CRON_SECRET`.
import fs from "fs";
import path from "path";
import { isCronAuthorized } from "@/lib/cronAuth";

const req = (auth?: string) => new Request("https://x/api/cron/y", { headers: auth ? { authorization: auth } : {} });

describe("isCronAuthorized", () => {
  const old = process.env.CRON_SECRET;
  afterEach(() => { process.env.CRON_SECRET = old; });
  it("accepts only the exact bearer secret", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized(req("Bearer s3cret"))).toBe(true);
    expect(isCronAuthorized(req("Bearer wrong"))).toBe(false);
    expect(isCronAuthorized(req("s3cret"))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });
  it("stays locked when no secret is configured", () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(req("Bearer "))).toBe(false);
    expect(isCronAuthorized(req("Bearer undefined"))).toBe(false);
  });
});

describe("routes that were public", () => {
  const APP = path.join(__dirname, "..", "..", "app", "api");
  it.each(["cron/fake-chat-cleanup", "cron/ads-expire", "internal/fake-chat-timeout"])("%s GET checks the cron secret first", (r) => {
    const src = fs.readFileSync(path.join(APP, r, "route.ts"), "utf8");
    const get = src.slice(src.indexOf("export async function GET"));
    expect(get.split("\n").slice(0, 2).join("\n")).toMatch(/if \(!isCronAuthorized\(req\)\) return NextResponse\.json\(\{ error: "unauthorized" \}, \{ status: 401 \}\)/);
  });
});
