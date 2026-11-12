import fs from "fs";
import path from "path";

const source = (relative: string) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

describe("Mini App entry point coverage across supported bots", () => {
  it("ads and earnings bot registers its app menu on start and activation", () => {
    expect(source("adBotLogic.ts")).toContain("ensureBotAppMenu(botRow)");
    expect(source("../app/api/bots/deploy/route.ts")).toContain("setBotAppMenu(token, gateUrl(), botId)");
  });

  it("jobs, chains, and match bots register their own Mini Apps", () => {
    expect(source("jobsBotLogic.ts")).toContain("ensureJobsAppMenu(bot, botRow)");
    expect(source("streakBotLogic.ts")).toContain("ensureStreakAppMenu(botRow)");
    expect(source("matchBotLogic.ts")).toContain("ensureMatchBotSetup(bot, botRow.id)");
    expect(source("matchBotLogic.ts")).toContain("setChatMenuButton");
  });

  it("Fadaa registers its own Mini App menu button", () => {
    expect(source("fadaaBotLogic.ts")).toContain("setChatMenuButton");
    expect(source("fadaaBotLogic.ts")).toContain('text: "🌌 فضاء"');
  });

  it("media bot forces the Mini App menu on startup and application initialization", () => {
    const media = fs.readFileSync(path.join(__dirname, "..", "..", "..", "media-bot", "main.py"), "utf8");
    const keyboard = fs.readFileSync(path.join(__dirname, "..", "..", "..", "media-bot", "keyboards.py"), "utf8");
    expect(media).toContain("await _force_menu_button(context.bot)");
    expect(media).toContain("await _force_menu_button(application.bot)");
    expect(keyboard).toContain('MenuButtonWebApp(text="📱 التطبيق"');
  });

  it("user-created Mini Apps use a chat-specific menu target rather than a shared global button", () => {
    expect(source("hubBotLogic.ts")).toContain("setChatMiniAppMenu(bot.api, chatId, url)");
    expect(source("hubBotLogic.ts")).toContain("await activateUserAppMenu(bot, chatId, r.slug)");
    expect(source("hubBotLogic.ts")).not.toContain("BotFather ← Bot Settings ← Menu Button");
  });
});
