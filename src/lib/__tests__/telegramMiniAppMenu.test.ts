import { setChatMiniAppMenu } from "@/lib/telegramMiniAppMenu";

describe("chat-scoped Telegram Mini App menu", () => {
  it("registers the selected app only for the creator's chat", async () => {
    const setChatMenuButton = jest.fn(async () => true);
    const ok = await setChatMiniAppMenu({ setChatMenuButton }, 424242, "https://site.example/apps/store-123");

    expect(ok).toBe(true);
    expect(setChatMenuButton).toHaveBeenCalledTimes(1);
    expect(setChatMenuButton).toHaveBeenCalledWith({
      chat_id: 424242,
      menu_button: {
        type: "web_app",
        text: "📱 التطبيق",
        web_app: { url: "https://site.example/apps/store-123" },
      },
    });
  });

  it("rejects non-HTTPS URLs and invalid chat ids without touching Telegram", async () => {
    const setChatMenuButton = jest.fn(async () => true);
    expect(await setChatMiniAppMenu({ setChatMenuButton }, 0, "https://site.example/apps/a")).toBe(false);
    expect(await setChatMiniAppMenu({ setChatMenuButton }, 42, "http://site.example/apps/a")).toBe(false);
    expect(setChatMenuButton).not.toHaveBeenCalled();
  });

  it("does not cache a Telegram failure; a later request can retry", async () => {
    const setChatMenuButton = jest.fn()
      .mockRejectedValueOnce(new Error("Telegram temporarily unavailable"))
      .mockResolvedValueOnce(true);
    const api = { setChatMenuButton };

    expect(await setChatMiniAppMenu(api, 424242, "https://site.example/apps/a")).toBe(false);
    expect(await setChatMiniAppMenu(api, 424242, "https://site.example/apps/a")).toBe(true);
    expect(setChatMenuButton).toHaveBeenCalledTimes(2);
  });

  it("limits the visible menu label to Telegram's text limit", async () => {
    const setChatMenuButton = jest.fn(async () => true);
    const longLabel = "📱".repeat(100);
    await setChatMiniAppMenu({ setChatMenuButton }, 424242, "https://site.example/apps/a", longLabel);
    expect(setChatMenuButton.mock.calls[0][0].menu_button.text.length).toBeLessThanOrEqual(64);
  });
});
