// The builder's owner bot is config-driven (env BUILDER_OWNER_BOT_ID or bot_settings `builder_owner_bot`) and unset-safe.
const rows: Record<string, any> = {
  "ad-1": { id: "ad-1", token: "111:a", template: "AD_BOT", isActive: true },
  "off-1": { id: "off-1", token: "222:b", template: "AD_BOT", isActive: false },
};
jest.mock("@/lib/prisma", () => ({ prisma: { bot: { findUnique: jest.fn(async ({ where }: any) => rows[where.id] ?? null) } } }));
let setting: unknown = null;
jest.mock("@/lib/supabase", () => ({
  supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: setting === null ? null : { value: setting } }) }) }) }) }),
}));
(global as any).fetch = jest.fn(async () => ({ json: async () => ({ ok: true, result: { username: "platform_bot" } }) }));

beforeEach(() => { jest.resetModules(); delete process.env.BUILDER_OWNER_BOT_ID; setting = null; });
const load = () => require("@/lib/builderOwnerBot") as typeof import("@/lib/builderOwnerBot");

describe("builder owner bot config", () => {
  it("unset → no owner bot and no link (features degrade, nothing hardcoded)", async () => {
    const m = load();
    expect(await m.ownerBotId()).toBe("");
    expect(await m.ownerBot()).toBeNull();
    expect(await m.ownerBotGetbotLink()).toBeNull();
    expect(await m.isOwnerBot("ad-1")).toBe(false);
  });
  it("bot_settings value selects an active AD_BOT row", async () => {
    setting = "ad-1";
    const m = load();
    expect(await m.isOwnerBot("ad-1")).toBe(true);
    expect(await m.ownerBotGetbotLink()).toBe("https://t.me/platform_bot?start=getbot");
  });
  it("env wins over the setting; an inactive row is not used", async () => {
    setting = "ad-1";
    process.env.BUILDER_OWNER_BOT_ID = "off-1";
    const m = load();
    expect(await m.ownerBotId()).toBe("off-1");
    expect(await m.ownerBot()).toBeNull();
  });
  it("parses /ownerbot and /ownerbot off", () => {
    const m = load();
    expect(m.parseOwnerBotCommand("/ownerbot")).toEqual({ off: false });
    expect(m.parseOwnerBotCommand("/ownerbot@x_bot off")).toEqual({ off: true });
    expect(m.parseOwnerBotCommand("/ownerbots")).toBeNull();
  });
});
