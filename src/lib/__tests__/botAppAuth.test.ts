// The ads & earn bots' Mini App API (/api/bot-app/<botId>): every call must carry initData signed with THAT bot's token.
import { NextRequest } from "next/server";
import { signInitData } from "@/lib/match/inline";

const TOKEN_A = "111:AAA-test-token-a";
const TOKEN_B = "222:BBB-test-token-b";
const bots: Record<string, any> = {
  "bot-a": { id: "bot-a", token: TOKEN_A, isActive: true, template: "AD_BOT", ownerId: "900" },
  "bot-b": { id: "bot-b", token: TOKEN_B, isActive: true, template: "AD_BOT", ownerId: "901" },
  "bot-off": { id: "bot-off", token: TOKEN_A, isActive: false, template: "AD_BOT", ownerId: "900" },
  "bot-coder": { id: "bot-coder", token: TOKEN_A, isActive: true, template: "CODER_BOT", ownerId: "900" },
};
jest.mock("@/lib/prisma", () => ({ prisma: { bot: { findUnique: jest.fn(async ({ where }: any) => bots[where.id] || null) } } }));
const handle = jest.fn(async (_row: any, tg: any, action: string) => ({ ok: true, uid: tg.id, action }));
jest.mock("@/lib/botApp/adApp", () => ({ handleAdAppAction: (...a: any[]) => (handle as any)(...a) }));

import { POST } from "@/app/api/bot-app/[botId]/route";

const initFor = (token: string, id = 4242) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000) - 30), query_id: "q1", user: JSON.stringify({ id, first_name: "Sam", username: "sam" }) }, token);
const call = (botId: string, body: any) =>
  POST(new NextRequest(`https://x.test/api/bot-app/${botId}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ botId }) });

beforeEach(() => handle.mockClear());

describe("bot-app API auth (initData per bot)", () => {
  it("accepts initData signed with this bot's token and takes the user id from Telegram, not from the body", async () => {
    const res = await call("bot-a", { initData: initFor(TOKEN_A, 4242), action: "init", userId: "999", id: "999" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, uid: "4242", action: "init" });
    expect(handle.mock.calls[0][0].id).toBe("bot-a");
  });
  it("rejects initData signed for another bot (bot B's user cannot act inside bot A)", async () => {
    const res = await call("bot-a", { initData: initFor(TOKEN_B), action: "wallet" });
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
    const ok = await call("bot-b", { initData: initFor(TOKEN_B), action: "wallet" });
    expect(ok.status).toBe(200);
  });
  it("rejects tampered initData", async () => {
    const good = initFor(TOKEN_A, 4242);
    const params = new URLSearchParams(good);
    params.set("user", JSON.stringify({ id: 5555, first_name: "Sam", username: "sam" })); // same hash, someone else's id
    const forged = params.toString();
    const res = await call("bot-a", { initData: forged, action: "withdraw" });
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });
  it("missing initData or action is a bad request", async () => {
    expect((await call("bot-a", { action: "init" })).status).toBe(400);
    expect((await call("bot-a", { initData: initFor(TOKEN_A) })).status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });
  it("only active AD_BOT bots have this app (404 otherwise)", async () => {
    for (const id of ["bot-off", "bot-coder", "nope"]) {
      const res = await call(id, { initData: initFor(TOKEN_A), action: "init" });
      expect(res.status).toBe(404);
    }
    expect(handle).not.toHaveBeenCalled();
  });
  it("an outdated initData (older than a day) is refused", async () => {
    const old = signInitData({ auth_date: String(Math.floor(Date.now() / 1000) - 3 * 86400), user: JSON.stringify({ id: 1 }) }, TOKEN_A);
    expect((await call("bot-a", { initData: old, action: "init" })).status).toBe(401);
  });
});
