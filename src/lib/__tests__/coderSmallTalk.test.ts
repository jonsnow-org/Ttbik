import { aboutMeReply, isAboutMe, isSmallTalk, smallTalkReply } from "@/lib/coderSections";

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

describe("coder 'who are you' fast path", () => {
  it("recognises who-are-you / what-can-you-do, alone or after a greeting", () => {
    for (const t of ["مرحبا من انت وماهي وظيفتك وقدراتك ومهاراتك", "من أنت؟", "مين انت", "شو بتعرف تعمل؟", "ما هي قدراتك", "who are you?", "hi, what can you do"]) expect(isAboutMe(t)).toBe(true);
  });
  it("leaves real requests to the model", () => {
    for (const t of ["اصلح الخطأ في app.ts", "من أنت لتقرر؟ اكتب لي سكربت ```js```", "اكتب دالة ترجع من انت في https://a.example", "شو بتعمل هالدالة sum.ts", "اكتب برنامج يسأل المستخدم من انت"]) expect(isAboutMe(t)).toBe(false);
  });
  it("introduces SHAM AI without internal details", () => {
    const r = aboutMeReply("Ali");
    expect(r).toContain("SHAM AI");
    expect(r).toContain("Ali");
    expect(r).not.toMatch(/Linux|sandbox|محاكي|Coder|token|Qwen/i);
  });
});
