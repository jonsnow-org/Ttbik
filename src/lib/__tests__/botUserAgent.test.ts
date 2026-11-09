// Visitor numbers must be people: machines and automated browsers are not counted; real phones and desktops are.
import { isEventPath, isMachineUserAgent } from "../botUserAgent";

describe("isMachineUserAgent", () => {
  it("counts real browsers", () => {
    for (const ua of [
      "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ]) expect(isMachineUserAgent(ua)).toBe(false);
  });
  it("drops crawlers, monitors and headless browsers", () => {
    for (const ua of [
      "", "Googlebot/2.1", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
      "Mozilla/5.0 ... Chrome-Lighthouse", "python-requests/2.32", "curl/8.5.0", "axios/1.7.2", "node-fetch", "UptimeRobot/2.0", "TelegramBot (like TwitterBot)",
    ]) expect(isMachineUserAgent(ua)).toBe(true);
  });
  it("recognises conversion event paths", () => {
    expect(isEventPath("evt:share_whatsapp:/free-tools/qr-generator")).toBe(true);
    expect(isEventPath("evt:../x")).toBe(false);
    expect(isEventPath("/free-tools")).toBe(false);
  });
});
