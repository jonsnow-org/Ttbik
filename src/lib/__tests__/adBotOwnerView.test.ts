// The owner bot's panel switch: admin panel by default, «👤 لوحة المستخدم» shows what the supervisor/users see, «🛠 لوحة الإدارة» goes back.
process.env.SUPER_ADMIN_TELEGRAM_ID = "900";
const store: Record<string, unknown> = {};
jest.mock("@/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: (_c: string, k: string) => ({ maybeSingle: async () => ({ data: k in store ? { value: store[k] } : null }) }) }),
      upsert: async (row: { key: string; value: unknown }) => { store[row.key] = row.value; return {}; },
    }),
  }),
}));
const sent: string[] = [];
const api: any = {
  getMe: jest.fn(async () => ({ id: 77, username: "Sham_test0_bot" })),
  sendMessage: jest.fn(async (_c: unknown, text: string) => { sent.push(text); return {}; }),
  answerCallbackQuery: jest.fn(async () => true),
  getChatMember: jest.fn(async () => ({ status: "member" })),
  setChatMenuButton: jest.fn(async () => true),
};
jest.mock("grammy", () => {
  class Keyboard { requestContact() { return this; } row() { return this; } text() { return this; } resized() { return this; } persistent() { return this; } }
  class InlineKeyboard { text() { return this; } row() { return this; } url() { return this; } webApp() { return this; } }
  class Bot { api = api; constructor(public token: string) {} }
  return { Bot, Keyboard, InlineKeyboard };
});
const db: any = {
  user: {
    upsert: jest.fn(async ({ where }: any) => ({ id: where.id, balance: 0, language: "ar", phoneVerified: true, pendingAction: null })),
    update: jest.fn(async () => ({})),
    findUnique: jest.fn(async () => ({ balance: 0 })),
    count: jest.fn(async () => 0),
    findMany: jest.fn(async () => []),
  },
  bot: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
  botVisit: { upsert: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
  $queryRaw: jest.fn(async () => []),
  $executeRaw: jest.fn(async () => 0),
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));
jest.mock("@/lib/builderOwnerBot", () => ({
  ...jest.requireActual("@/lib/builderOwnerBot"),
  isOwnerBot: jest.fn(async () => true),
  ownerBotGetbotLink: jest.fn(async () => null),
  setBotAppMenu: jest.fn(async () => true),
}));
jest.mock("@/lib/botVisit", () => ({ recordBotVisit: jest.fn(async () => undefined), countBotVisitors: jest.fn(async () => 0) }));
import { handleAdBotUpdate } from "@/lib/adBotLogic";
import { ADMIN_VIEW_BTN, USER_VIEW_BTN } from "@/lib/ownerPanel";

const ownerBot: any = { id: "bot-owner", token: "1:t", ownerId: "900", requiredChannel: null, template: "AD_BOT", isActive: true };
const supervisorBot: any = { id: "bot-sup", token: "2:t", ownerId: "555", requiredChannel: null, template: "AD_BOT", isActive: true };
const say = (text: string, from = 900) => ({ message: { chat: { id: from }, from: { id: from, first_name: "O" }, text } });
beforeEach(() => { sent.length = 0; for (const k of Object.keys(store)) delete store[k]; jest.clearAllMocks(); });

describe("ads & earn owner bot: panel switch", () => {
  it("by default the owner sees the platform-owner panel", async () => {
    await handleAdBotUpdate({ api } as any, ownerBot, say("/start"));
    expect(sent.join("\n")).toContain("لوحة تحكم المالك");
  });
  it("«👤 لوحة المستخدم» shows the supervisor panel instead, and «🛠 لوحة الإدارة» goes back", async () => {
    await handleAdBotUpdate({ api } as any, ownerBot, say(USER_VIEW_BTN));
    expect(store["owner_user_view:bot-owner"]).toBe(true);
    expect(sent.join("\n")).toContain("أنت منشئ هذا البوت");
    expect(sent.join("\n")).not.toContain("لوحة تحكم المالك");
    sent.length = 0;
    await handleAdBotUpdate({ api } as any, ownerBot, say(ADMIN_VIEW_BTN));
    expect(store["owner_user_view:bot-owner"]).toBe(false);
    expect(sent.join("\n")).toContain("لوحة تحكم المالك");
  });
  it("on a supervisor's bot nothing changes: no switch, the owner stays a platform owner there", async () => {
    await handleAdBotUpdate({ api } as any, supervisorBot, say("/start"));
    expect(sent.join("\n")).toContain("أنت مالك المنصة");
    expect(store["owner_user_view:bot-sup"]).toBeUndefined();
    await handleAdBotUpdate({ api } as any, supervisorBot, say(USER_VIEW_BTN));
    expect(store["owner_user_view:bot-sup"]).toBeUndefined(); // the button text is just text there
  });
  it("an ordinary user typing the switch text changes nothing", async () => {
    await handleAdBotUpdate({ api } as any, ownerBot, say(USER_VIEW_BTN, 4242));
    expect(store["owner_user_view:bot-owner"]).toBeUndefined();
  });
});
