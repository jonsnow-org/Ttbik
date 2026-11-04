import { stripThinkTags } from "@/lib/coderSections";
import { videoDeadlineMs } from "@/lib/novaMedia";

describe("a thought block never reaches the chat (live 2026-11-04: LFM2.5 greeted with <think></think>)", () => {
  it("drops empty and full thought blocks", () => {
    expect(stripThinkTags("<think></think>\n<think></think>\nمرحبا! كيف يمكنني مساعدتك؟")).toBe("مرحبا! كيف يمكنني مساعدتك؟");
    expect(stripThinkTags("<think>plan</think>الجواب")).toBe("الجواب");
  });
  it("holds back an unclosed block at the tail; plain text is untouched", () => {
    expect(stripThinkTags("أهلاً <think>still writing")).toBe("أهلاً ");
    expect(stripThinkTags("نص عادي")).toBe("نص عادي");
  });
});

describe("video deadline follows the number of 4 s passes", () => {
  it("gives a 6 s clip (two passes) more than the old 300 s, and a 2 min clip under the 2 h cap", () => {
    expect(videoDeadlineMs(6)).toBeGreaterThan(500000);
    expect(videoDeadlineMs(120)).toBeLessThan(7200000);
  });
});
