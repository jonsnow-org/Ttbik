import { parseMuseCommand, museIssue, handleMuseUpdate } from "@/lib/museBridge";

jest.mock("@/lib/coderAuth", () => ({ tierFor: (id: number) => (id === 42 ? "owner" : "user") }));

describe("museBridge", () => {
  it("parses only its four commands", () => {
    expect(parseMuseCommand("/build صفحة login")).toEqual({ cmd: "build", body: "صفحة login" });
    expect(parseMuseCommand("/full@NovaBot قم بإعادة هيكلة المشروع")).toEqual({ cmd: "full", body: "قم بإعادة هيكلة المشروع" });
    expect(parseMuseCommand("/muse")).toEqual({ cmd: "muse", body: "" });
    expect(parseMuseCommand("/start")).toBeNull();
    expect(parseMuseCommand("hello")).toBeNull();
  });

  it("builds the issue: Telegram title, labels, chat marker; /full adds muse-full", () => {
    const f = museIssue("full", "refactor all", 42, 7);
    expect(f.title).toBe("Telegram: [refactor all]");
    expect(f.labels).toEqual(["from-telegram", "muse-full"]);
    expect(f.body).toContain("<!-- tg-chat:42 -->");
    expect(museIssue("build", "login", 42, 8).labels).not.toContain("muse-full");
    expect(museIssue("muse", "x".repeat(300), 1, 1).title.length).toBeLessThan(110);
  });

  it("answers only the owner, opens one issue, and leaves other messages to the models", async () => {
    const sent: string[] = [];
    const bot = { api: { sendMessage: async (_c: number, t: string) => { sent.push(t); } } };
    process.env.MUSE_GITHUB_TOKEN = "t";
    process.env.MUSE_REPO = "o/r";
    const calls: { url: string; body: any }[] = [];
    const fake = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 201, json: async () => ({ number: 12 }) }; }) as unknown as typeof fetch;
    expect(await handleMuseUpdate(bot, { update_id: 1, message: { text: "/full hack", chat: { id: 999 } } }, fake)).toBe(false);   // not the owner: ordinary message
    expect(calls).toHaveLength(0);
    expect(await handleMuseUpdate(bot, { update_id: 2, message: { text: "hello", chat: { id: 42 } } }, fake)).toBe(false);
    expect(await handleMuseUpdate(bot, { update_id: 3, message: { text: "/full قم بإعادة هيكلة المشروع", chat: { id: 42 } } }, fake)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/issues");
    expect(calls[0].body.labels).toContain("muse-full");
    expect(sent[sent.length - 1]).toContain("#12");
    delete process.env.MUSE_GITHUB_TOKEN;
    expect(await handleMuseUpdate(bot, { update_id: 4, message: { text: "/build x", chat: { id: 42 } } }, fake)).toBe(true);
    expect(sent[sent.length - 1]).toContain("MUSE_GITHUB_TOKEN");
  });
});
