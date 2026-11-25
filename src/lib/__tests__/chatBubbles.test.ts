import { threadBubbles } from "@/lib/chatBubbles";

describe("chat bubbles from the task-event feed", () => {
  it("merges consecutive streaming text events into one assistant bubble", () => {
    const tasks = [{ events: [
      { id: 1, kind: "start", text: "اشرح المستودع" },
      { id: 2, kind: "text", text: "هذا " },
      { id: 3, kind: "text", text: "المستودع " },
      { id: 4, kind: "text", text: "يخص السوق." },
    ] }];
    const bubbles = threadBubbles(tasks);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toMatchObject({ role: "user", text: "اشرح المستودع" });
    expect(bubbles[1]).toMatchObject({ role: "assistant", text: "هذا المستودع يخص السوق." });
  });

  it("starts a new assistant bubble after a note or a new user turn", () => {
    const tasks = [{ events: [
      { id: 1, kind: "text", text: "أ" },
      { id: 2, kind: "failed", text: "خطأ" },
      { id: 3, kind: "text", text: "ب" },
      { id: 4, kind: "start", text: "سؤال آخر" },
      { id: 5, kind: "text", text: "ج" },
    ] }];
    const bubbles = threadBubbles(tasks);
    expect(bubbles.map((b) => [b.role, b.text])).toEqual([
      ["assistant", "أ"],
      ["note", "خطأ"],
      ["assistant", "ب"],
      ["user", "سؤال آخر"],
      ["assistant", "ج"],
    ]);
  });

  it("drops low-signal info events and survives an empty feed", () => {
    expect(threadBubbles([])).toEqual([]);
    expect(threadBubbles([{ events: [] }])).toEqual([]);
    expect(threadBubbles([{ events: [{ id: 9, kind: "done", text: "x" }] }])).toEqual([]);
  });

  it("a retried answer (replace) takes the place of the streamed one, not appended after it (Sham Pro, 2026-11-25)", () => {
    const tasks = [{ events: [
      { id: 1, kind: "start", text: "ما عاصمة فرنسا؟" },
      { id: 2, kind: "text", text: "الجواب السابق " },
      { id: 3, kind: "text", text: "المنسوخ" },
      { id: 4, kind: "replace", text: "عاصمة فرنسا هي باريس." },
    ] }];
    expect(threadBubbles(tasks).map((b) => [b.role, b.text])).toEqual([
      ["user", "ما عاصمة فرنسا؟"],
      ["assistant", "عاصمة فرنسا هي باريس."],
    ]);
    expect(threadBubbles([{ events: [{ id: 1, kind: "start", text: "س" }, { id: 2, kind: "replace", text: "ج" }] }]).map((b) => b.text)).toEqual(["س", "ج"]);
  });
});
