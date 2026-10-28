import { fitSize, chunkText, shrinkImage } from "@/lib/clientPrep";
describe("client-side preparation (only on what the user sends, in the foreground)", () => {
  it("fitSize scales the longest side down, never up", () => {
    expect(fitSize(4000, 3000, 1280)).toEqual({ w: 1280, h: 960, scaled: true });
    expect(fitSize(800, 600, 1280)).toEqual({ w: 800, h: 600, scaled: false });
    expect(fitSize(0, 5).w).toBe(0);
  });
  it("chunkText keeps every character, each piece within the limit, preferring line ends", () => {
    const t = Array.from({ length: 300 }, (_, i) => `سطر ${i} ${"ب".repeat(40)}`).join("\n");
    const parts = chunkText(t, 1000);
    expect(parts.join("")).toBe(t);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.slice(0, -1).every((p) => p.endsWith("\n"))).toBe(true);
    expect(chunkText("قصير", 1000)).toEqual(["قصير"]);
  });
  it("outside a browser the file is returned untouched (no work is done)", async () => {
    const f = { type: "image/png", size: 10, name: "a.png" } as any;
    expect(await shrinkImage(f)).toBe(f);
  });
});
