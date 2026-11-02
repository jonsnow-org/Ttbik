import { detectMediaIntent } from "@/lib/coderMediaFast";

describe("Nova video duration intent", () => {
  it.each([
    ["قم بتوليد فيديو أسد لمدة 10 ثواني", 10],
    ["أنشئ فديو أرنب 15 ثانية", 15],
    ["generate a video of a horse for 30 seconds", 30],
    ["make a video of a lighthouse for 1 minute", 60],
    ["قم بإنشاء فيديو قطة لمدة دقيقتين", 120],
    ["create a video of a fox for 2 min", 120],
  ])("extracts the requested duration from %s", (prompt, seconds) => {
    expect(detectMediaIntent(prompt)).toMatchObject({ kind: "video", seconds });
  });

  it("does not add duration words or numbers to the visual subject", () => {
    expect(detectMediaIntent("قم بتوليد فيديو أسد لمدة 30 ثانية")?.subject).toContain("أسد");
    expect(detectMediaIntent("قم بتوليد فيديو أسد لمدة 30 ثانية")?.subject).not.toMatch(/30|ثانية/);
  });
});
