import { isSmallTalk, smallTalkReply } from "@/lib/coderSections";

describe("coder small talk fast path", () => {
  it("recognises short greetings and thanks", () => {
    for (const t of ["مرحبا", "مرحبا!", "السلام عليكم", "سلام عليكم ورحمة الله", "أهلاً", "هلا", "كيفك؟", "شكراً", "hi", "Hello 👋", "thanks", "صباح الخير"]) expect(isSmallTalk(t)).toBe(true);
  });
  it("leaves real requests to the model", () => {
    for (const t of ["مرحبا اشرح لي هذا الكود في ملف app.ts", "اصلح الخطأ", "hi, fix the failing test in my repo", "مرحبا\nاكتب لي سكربت", "", "```js\nhi\n```"]) expect(isSmallTalk(t)).toBe(false);
  });
  it("answers in plain friendly words", () => {
    expect(smallTalkReply("السلام عليكم", "Ali")).toContain("وعليكم السلام Ali");
    expect(smallTalkReply("شكرا")).toContain("العفو");
    expect(smallTalkReply("مرحبا")).toContain("أهلاً");
  });
});
