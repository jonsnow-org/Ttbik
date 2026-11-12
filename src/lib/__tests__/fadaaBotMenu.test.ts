jest.mock("@/lib/botVisit", () => ({ recordBotVisit: jest.fn(async () => undefined) }));

import { handleFadaaBotUpdate } from "@/lib/fadaaBotLogic";

describe("Fadaa Mini App bot menu", () => {
  it("sets the persistent Telegram app button on /start for users and owners", async () => {
    const api = {
      setChatMenuButton: jest.fn(async () => true),
      sendMessage: jest.fn(async () => ({ message_id: 1 })),
    };
    await handleFadaaBotUpdate(
      { api } as any,
      { id: "fadaa-bot-1", ownerId: "900", token: "1:test" } as any,
      { message: { chat: { id: 900, type: "private" }, from: { id: 900 }, text: "/start" } },
    );

    expect(api.setChatMenuButton).toHaveBeenCalledWith({
      menu_button: {
        type: "web_app",
        text: "🌌 فضاء",
        web_app: { url: expect.stringContaining("/fadaa?bot=fadaa-bot-1") },
      },
    });
    expect(api.sendMessage).toHaveBeenCalled();
  });

  it("does not stop the welcome flow when Telegram temporarily rejects the menu button", async () => {
    const api = {
      setChatMenuButton: jest.fn().mockRejectedValue(new Error("Telegram unavailable")),
      sendMessage: jest.fn(async () => ({ message_id: 1 })),
    };
    await expect(handleFadaaBotUpdate(
      { api } as any,
      { id: "fadaa-bot-2", ownerId: "900", token: "1:test" } as any,
      { message: { chat: { id: 901, type: "private" }, from: { id: 901 }, text: "/start" } },
    )).resolves.toBeUndefined();
    expect(api.sendMessage).toHaveBeenCalled();
  });
});
