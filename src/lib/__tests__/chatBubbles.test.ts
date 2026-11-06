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
});
