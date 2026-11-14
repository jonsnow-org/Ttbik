// «🧭 خدمات وأرباح» inside Telegram: the site's service pages open as Mini App pages from the existing bots.
import fs from "fs";
import path from "path";
import { SERVICE_LINKS, chainsBotLink, serviceBotLink } from "@/config/navigation";
import { SERVICES_BUTTON, isServicesRequest, sendServices, serviceUrl, servicesKeyboard, siteBotServicesKeyboard } from "@/lib/servicesInTelegram";
import { APP_SECTIONS } from "@/lib/botApp/buttons";

const TME: Record<string, string> = { khatma: "https://t.me/Slaselbot?start=khatma", contests: "https://t.me/Slaselbot?start=contest", shop: "https://t.me/Saragptbotbot?start=shops" };

describe("services keyboard", () => {
  it("one button per service, two per row: site pages as web_app, khatma & contests → @Slaselbot, shops → @Saragptbotbot", () => {
    const kb: any = servicesKeyboard([], "https://site.example");
    const rows: any[][] = kb.inline_keyboard.filter((r: any[]) => r.length);
    const flat = rows.flat();
    expect(flat).toHaveLength(SERVICE_LINKS.length);
    expect(rows.every((r) => r.length <= 2)).toBe(true);
    for (const b of flat) {
      const id = SERVICE_LINKS.find((s) => s.label === b.text)!.id;
      if (TME[id]) {
        expect(b.web_app).toBeUndefined();
        expect(b.url).toBe(TME[id]);
      } else expect(b.web_app.url).toMatch(/^https:\/\/site\.example\/[a-z-]+\?src=tg$/);
    }
  });
  it("puts the bot's own services first; the chains bot username can be passed", () => {
    const kb: any = servicesKeyboard(["khatma", "contests"], "https://s", "@OtherChains");
    expect(kb.inline_keyboard[0].map((b: any) => b.url)).toEqual(["https://t.me/OtherChains?start=khatma", "https://t.me/OtherChains?start=contest"]);
    const kb2: any = servicesKeyboard(["remit"], "https://s");
    expect(kb2.inline_keyboard[0][0].web_app.url).toBe(serviceUrl("/remit", "https://s"));
    const kb3: any = servicesKeyboard(["shop"], "https://s", "@OtherChains");
    expect(kb3.inline_keyboard[0][0].url).toBe("https://t.me/Saragptbotbot?start=shops");
  });
  it("chainsBotLink covers khatma, contests (chains bot) and shops (store bot) only", () => {
    expect(chainsBotLink("khatma")).toBe("https://t.me/Slaselbot?start=khatma");
    expect(chainsBotLink("contests")).toBe("https://t.me/Slaselbot?start=contest");
    expect(chainsBotLink("shop")).toBe("https://t.me/Saragptbotbot?start=shops");
    for (const id of ["remit", "channels", "channel-audit", "advertise"]) expect(chainsBotLink(id)).toBeNull();
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
    expect((sendMessage.mock.calls[0] as any[])[2].reply_markup.inline_keyboard[0][0].url).toBe("https://t.me/Saragptbotbot?start=shops");
  });
});

describe("site bot (@Admen10bot) services keyboard — phase 5", () => {
  it("routes every entry to its bot, drops the channel audit, keeps advertise as the site's own page", () => {
    const kb: any = siteBotServicesKeyboard("https://s");
    const flat = kb.inline_keyboard.flat();
    expect(flat.map((b: any) => b.url || b.web_app.url)).toEqual([
      "https://t.me/Sham_test0_bot?start=remit", "https://t.me/Sham_test0_bot?start=exchange", "https://s/advertise?src=tg",
      "https://t.me/Slaselbot?start=khatma", "https://t.me/Slaselbot?start=contest", "https://t.me/Saragptbotbot?start=shops",
    ]);
    expect(kb.inline_keyboard.filter((r: any[]) => r.length).every((r: any[]) => r.length <= 2)).toBe(true);
  });
  it("other bots' keyboards and the site menu are unchanged (remit still a site page there)", () => {
    const kb: any = servicesKeyboard([], "https://s");
    expect(kb.inline_keyboard.flat()).toHaveLength(SERVICE_LINKS.length);
    expect(serviceBotLink("remit")).toBe("https://t.me/Sham_test0_bot?start=remit");
    expect(chainsBotLink("remit")).toBeNull();
  });
  it("the platform bot opens the Mini App section for /start remit and /start exchange, never as a referral", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "adBotLogic.ts"), "utf8");
    expect(src).toContain('const section = payload === "remit" || payload === "exchange" ? payload : null;');
    expect(src).toMatch(/const referredBy = payload && !payTo && !section &&/);
    expect(src).toContain("botAppUrl(gateUrl(), botRow.id, section)");
    expect(APP_SECTIONS).toEqual(expect.arrayContaining(["remit", "exchange"]));
  });
});

describe("entry points in the existing bots and the media Mini App", () => {
  const lib = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  it("chains bot (@Slaselbot): its own Mini App button + menu button, khatma/contests open its app sections", () => {
    const src = lib("streakBotLogic.ts");
    expect(src).toMatch(/CONTEST_BUTTON, APP_BUTTON/);
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
    expect(src).toMatch(/if \(text === APP_BUTTON \|\| isServicesRequest\(text\)\)/);
    expect(src).toContain('text === APP_BUTTON');
    expect(src).toContain('botAppUrl(gateUrl(), botRow.id)');
  });
  it("media Mini App profile lists the services", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "app", "mini-app", "page.tsx"), "utf8");
    expect(src).toContain("SERVICE_LINKS.map");
    expect(src).toContain("chainsBotLink(sv.id)");
    expect(src).toContain("openTelegramLink(tme)");
  });
});
