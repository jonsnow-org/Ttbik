process.env.SUPER_ADMIN_TELEGRAM_ID = "9001";
const rows: Record<string, { message_id: bigint | null }[]> = { khatma: [{ message_id: BigInt(100) }], contest_rounds: [{ message_id: BigInt(110) }] };
const execs: string[] = [];
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => (String(strings[0]).includes("FROM khatma") ? rows.khatma : rows.contest_rounds)),
    $executeRaw: jest.fn(async (strings: TemplateStringsArray) => { execs.push(String(strings[0])); return 1; }),
  },
}));
import { LEAVE_CMD, idsToDelete, leaveGroup, tryOwnerLeave } from "@/lib/groupLeave";

const mkBot = (status = "member") => ({ api: {
  getMe: jest.fn(async () => ({ id: 77, username: "Slaselbot" })),
  getChatMember: jest.fn(async () => ({ status })),
  deleteMessage: jest.fn(async (_c: unknown, id: number) => { if (id % 2) throw new Error("not mine"); return true; }),
  leaveChat: jest.fn(async () => true),
} }) as any;

describe("owner leaves a group", () => {
  it("scans the window between the oldest recorded message and the command, but never when the bot is an admin or the window is huge", () => {
    expect(idsToDelete([100, 110], 120, false)).toEqual(Array.from({ length: 24 }, (_, i) => 97 + i));
    expect(idsToDelete([100, 110], 120, true)).toEqual([100, 110]);
    expect(idsToDelete([100], 100 + 1000, false)).toEqual([100]);
    expect(idsToDelete([], 120, false)).toEqual([]);
  });
  it("recognises only /leave", () => {
    expect(LEAVE_CMD.test("/leave")).toBe(true);
    expect(LEAVE_CMD.test("/leave@Slaselbot")).toBe(true);
    expect(LEAVE_CMD.test("/leaves")).toBe(false);
  });
  it("deletes what it can, closes the chat's open khatma and rounds, then leaves", async () => {
    const bot = mkBot();
    const r = await leaveGroup(bot, { id: "b1" } as any, -1001, 120);
    expect(bot.api.deleteMessage).toHaveBeenCalled();
    expect(r.deleted).toBe(12); // the even ids of 97..120 succeed in the fake
    expect(execs.some((q) => q.includes("UPDATE khatma"))).toBe(true);
    expect(execs.some((q) => q.includes("UPDATE contest_rounds"))).toBe(true);
    expect(bot.api.leaveChat).toHaveBeenCalledWith(-1001);
    expect(r.left).toBe(true);
  });
  it("an admin bot deletes only the recorded messages", async () => {
    const bot = mkBot("administrator");
    await leaveGroup(bot, { id: "b1" } as any, -1001, 120);
    expect(bot.api.deleteMessage).toHaveBeenCalledTimes(2);
  });
  it("only the owner's /leave in a group is obeyed", async () => {
    const group = { type: "supergroup", id: -1001 };
    const bot = mkBot();
    expect(await tryOwnerLeave(bot, { id: "b1" } as any, { message: { chat: group, from: { id: 5 }, text: "/leave", message_id: 120 } })).toBe(false);
    expect(bot.api.leaveChat).not.toHaveBeenCalled();
    expect(await tryOwnerLeave(bot, { id: "b1" } as any, { message: { chat: { type: "private", id: 9001 }, from: { id: 9001 }, text: "/leave" } })).toBe(false);
    expect(await tryOwnerLeave(bot, { id: "b1" } as any, { message: { chat: group, from: { id: 9001 }, text: "/leave@Slaselbot", message_id: 120 } })).toBe(true);
    expect(bot.api.leaveChat).toHaveBeenCalledTimes(1);
  });
});
