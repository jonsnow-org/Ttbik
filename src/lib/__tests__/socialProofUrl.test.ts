// The social-proof checker fetches a page the user names: only public https pages may be fetched (no internal addresses).
jest.mock("../prisma", () => ({ prisma: {} }));
import { isPublicPageUrl, pageHasCode } from "../socialProof";

describe("isPublicPageUrl", () => {
  it("accepts normal public profile pages", () => {
    for (const u of ["https://www.youtube.com/@me", "https://x.com/me", "https://www.tiktok.com/@me", "https://example.org/about", "https://8.8.8.8/x"])
      expect(isPublicPageUrl(u)).toBe(true);
  });
  it("refuses internal, non-https and odd addresses", () => {
    for (const u of [
      "http://example.org/", "https://localhost/", "https://127.0.0.1/", "https://10.0.0.5/", "https://172.16.0.1/", "https://192.168.1.1/",
      "https://169.254.169.254/latest/meta-data/", "https://100.64.0.1/", "https://0.0.0.0/", "https://[::1]/", "https://2130706433/",
      "https://0x7f000001/", "https://box.internal/", "https://printer.local/", "https://intranet/", "https://example.org:8443/",
      "https://user:pw@example.org/", "file:///etc/passwd", "not a url",
    ])
      expect(isPublicPageUrl(u)).toBe(false);
  });
  it("pageHasCode never fetches a refused address", async () => {
    const spy = jest.spyOn(global, "fetch" as any).mockResolvedValue({ ok: true, url: "", headers: new Headers(), text: async () => "SHAMYO1234" } as any);
    await expect(pageHasCode("https://169.254.169.254/", "SHAMYO1234")).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
    await expect(pageHasCode("https://example.org/me", "SHAMYO1234")).resolves.toBe(true);
    spy.mockRestore();
  });
});
