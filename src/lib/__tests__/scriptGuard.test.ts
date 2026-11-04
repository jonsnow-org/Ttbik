import { stripForeignScript } from "@/lib/scriptGuard";
import { stripThinkTags } from "@/lib/thinkTags";
import { classifyRequest, resolveProfile } from "@/lib/modes";

describe("script guard for Arabic replies", () => {
  it("drops CJK and Vietnamese fragments, keeps Arabic, English names and code", () => {
    expect(stripForeignScript("أنا مساعد ذكاء的人工智能助手. أنا هنا لمساعدتك!")).toBe("أنا مساعد ذكاء. أنا هنا لمساعدتك!");
    const out = stripForeignScript("مرحبا، tôi là trợ lý Sham AI جاهز");
    expect(out).not.toMatch(/tôi|trợ|lý/);
    expect(out).toContain("Sham AI");
    expect(stripForeignScript("الكود:\n```\nprint('你好')\n```")).toContain("你好");
    expect(stripForeignScript("你好 xin chào")).toBe("你好 xin chào");
    expect(stripThinkTags("<think>x</think>أهلاً 你好")).toBe("أهلاً");
  });
  it("short identity questions take the lite path", () => {
    for (const t of ["من انت", "من انت يا", "من أنت؟", "ما اسمك", "who are you"]) expect(classifyRequest(t)).toBe("trivial");
    expect(resolveProfile({ model: "nova", text: "من انت" }).lite).toBe(true);
    expect(classifyRequest("من انت وكيف تصلح مستودعي jonsnow-org/Ttbik")).not.toBe("trivial");
  });
});
