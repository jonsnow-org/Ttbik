// B-09: the legacy-backend flag must not decide which model answers, nor block Nova.
import { readFileSync } from "fs";
import { join } from "path";
import { fakeBot } from "./coderFakes";

jest.mock("@/lib/novaPause", () => ({ NOVA_LEGACY_BACKEND_PAUSED: false, NOVA_LEGACY_PAUSED_TEXT: "legacy paused", novaLegacyBackendOn: () => true }));

import { handleNovaBotUpdate } from "@/lib/novaBotLogic";
import { shamVariant } from "@/lib/shamStudio";
import * as shamStudio from "@/lib/shamStudio";
import * as coderSections from "@/lib/coderSections";
import * as shamThreads from "@/lib/shamThreads";
import { drainLater } from "@/lib/coderRuntime";

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("legacy Nova backend flag (was NOVA_PAUSED)", () => {
  it("even with the flag OFF (legacy backend 'back'), a call made for a Sham chat stays on Sham's own handler (no legacy Nova flow)", async () => {
    const { bot, sent } = fakeBot();
    for (const variant of ["v1", "v2"] as const) {
      await shamVariant.run(variant, () => handleNovaBotUpdate(bot, { id: "b", template: "NOVA_BOT" } as any, { message: { chat: { id: 4242 }, from: { id: 4242 }, text: "/start" } }));
    }
    expect(sent.length).toBe(2);
    expect(sent.every((m) => /شام/.test(m.text))).toBe(true);
  });
  it("does not intercept Sham v2 identity questions with a canned Telegram reply", () => {
    const logic = read("src/lib/novaBotLogic.ts");
    const agent = read("src/lib/shamAgent.ts");
    expect(logic).not.toMatch(/shamV2IdentityAnswer|identity is a routing invariant/);
    expect(agent).not.toMatch(/SHAM_V2_IDENTITY_ANSWER|shamV2IdentityAnswer/);
    expect(logic).toContain("shamAgentAndSend");
  });
  it("the bot route no longer reads the flag: Nova's coder handler runs for every NOVA_BOT update (the chat's own model decides)", () => {
    const route = read("src/app/api/telegram/[botId]/route.ts");
    expect(route).not.toMatch(/from "@\/lib\/novaPause"|NOVA_PAUSED|NOVA_LEGACY_BACKEND/);
    expect(route).toMatch(/const coderHandled = await handleCoderSections\(/);
  });
  it("the in-bot purchase of Nova plans (Stars) does not depend on the flag", () => {
    for (const f of ["src/lib/coderStars.ts", "src/lib/coderPlans.ts", "src/lib/coderSections.ts", "src/lib/coderApp.ts"]) expect(read(f)).not.toMatch(/novaPause|NOVA_PAUSED/);
  });
  it("only legacy-backend code reads it (payments via the Render backend, dashboard plans, assist)", () => {
    const users = ["src/app/pay/nova/page.tsx", "src/app/api/nova/me/route.ts", "src/app/api/payments/nova-create-invoice/route.ts", "src/lib/novaAssist.ts"];
    for (const f of users) expect(read(f)).toMatch(/NOVA_LEGACY_BACKEND_PAUSED/);
    expect(read("src/lib/novaPause.ts")).not.toMatch(/export const NOVA_PAUSED\b/);
  });
  it("routes a Telegram photo through only the selected Sham v2 vision call", async () => {
    const previousToken = process.env.MODELSCOPE_API_TOKEN;
    process.env.MODELSCOPE_API_TOKEN = "unit-test-token";
    const photo = jest.spyOn(coderSections, "telegramPhoto").mockResolvedValue("data:image/jpeg;base64,aGVsbG8=");
    const vision = jest.spyOn(shamStudio, "shamUnderstandImage").mockImplementation(async (_b64, question) => {
      expect(shamVariant.getStore()).toBe("v2");
      return vision.mock.calls.length === 1 ? `رأيت الصورة: ${question}` : "error: selected Sham Studio returned no readable screenshot description.";
    });
    const save = jest.spyOn(shamThreads, "saveChatTurn").mockResolvedValue(undefined);
    const { bot, sent } = fakeBot();
    try {
      await shamVariant.run("v2", () => handleNovaBotUpdate(bot, { id: "b", template: "NOVA_BOT", token: "unused" } as any, {
        update_id: undefined,
        message: { chat: { id: 4242 }, from: { id: 4242 }, caption: "ما الذي يظهر؟", photo: [{ file_id: "photo-1", width: 800 }] },
      }));
      await drainLater(1000);
      expect(photo).toHaveBeenCalledWith(bot, expect.objectContaining({ id: "b" }), [{ file_id: "photo-1", width: 800 }]);
      expect(vision).toHaveBeenCalledWith("aGVsbG8=", "ما الذي يظهر؟");
      expect(save).toHaveBeenCalledWith(4242, "[صورة] ما الذي يظهر؟", "رأيت الصورة: ما الذي يظهر؟");
      expect(sent.some((message) => message.text === "رأيت الصورة: ما الذي يظهر؟")).toBe(true);
      await shamVariant.run("v2", () => handleNovaBotUpdate(bot, { id: "b", template: "NOVA_BOT", token: "unused" } as any, {
        update_id: undefined,
        message: { chat: { id: 4242 }, from: { id: 4242 }, photo: [{ file_id: "photo-2", width: 800 }] },
      }));
      await drainLater(1000);
      expect(vision).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenCalledTimes(1);
      expect(sent.some((message) => /تعذّر على شام v2 فهم الصورة عبر استوديوه المختار/.test(message.text))).toBe(true);
      expect(sent.some((message) => /Nova/.test(message.text))).toBe(false);
    } finally {
      jest.restoreAllMocks();
      if (previousToken === undefined) delete process.env.MODELSCOPE_API_TOKEN;
      else process.env.MODELSCOPE_API_TOKEN = previousToken;
    }
  });
});
