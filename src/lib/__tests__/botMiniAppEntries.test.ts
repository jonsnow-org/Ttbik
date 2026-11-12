import fs from "fs";
import path from "path";
import { startGuide } from "@/lib/botStartGuide";

const lib = (file: string) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const appFile = (file: string) => fs.readFileSync(path.join(__dirname, "..", "..", "app", file), "utf8");
const mediaFile = (file: string) => fs.readFileSync(path.join(__dirname, "..", "..", "..", "media-bot", file), "utf8");

describe("Mini App entry points are visible and actionable in their owning bots", () => {
  it("ads & earn bot: the user and owner menus expose the app and its label opens the signed Web App button", () => {
    const src = lib("adBotLogic.ts");
    expect(src.match(/\.text\(REMIT_BUTTON\)\.text\(APP_BUTTON\)/g)).toHaveLength(2);
    expect(src).toContain("    APP_BUTTON,");
    expect(src).toMatch(/if \(text === APP_BUTTON \|\| isServicesRequest\(text\)\)[\s\S]*?new InlineKeyboard\(\)\.webApp\(APP_BUTTON/);
    expect(src).toMatch(/const updated = await setBotAppMenu\([\s\S]*?if \(updated\) botAppMenuDone\.add\(botRow\.id\)/);
  });

  it("jobs & store bot: the main keyboard and Telegram menu button target its own bot-app", () => {
    const src = lib("jobsBotLogic.ts");
    expect(src).toMatch(/return kb\.text\(APP_BUTTON\)/);
    expect(src).toMatch(/if \(!ok\) appMenuSet\.delete\(botRow\.id\)/);
    expect(src).toContain('appLink(botId, "home")');
  });

  it("daily chains bot: its reply button, app sections and retry-on-failure remain available", () => {
    const src = lib("streakBotLogic.ts");
    expect(src).toMatch(/kb\.text\(CONTEST_BUTTON\)\.text\(APP_BUTTON\)/);
    expect(src).toContain('appUrlFor(botRow, "khatma")');
    expect(src).toContain('appUrlFor(botRow, "contests")');
    expect(src).toMatch(/const updated = await setBotAppMenu\([\s\S]*?if \(updated\) appMenuDone\.add\(botRow\.id\)/);
  });

  it("match bot: regular users and admins have their own application entry", () => {
    const src = lib("matchBotLogic.ts");
    expect(src).toContain('export const MATCH_APP_BUTTON = "📱 التطبيق"');
    expect(src).toMatch(/\[MATCH_APP_BUTTON\]/);
    expect(src).toMatch(/if \(text === MATCH_APP_BUTTON\)[\s\S]*?new InlineKeyboard\(\)\.webApp/);
    expect(src).toContain('const ADMIN_APP_BUTTON = "📱 التطبيق المصغر"');
    expect(src).toContain('text: "🛡 لوحة القيادة"');
    expect(src).toMatch(/if \(commandsReady && menuReady\) setupDone\.add\(botId\)/);
  });

  it("Fadaa retries its 🌌 app menu button on /start and shows the same entry in activation", () => {
    const src = lib("fadaaBotLogic.ts");
    const activate = appFile("api/admin/bots/activate-fadaa/route.ts");
    expect(src).toMatch(/if \(text\.startsWith\("\/start"\)\)[\s\S]*?setChatMenuButton\([\s\S]*?text: "🌌 فضاء"/);
    expect(activate).toContain('text: "🌌 فضاء"');
    expect(src).toContain('new Keyboard().text("🌌 فضاء")');
  });

  it("media bot uses the standard Arabic Mini App menu title", () => {
    const keyboards = mediaFile("keyboards.py");
    const main = mediaFile("main.py");
    expect(keyboards).toContain('MenuButtonWebApp(text="📱 التطبيق"');
    expect(main).toContain("await _force_menu_button(context.bot)");
  });

  it("shared bot app menu helper uses one consistent icon label", () => {
    const src = lib("builderOwnerBot.ts");
    expect(src).toContain('text: "📱 التطبيق", web_app: { url: botAppUrl(gateBase, botId) }');
  });
});

describe("Mini App verification controls report backend state", () => {
  it("jobs/store phone gate only unlocks after the webhook-backed init confirms the phone", () => {
    const src = appFile("bot-app/[botId]/JobsMiniApp.tsx");
    expect(src).toContain('import { waitForPhoneVerification } from "@/lib/botApp/phoneVerification"');
    expect(src).toMatch(/requestContact[\s\S]*?void checkPhone\(true\)/);
    expect(src).toContain('onClick={() => void checkPhone()}');
    expect(src).toContain('attempts: 25, intervalMs: 1_000');
    expect(src).toContain('document.addEventListener("visibilitychange", onReturn)');
    expect(src).not.toMatch(/requestContact && tg\.isVersionAtLeast/);
  });

  it("ads/earn phone gate stays visible until init returns phoneVerified=true", () => {
    const src = appFile("bot-app/[botId]/BotMiniApp.tsx");
    expect(src).toContain('import { waitForPhoneVerification } from "@/lib/botApp/phoneVerification"');
    expect(src).toMatch(/if \(verified\) \{[\s\S]*?setNeed\(null\)/);
    expect(src).toContain('onClick={() => void checkPhone()}');
    expect(src).toContain('if (init.user.phoneVerified) setNeed');
    expect(src).not.toMatch(/requestContact && tg\.isVersionAtLeast/);
  });

  it.each([
    ["AD Bot", "bot-app/[botId]/BotMiniApp.tsx"],
    ["Jobs Bot", "bot-app/[botId]/JobsMiniApp.tsx"],
    ["Streak Bot", "bot-app/[botId]/StreakMiniApp.tsx"],
  ])("%s channel gate exposes progress and a check result", (_name, file) => {
    const src = appFile(file);
    expect(src).toContain("جارٍ فحص الاشتراك");
    expect(src).toContain('role="status" aria-live="polite"');
    expect(src).toContain('disabled={gateBusy}');
    expect(src).toContain("checkGate");
  });
});

describe("bot start guides disclose existing Mini Apps", () => {
  it.each(["AD", "JOBS", "MATCH", "STREAK"] as const)("%s guide mentions the Mini App entry", (kind) => {
    expect(startGuide(kind)).toContain("📱 التطبيق");
  });

  it("does not invent a Mini App for bots without one", () => {
    for (const kind of ["CAPSULE", "CONFESSION", "NAME_COMPAT", "PRAYER", "QUIZ", "MEDICAL"] as const) {
      expect(startGuide(kind)).not.toContain("📱 التطبيق");
    }
  });
});
