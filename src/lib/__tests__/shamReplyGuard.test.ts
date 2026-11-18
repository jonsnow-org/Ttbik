jest.mock("@/lib/shamAdminNotice", () => ({ shamAdminNotice: jest.fn(async () => false) }));
import { isEchoedPriorReply, isTrainingStatusReply, lastUserContent, shamDirectChatMessages, visibleShamReply, STALE_REPLY_USER } from "@/lib/shamReplyGuard";
import { shamAgentRun, type ShamAsk } from "@/lib/shamAgent";
import { shamVariant } from "@/lib/shamStudio";
import type { ShamCtx } from "@/lib/shamExec";

describe("visibleShamReply duplicate sentence protection", () => {
  it("removes an identical repeated introduction sentence without replacing the model wording", () => {
    const first = "أنا شام برو، مساعد ذكاء اصطناعي من فريق المشروع، وأساعدك في الكتابة والبرمجة والبحث.";
    const reply = "مرحباً! " + first + " " + first;
    expect(visibleShamReply(reply).text).toBe("مرحباً! " + first);
  });
});

describe("shamDirectChatMessages", () => {
  it("always ends with the new user text, even when history has a previous greeting", () => {
    const first = shamDirectChatMessages([], "مرحبا كيف حالك");
    const second = shamDirectChatMessages(
      [{ q: "مرحبا كيف حالك", a: "أهلاً، أنا بخير. كيف أساعدك؟" }],
      "ماهي الموصلات المتاحة لديك هل ترى بينها موصل جيتهوب",
    );
    expect(lastUserContent(first)).toBe("مرحبا كيف حالك");
    expect(lastUserContent(second)).toBe("ماهي الموصلات المتاحة لديك هل ترى بينها موصل جيتهوب");
    expect(lastUserContent(first)).not.toBe(lastUserContent(second));
    expect(second.map((m) => m.content)).toEqual([
      "مرحبا كيف حالك",
      "أهلاً، أنا بخير. كيف أساعدك؟",
      "ماهي الموصلات المتاحة لديك هل ترى بينها موصل جيتهوب",
    ]);
  });
});

describe("isTrainingStatusReply / isEchoedPriorReply", () => {
  it("detects a checkpoint inventory / training report", () => {
    const report = "🧠 تقرير جلسة شام — المسار الرئيسي\nخطوات تدريب حقيقية هذه الجلسة: 12 (الخطوة النهائية: 1,234)\n| sham-checkpoint | 120 |";
    expect(isTrainingStatusReply(report)).toBe(true);
    expect(isTrainingStatusReply("أهلاً، أنا بخير. كيف أساعدك؟")).toBe(false);
  });
  it("detects a word-for-word copy of the previous assistant reply", () => {
    const prior = "أهلاً، أنا بخير. كيف أساعدك؟";
    expect(isEchoedPriorReply(prior, [{ q: "مرحبا كيف حالك", a: prior }])).toBe(true);
    expect(isEchoedPriorReply("الموصلات المتاحة: GitHub.", [{ q: "مرحبا كيف حالك", a: prior }])).toBe(false);
  });
  it("last-line defense replaces a copied or training-report reply", () => {
    const prior = "أهلاً، أنا بخير. كيف أساعدك؟";
    expect(visibleShamReply(prior, [{ q: "مرحبا كيف حالك", a: prior }])).toEqual({ text: STALE_REPLY_USER, blocked: "echo" });
    const report = "🧠 تقرير جلسة شام\nخطوات تدريب حقيقية هذه الجلسة: 8\n| sham-checkpoint | 12 |";
    expect(visibleShamReply(report, [])).toEqual({ text: STALE_REPLY_USER, blocked: "report" });
    expect(visibleShamReply("نعم، أرى موصل GitHub.", [{ q: "مرحبا كيف حالك", a: prior }])).toEqual({ text: "نعم، أرى موصل GitHub.", blocked: "" });
  });
});

