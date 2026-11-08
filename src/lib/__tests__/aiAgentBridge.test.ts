import { parseAiCommand, aiAgentIssue, handleAiAgentUpdate } from "@/lib/aiAgentBridge";

jest.mock("@/lib/prisma", () => ({ prisma: { $executeRawUnsafe: async () => 0, $queryRawUnsafe: async () => [] } }));
jest.mock("@/lib/coderAuth", () => ({ tierFor: (id: number) => (id === 42 ? "owner" : "user") }));

describe("aiBridge", () => {
  it("parses only its four commands", () => {
    expect(parseAiCommand("/build صفحة login")).toEqual({ cmd: "build", body: "صفحة login" });
    expect(parseAiCommand("/full@NovaBot قم بإعادة هيكلة المشروع")).toEqual({ cmd: "full", body: "قم بإعادة هيكلة المشروع" });
    expect(parseAiCommand("/ai")).toEqual({ cmd: "ai", body: "" });
    expect(parseAiCommand("/start")).toBeNull();
    expect(parseAiCommand("hello")).toBeNull();
  });

  it("builds the issue: Telegram title, labels, chat marker; /full adds ai-full", () => {
    const f = aiAgentIssue("full", "refactor all", 42, 7);
    expect(f.title).toBe("Telegram: [refactor all]");
    expect(f.labels).toEqual(["from-telegram", "ai-full"]);
    expect(f.body).toContain("<!-- tg-chat:42 -->");
    expect(aiAgentIssue("build", "login", 42, 8).labels).not.toContain("ai-full");
    expect(aiAgentIssue("ai", "x".repeat(300), 1, 1).title.length).toBeLessThan(110);
  });

  it("answers only the owner, opens one issue, and leaves other messages to the models", async () => {
    const sent: string[] = [];
    const bot = { api: { sendMessage: async (_c: number, t: string) => { sent.push(t); } } };
    process.env.AI_GITHUB_TOKEN = "t";
    process.env.AI_REPO = "o/r";
    const calls: { url: string; body: any }[] = [];
    const fake = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 201, json: async () => ({ number: 12 }) }; }) as unknown as typeof fetch;
    expect(await handleAiAgentUpdate(bot, { update_id: 1, message: { text: "/full hack", chat: { id: 999 } } }, fake)).toBe(false);   // not the owner: ordinary message
    expect(calls).toHaveLength(0);
    expect(await handleAiAgentUpdate(bot, { update_id: 2, message: { text: "hello", chat: { id: 42 } } }, fake)).toBe(false);
    expect(await handleAiAgentUpdate(bot, { update_id: 3, message: { text: "/full قم بإعادة هيكلة المشروع", chat: { id: 42 } } }, fake)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/issues");
    expect(calls[0].body.labels).toContain("ai-full");
    expect(sent[sent.length - 1]).toContain("#12");
    delete process.env.AI_GITHUB_TOKEN;
    expect(await handleAiAgentUpdate(bot, { update_id: 4, message: { text: "/build x", chat: { id: 42 } } }, fake)).toBe(true);
    expect(sent[sent.length - 1]).toContain("AI_GITHUB_TOKEN");
  });
});
