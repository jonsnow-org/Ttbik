import { failedMediaOnPlainMessage, wordsOnlyPrompt } from "@/lib/shamStudio";

describe("Sham: a failed picture on a plain message is asked again in words", () => {
  const blank = { type: "error", reason: "blank_image", text: "x" } as any;
  test("only a failed media reply on a message that is not a media request", () => {
    expect(failedMediaOnPlainMessage(blank, "ما هي عاصمة مصر؟")).toBe(true);
    expect(failedMediaOnPlainMessage(blank, "ارسم لي قطة")).toBe(false);          // a real picture request keeps its honest failure notice
    expect(failedMediaOnPlainMessage({ type: "text", text: "ok" } as any, "مرحبا")).toBe(false);
    expect(failedMediaOnPlainMessage({ type: "error", reason: "unavailable", text: "x" } as any, "مرحبا")).toBe(false);
    expect(failedMediaOnPlainMessage(null, "مرحبا")).toBe(false);
  });
  test("the header joins an existing one or opens a new one", () => {
    expect(wordsOnlyPrompt("مرحبا")).toBe("[[sham text=1]]\nمرحبا");
    expect(wordsOnlyPrompt("[[sham temp=0.20]]\nمرحبا")).toBe("[[sham text=1 temp=0.20]]\nمرحبا");
  });
});