const ctx = { chatId: 9, db: { exec: async () => undefined, query: async () => [] }, chatKey: "sham:9", owner: true } as unknown as ShamCtx;

describe("Sham 2 does not deliver a copied or training-report reply", () => {
  it("retries two different prompts until the answers are relevant and distinct", async () => {
    const seen: string[] = [];
    const ask: ShamAsk = async (prompt) => {
      seen.push(prompt);
      if (prompt.includes("موصلات") && seen.filter((p) => p.includes("موصلات")).length === 1) {
        return { type: "text", text: "أهلاً، أنا بخير. كيف أساعدك؟" } as any;
      }
      if (prompt.includes("موصلات")) return { type: "text", text: "نعم، أرى موصل GitHub بين الموصلات المتاحة." } as any;
      return { type: "text", text: "أهلاً، أنا بخير. كيف أساعدك؟" } as any;
    };
    const hello = await shamVariant.run("v2", () => shamAgentRun({
      text: "مرحبا كيف حالك", history: [], ask, ctx, tools: [], budgetMs: 20000, maxSteps: 1, maxNew: 80,
    }));
    const connectors = await shamVariant.run("v2", () => shamAgentRun({
      text: "ماهي الموصلات المتاحة لديك هل ترى بينها موصل جيتهوب",
      history: [{ q: "مرحبا كيف حالك", a: "أهلاً، أنا بخير. كيف أساعدك؟" }],
      ask, ctx, tools: [], budgetMs: 20000, maxSteps: 1, maxNew: 80,
    }));
    expect(hello).toMatchObject({ kind: "text", text: "أهلاً، أنا بخير. كيف أساعدك؟" });
    expect(connectors).toMatchObject({ kind: "text", text: "نعم، أرى موصل GitHub بين الموصلات المتاحة." });
    expect((hello as any).text).not.toBe((connectors as any).text);
    expect(seen.filter((p) => p.includes("موصلات")).length).toBe(2);
  });

  it("replaces the typist with the retried answer instead of appending it to the copied stream", async () => {
    const live: string[] = [];
    let tries = 0;
    const ask: ShamAsk = async (prompt) => {
      if (prompt.includes("موصلات")) {
        tries += 1;
        if (tries === 1) return { type: "text", text: "أهلاً، أنا بخير. كيف أساعدك؟" } as any;
      }
      return { type: "text", text: "نعم، أرى موصل GitHub بين الموصلات المتاحة." } as any;
    };
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "ماهي الموصلات المتاحة لديك هل ترى بينها موصل جيتهوب",
      history: [{ q: "مرحبا كيف حالك", a: "أهلاً، أنا بخير. كيف أساعدك؟" }],
      ask, ctx, tools: [], budgetMs: 20000, maxSteps: 1, maxNew: 80,
      onDelta: (t) => { live.push("delta:" + t); },
      onReplace: (t) => { live.push("replace:" + t); },
    }));
    expect(r).toMatchObject({ kind: "text", text: "نعم، أرى موصل GitHub بين الموصلات المتاحة." });
    expect(live.some((x) => x.startsWith("replace:") && x.includes("GitHub"))).toBe(true);
    expect(live.some((x) => x.startsWith("delta:") && x.includes("GitHub"))).toBe(false);
  });

  it("does not show a training checkpoint list in the user reply", async () => {
    const report = "🧠 تقرير جلسة شام\nخطوات تدريب حقيقية هذه الجلسة: 8\n| sham-checkpoint | 12 |";
    const ask: ShamAsk = async () => ({ type: "text", text: report } as any);
    const r = await shamVariant.run("v2", () => shamAgentRun({
      text: "مرحبا كيف حالك", history: [], ask, ctx, tools: [], budgetMs: 20000, maxSteps: 1, maxNew: 80,
    }));
    expect(r.kind).toBe("text");
    expect(String((r as any).text || "")).not.toMatch(/sham-checkpoint|تقرير جلسة شام/);
  });
});
