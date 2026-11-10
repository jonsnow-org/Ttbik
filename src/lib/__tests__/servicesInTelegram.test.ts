// «🧭 خدمات وأرباح» inside Telegram: the site's service pages open as Mini App pages from the existing bots.
import fs from "fs";
import path from "path";
import { SERVICE_LINKS } from "@/config/navigation";
import { SERVICES_BUTTON, isServicesRequest, sendServices, serviceUrl, servicesKeyboard } from "@/lib/servicesInTelegram";

describe("services keyboard", () => {
  it("one https web_app button per service, two per row", () => {
    const kb: any = servicesKeyboard([], "https://site.example");
    const rows: any[][] = kb.inline_keyboard.filter((r: any[]) => r.length);
    const flat = rows.flat();
    expect(flat).toHaveLength(SERVICE_LINKS.length);
    expect(rows.every((r) => r.length <= 2)).toBe(true);
    for (const b of flat) expect(b.web_app.url).toMatch(/^https:\/\/site\.example\/[a-z-]+\?src=tg$/);
  });
  it("puts the bot's own services first", () => {
    const kb: any = servicesKeyboard(["khatma", "contests"], "https://s");
    const first = kb.inline_keyboard[0].map((b: any) => b.web_app.url);
    expect(first).toEqual([serviceUrl("/khatma", "https://s"), serviceUrl("/contests", "https://s")]);
  });
  it("answers the button and /services (with or without @bot)", () => {
    expect(isServicesRequest(SERVICES_BUTTON)).toBe(true);
    expect(isServicesRequest("/services")).toBe(true);
    expect(isServicesRequest("/services@Slaselbot")).toBe(true);
    expect(isServicesRequest("خدمات")).toBe(false);
  });
  it("sends one message with the keyboard", async () => {
    const sendMessage = jest.fn(async () => ({}));
    await sendServices({ api: { sendMessage } }, 5, ["shop"]);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect((sendMessage.mock.calls[0] as any[])[2].reply_markup.inline_keyboard[0][0].web_app.url).toContain("/shop?src=tg");
  });
});

describe("entry points in the existing bots and the media Mini App", () => {
  const lib = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  it.each([["streakBotLogic.ts", "khatma"], ["jobsBotLogic.ts", "shop"], ["adBotLogic.ts", "advertise"]])("%s: menu button + handler", (f, first) => {
    const src = lib(f);
    expect(src).toMatch(/\.text\(SERVICES_BUTTON\)/);
    expect(src).toMatch(/if \(isServicesRequest\(text\)\)/);
    expect(src).toContain(`sendServices(bot, chatId, ["${first}"`);
  });
  it("media Mini App profile lists the services", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "app", "mini-app", "page.tsx"), "utf8");
    expect(src).toContain("SERVICE_LINKS.map");
  });
});
