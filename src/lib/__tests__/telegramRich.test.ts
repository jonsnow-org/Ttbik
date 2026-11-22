import { richSend, richDraft, richOnFor, richMode, wantsRich, hasMarkdownTable, isArabicText, _resetRichRefusal, RICH_MAX } from "@/lib/telegramRich";

describe("Telegram Rich Messages helper", () => {
  const keep = process.env.TG_RICH;
  afterEach(() => { if (keep === undefined) delete process.env.TG_RICH; else process.env.TG_RICH = keep; _resetRichRefusal(); });

  it("who gets it: the owner by default, everybody with 'all', nobody with 'off'", () => {
    delete process.env.TG_RICH;
    expect(richMode()).toBe("owner");
    expect(richOnFor(true)).toBe(true);
    expect(richOnFor(false)).toBe(false);
    process.env.TG_RICH = "all";
    expect(richOnFor(false)).toBe(true);
    process.env.TG_RICH = "off";
    expect(richOnFor(true)).toBe(false);
  });

  it("wants rich for a long answer or a Markdown table only", () => {
    expect(wantsRich("قصير")).toBe(false);
    expect(wantsRich("x".repeat(3801))).toBe(true);
    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(hasMarkdownTable(table)).toBe(true);
    expect(wantsRich(`النتيجة:\n${table}`)).toBe(true);
    expect(hasMarkdownTable("a | b\nplain")).toBe(false);
  });

  it("sends the model's Markdown with RTL for Arabic, no entity detection, and the right size cap", async () => {
    const calls: any[] = [];
    const api: any = { raw: { sendRichMessage: async (p: any) => { calls.push(p); return {}; } } };
    expect(isArabicText("مرحبا")).toBe(true);
    expect(await richSend(api, 5, "مرحبا **عالم** @someone #tag")).toBe(true);
    expect(calls[0]).toMatchObject({ chat_id: 5, rich_message: { markdown: "مرحبا **عالم** @someone #tag", is_rtl: true, skip_entity_detection: true } });
    await richSend(api, 5, "y".repeat(RICH_MAX + 500));
    expect(calls[1].rich_message.markdown.length).toBe(RICH_MAX);
    await richSend(api, 5, "hello");
    expect(calls[2].rich_message.is_rtl).toBe(false);
  });

  it("a draft carries the Stop button flags", async () => {
    const calls: any[] = [];
    const api: any = { raw: { sendRichMessageDraft: async (p: any) => { calls.push(p); return true; } } };
    expect(await richDraft(api, 7, 99, "جزء", { canStop: true, keepOnStop: true })).toBe(true);
    expect(calls[0]).toMatchObject({ chat_id: 7, draft_id: 99, can_stop: true, keep_on_stop: true });
  });

  it("falls back (false) when the API refuses, and a 'not supported' answer stops trying for an hour", async () => {
    const api: any = { raw: { sendRichMessage: async () => { throw new Error("Bad Request: method not found"); } } };
    expect(await richSend(api, 1, "text")).toBe(false);
    process.env.TG_RICH = "all";
    expect(richOnFor(true)).toBe(false);                // refused: off until the retry window passes
    _resetRichRefusal();
    expect(richOnFor(true)).toBe(true);
    const plain: any = {};
    expect(await richSend(plain, 1, "text")).toBe(false);   // an API object without the method: the old path
    const other: any = { raw: { sendRichMessage: async () => { throw new Error("Bad Request: chat not allowed to rate limit"); } } };
    expect(await richSend(other, 1, "text")).toBe(false);
    expect(richOnFor(true)).toBe(true);                 // a one-off error does not switch the feature off
  });
});
