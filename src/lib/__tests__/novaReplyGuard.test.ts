import { collapseAdjacentDuplicateSentences, isEchoedPriorReply, isStatusDumpReply, nearSameReply, normReply, priorAssistantReplies, visibleNovaReply, NOVA_STALE_AR, NOVA_STALE_EN } from "@/lib/novaReplyGuard";

describe("Nova reply guard: collapse adjacent duplicate sentence blocks", () => {
  it("removes a repeated greeting-plus-identity block without rewriting the wording", () => {
    const block = "مرحباً! أنا Nova AI، مساعد برمجي، وأساعدك في الكتابة والبرمجة والبحث.";
    expect(collapseAdjacentDuplicateSentences(block + " " + block)).toBe(block);
  });

  it("collapses a repeated multi-sentence block, longest first", () => {
    const a = "هذه الجملة الأولى كاملة ومفهومة تماماً.";
    const b = "وهذه الجملة الثانية تتبعها مباشرة دائماً.";
    expect(collapseAdjacentDuplicateSentences(`${a} ${b} ${a} ${b}`)).toBe(`${a} ${b}`);
  });

  it("leaves ordinary text and short repeats untouched", () => {
    expect(collapseAdjacentDuplicateSentences("جملة واحدة فقط.")).toBe("جملة واحدة فقط.");
    expect(collapseAdjacentDuplicateSentences("نعم. نعم.")).toBe("نعم. نعم.");          // too short to be a duplicated block
    const distinct = "أولاً اقرأ الملف. ثانياً عدّل السطر. ثالثاً شغّل الاختبار.";
    expect(collapseAdjacentDuplicateSentences(distinct)).toBe(distinct);
  });
});

describe("Nova reply guard: echoed prior replies and status dumps", () => {
  it("detects a near copy of a previous assistant turn", () => {
    const prior = "أهلاً، أنا بخير. كيف أساعدك اليوم؟";
    expect(nearSameReply(prior, "أهلاً، أنا بخير. كيف أساعدك اليوم؟")).toBe(true);
    expect(isEchoedPriorReply(prior, [prior])).toBe(true);
    expect(isEchoedPriorReply("الملفات التي قرأتها: ثلاثة.", [prior])).toBe(false);
    expect(normReply("مرحباً!")).toBe("مرحبا");
  });

  it("collects only the assistant turns already in the conversation", () => {
    const msgs = [
      { role: "user", content: "سؤال" },
      { role: "assistant", content: "جواب سابق" },
      { role: "tool", content: "نتيجة أداة" },
      { role: "assistant", content: "" },
    ];
    expect(priorAssistantReplies(msgs)).toEqual(["جواب سابق"]);
  });

  it("detects a raw run/status/inventory dump", () => {
    const dump = "تقرير الجلسة\nنقاط الحفظ: 12\n| checkpoint | 120 |\nالخطوة النهائية: 1,234";
    expect(isStatusDumpReply(dump)).toBe(true);
    expect(isStatusDumpReply("نعم، أنجزت المهمة وعدّلت الملفين.")).toBe(false);
  });
});

describe("visibleNovaReply: last-line defense before the answer is shown", () => {
  const keep = process.env.CODER_REPLY_GUARD;
  afterEach(() => { if (keep === undefined) delete process.env.CODER_REPLY_GUARD; else process.env.CODER_REPLY_GUARD = keep; });

  it("replaces a copied prior reply with an honest Arabic line", () => {
    const prior = "أهلاً، أنا بخير. كيف أساعدك اليوم؟";
    expect(visibleNovaReply(prior, [prior])).toEqual({ text: NOVA_STALE_AR, blocked: "echo" });
  });

  it("replaces a raw status dump with an honest line", () => {
    const dump = "تقرير الجلسة\nنقف عند 12 نقطة حفظ\n| checkpoint | 12 |";
    expect(visibleNovaReply(dump, []).blocked).toBe("report");
    expect(visibleNovaReply(dump, []).text).toBe(NOVA_STALE_AR);
  });

  it("uses the English honest line for an English dump", () => {
    const dump = "Run report\ncheckpoint saved\n| checkpoint | 12 |\nfinal step";
    expect(visibleNovaReply(dump, []).text).toBe(NOVA_STALE_EN);
  });

  it("passes a genuinely new answer through, collapsed", () => {
    const block = "أنجزت المهمة: عدّلت الملف وشغّلت الاختبار ونجح.";
    expect(visibleNovaReply(block + " " + block, [])).toEqual({ text: block, blocked: "" });
    expect(visibleNovaReply("نعم، أرى مستودعك.", ["جواب مختلف تماماً عن هذا"])).toEqual({ text: "نعم، أرى مستودعك.", blocked: "" });
  });

  it("CODER_REPLY_GUARD=off disables the replacement but keeps the collapse", () => {
    process.env.CODER_REPLY_GUARD = "off";
    const prior = "أهلاً، أنا بخير. كيف أساعدك اليوم؟";
    expect(visibleNovaReply(prior, [prior])).toEqual({ text: prior, blocked: "" });
    const block = "جملة مكررة طويلة بما يكفي لتُطوى هنا تماماً.";
    expect(visibleNovaReply(block + " " + block, []).text).toBe(block);
  });
});
