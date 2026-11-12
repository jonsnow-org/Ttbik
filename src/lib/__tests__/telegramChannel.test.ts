import {
  enforceRequiredChannel,
  normalizeRequiredChannel,
  requiredChannelChatId,
} from "@/lib/telegramChannel";

describe("normalizeRequiredChannel", () => {
  it.each([
    ["@Example_Channel", "Example_Channel"],
    ["Example_Channel", "Example_Channel"],
    ["https://t.me/Example_Channel?start=ref", "Example_Channel"],
    ["t.me/Example_Channel/123", "Example_Channel"],
    ["https://telegram.me/Example_Channel", "Example_Channel"],
    ["-1001234567890", "-1001234567890"],
    ["https://t.me/c/123456789/45", "-100123456789"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeRequiredChannel(input)).toBe(expected);
  });

  it.each(["", "not a channel", "https://t.me/+InviteHash", "https://t.me/joinchat/InviteHash", "@ab"])(
    "rejects unsupported channel input %s",
    (input) => expect(normalizeRequiredChannel(input)).toBeNull(),
  );

  it("returns an @handle or a numeric private-channel chat id", () => {
    expect(requiredChannelChatId("@Example_Channel")).toBe("@Example_Channel");
    expect(requiredChannelChatId("-1001234567890")).toBe("-1001234567890");
  });
});

describe("enforceRequiredChannel", () => {
  const row = { requiredChannel: "@Example_Channel", ownerId: "77" } as any;
  const makeBot = (status: string | Error = "member") => ({
    api: {
      getChatMember: jest.fn(async () => {
        if (status instanceof Error) throw status;
        return { status };
      }),
      sendMessage: jest.fn(async () => ({})),
    },
  }) as any;

  it("allows members and looks up the normalized Telegram channel", async () => {
    const bot = makeBot("member");
    await expect(enforceRequiredChannel(bot, row, 1, "99")).resolves.toBe(true);
    expect(bot.api.getChatMember).toHaveBeenCalledWith("@Example_Channel", 99);
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("prompts non-members and blocks their update", async () => {
    const bot = makeBot("left");
    await expect(enforceRequiredChannel(bot, row, 1, "99")).resolves.toBe(false);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(1, expect.stringContaining("https://t.me/Example_Channel"));
  });

  it("passes numeric private channel ids to Telegram without an @ prefix", async () => {
    const bot = makeBot("member");
    await enforceRequiredChannel(bot, { ...row, requiredChannel: "-1001234567890" }, 1, "99");
    expect(bot.api.getChatMember).toHaveBeenCalledWith("-1001234567890", 99);
  });

  it("bypasses the owner and bots with no configured channel", async () => {
    const bot = makeBot("left");
    await expect(enforceRequiredChannel(bot, row, 1, "77")).resolves.toBe(true);
    await expect(enforceRequiredChannel(bot, { ...row, requiredChannel: null }, 1, "99")).resolves.toBe(true);
    expect(bot.api.getChatMember).not.toHaveBeenCalled();
  });

  it("fails open on a temporary Telegram API error, preserving existing bot behavior", async () => {
    const bot = makeBot(new Error("Telegram unavailable"));
    await expect(enforceRequiredChannel(bot, row, 1, "99")).resolves.toBe(true);
  });

  it("fails closed on an invalid stored channel and alerts the user", async () => {
    const bot = makeBot("member");
    await expect(enforceRequiredChannel(bot, { ...row, requiredChannel: "https://t.me/+private" }, 1, "99")).resolves.toBe(false);
    expect(bot.api.getChatMember).not.toHaveBeenCalled();
    expect(bot.api.sendMessage).toHaveBeenCalledWith(1, expect.stringContaining("غير صالح"));
  });
});
