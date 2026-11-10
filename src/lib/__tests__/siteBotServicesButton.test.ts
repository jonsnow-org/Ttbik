// The site bot (@Admen10bot) is served by /api/ads/telegram (webhook set by bindSiteBot); it is not a builder (AD_BOT) bot:
// «🧭 خدمات وأرباح» and /services must work there, and /start shows them.
jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: { json: (body: any, init?: any) => ({ body, status: init?.status || 200 }) },
}));
const noBotTable = jest.fn(async () => { throw new Error("the site bot touched the builder's Bot table"); });
const db: any = { bot: { findMany: noBotTable, findFirst: noBotTable, findUnique: noBotTable, update: noBotTable } };
jest.mock("@/lib/prisma", () => ({ prisma: db }));
jest.mock("@/lib/builderOwnerBot", () => ({ ownerBotGetbotLink: async () => "https://t.me/Sham_test0_bot?start=getbot" }));
const tg: { method: string; body: any }[] = [];
(global as any).fetch = jest.fn(async (url: string, init?: any) => {
  tg.push({ method: String(url).split("/").pop()!, body: init?.body ? JSON.parse(init.body) : {} });
  return { ok: true, json: async () => ({ ok: true, result: { username: "admen10bot" } }) };
});

import { POST } from "@/app/api/ads/telegram/route";
import { SERVICES_BUTTON } from "@/lib/servicesInTelegram";
import { SERVICE_LINKS } from "@/config/navigation";
import { GETBOT_BUTTON } from "@/lib/botSales";

const hook = (text: string) => POST({ json: async () => ({ message: { chat: { id: 7 }, from: { id: 7 }, text } }), headers: { get: () => null } } as any);
const sent = () => tg.filter((c) => c.method === "sendMessage").map((c) => c.body);

beforeEach(() => { tg.length = 0; delete process.env.TELEGRAM_WEBHOOK_SECRET; process.env.SITE_BOT_TOKEN = "t"; });

describe("site bot services entry point", () => {
  it.each([SERVICES_BUTTON, "/services", "/services@Admen10bot"])("%s → one message of web_app buttons for every service", async (text) => {
    await hook(text);
    const msgs = sent();
    expect(msgs).toHaveLength(1);
    const urls = msgs[0].reply_markup.inline_keyboard.flat().map((b: any) => b.web_app.url);
    expect(urls).toHaveLength(SERVICE_LINKS.length);
    for (const u of urls) expect(u).toMatch(/^https:\/\/.+\?src=tg$/);
    for (const u of urls.slice(0, 4)) expect(u).toMatch(/\/(advertise|channels|channel-audit|remit)\?/);
    expect(msgs[0].text).toContain("المنصة");
  });
  it("/start: help text with the services button in the reply keyboard, then the services", async () => {
    await hook("/start");
    const [help, services] = sent();
    expect(help.text).toContain(SERVICES_BUTTON);
    expect(help.reply_markup.keyboard.flat().map((b: any) => b.text)).toContain(SERVICES_BUTTON);
    expect(services.reply_markup.inline_keyboard.flat().length).toBe(SERVICE_LINKS.length);
  });
  it("any other text keeps the reply keyboard (now with the button) and names it", async () => {
    await hook("مرحبا");
    const [m] = sent();
    expect(m.text).toContain(`«${SERVICES_BUTTON}»`);
    expect(m.text.startsWith("بوت المنصة")).toBe(true);
    expect(m.reply_markup.keyboard.flat().map((b: any) => b.text)).toEqual(expect.arrayContaining(["الرصيد", "المحفظة", "شراء", "الموقع", SERVICES_BUTTON]));
  });
  it("«احصل على بوت مشابه» is not offered in the site bot: not in the keyboard, not in the /start text", async () => {
    await hook("/start");
    const [help] = sent();
    expect(help.text).not.toContain(GETBOT_BUTTON);
    expect(help.reply_markup.keyboard.flat().map((b: any) => b.text)).not.toContain(GETBOT_BUTTON);
    expect(help.reply_markup.keyboard.flat().map((b: any) => b.text)).toEqual(expect.arrayContaining(["الرصيد", "المحفظة", "شراء", "الموقع", SERVICES_BUTTON]));
  });
  it.each(["/start getbot", "/getbot", GETBOT_BUTTON])("%s → a link to the builder's owner bot, no plans here", async (text) => {
    await hook(text);
    const msgs = sent();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].reply_markup.inline_keyboard.flat()[0].url).toBe("https://t.me/Sham_test0_bot?start=getbot");
    expect(JSON.stringify(msgs[0])).not.toMatch(/bs:(free|paid)/);
  });
});
