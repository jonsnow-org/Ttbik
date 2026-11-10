// «🧭 خدمات وأرباح» inside Telegram: the site's service pages open as Mini App pages from the existing bots.
import fs from "fs";
import path from "path";
import { SERVICE_LINKS, chainsBotLink } from "@/config/navigation";
import { SERVICES_BUTTON, isServicesRequest, sendServices, serviceUrl, servicesKeyboard } from "@/lib/servicesInTelegram";

const IN_CHAINS = new Set(["khatma", "contests"]);

describe("services keyboard", () => {
  it("one button per service, two per row: site pages as web_app, khatma & contests as a t.me link to @Slaselbot", () => {
    const kb: any = servicesKeyboard([], "https://site.example");
    const rows: any[][] = kb.inline_keyboard.filter((r: any[]) => r.length);
    const flat = rows.flat();
    expect(flat).toHaveLength(SERVICE_LINKS.length);
    expect(rows.every((r) => r.length <= 2)).toBe(true);
    for (const b of flat) {
      const id = SERVICE_LINKS.find((s) => s.label === b.text)!.id;
      if (IN_CHAINS.has(id)) {
        expect(b.web_app).toBeUndefined();
        expect(b.url).toBe(id === "khatma" ? "https://t.me/Slaselbot?start=khatma" : "https://t.me/Slaselbot?start=contest");
      } else expect(b.web_app.url).toMatch(/^https:\/\/site\.example\/[a-z-]+\?src=tg$/);
    }
  });
  it("puts the bot's own services first; the chains bot username can be passed", () => {
    const kb: any = servicesKeyboard(["khatma", "contests"], "https://s", "@OtherChains");
    expect(kb.inline_keyboard[0].map((b: any) => b.url)).toEqual(["https://t.me/OtherChains?start=khatma", "https://t.me/OtherChains?start=contest"]);
    const kb2: any = servicesKeyboard(["shop"], "https://s");
    expect(kb2.inline_keyboard[0][0].web_app.url).toBe(serviceUrl("/shop", "https://s"));
  });
  it("chainsBotLink only covers khatma and contests", () => {
    expect(chainsBotLink("khatma")).toBe("https://t.me/Slaselbot?start=khatma");
    expect(chainsBotLink("contests")).toBe("https://t.me/Slaselbot?start=contest");
    expect(chainsBotLink("shop")).toBeNull();
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
  it("chains bot (@Slaselbot): its own Mini App button + menu button, khatma/contests open its app sections", () => {
    const src = lib("streakBotLogic.ts");
    expect(src).toMatch(/\.text\(CONTEST_BUTTON\)\.text\(APP_BUTTON\)/);
    expect(src).not.toContain("sendServices(");
    expect(src).toContain("setBotAppMenu(");
    expect(src).toContain('appUrlFor(botRow, "khatma")');
    expect(src).toContain('appUrlFor(botRow, "contests")');
  });
  it.each([["jobsBotLogic.ts", "shop"]])("%s: menu button + handler", (f, first) => {
    const src = lib(f);
    expect(src).toMatch(/\.text\(SERVICES_BUTTON\)/);
    expect(src).toMatch(/if \(isServicesRequest\(text\)\)/);
    expect(src).toContain(`sendServices(bot, chatId, ["${first}"`);
  });
  it("ads & earn bots: no site-services button in the menu; /services opens the bot's own Mini App", () => {
    const src = lib("adBotLogic.ts");
    expect(src).not.toMatch(/\.text\(SERVICES_BUTTON\)/);
    expect(src).not.toMatch(/\.text\(GETBOT_BUTTON\)/);
    expect(src).not.toContain("sendServices(");
    expect(src).toMatch(/if \(isServicesRequest\(text\)\)/);
    expect(src).toContain('botAppUrl(gateUrl(), botRow.id)');
  });
  it("media Mini App profile lists the services", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "app", "mini-app", "page.tsx"), "utf8");
    expect(src).toContain("SERVICE_LINKS.map");
    expect(src).toContain("chainsBotLink(sv.id)");
    expect(src).toContain("openTelegramLink(tme)");
  });
});
