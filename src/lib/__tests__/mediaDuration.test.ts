import { explicitVideoSeconds, requestedVideoSeconds } from "@/lib/mediaDuration";

describe("requestedVideoSeconds", () => {
  it.each([
    ["قم بتوليد فيديو أرنب يركض لمدة 5 ثوانٍ", 5],
    ["اصنع مقطع فيديو مدته ٤ ثوان", 4],
    ["فيديو فتاة ترقص 3 ثواني", 3],
    ["فيديو لمدة ثانيتين", 2],
    ["فيديو لثانية واحدة", 1],
    ["make a 5 seconds video of a running rabbit", 5],
    ["create a 2 sec video", 2],
    ["make a 9-second video", 5],
  ] as Array<[string, number]>)("reads the requested duration from %s", (prompt, expected) => {
    expect(requestedVideoSeconds(prompt)).toBe(expected);
  });

  it("distinguishes a duration the user explicitly requested from the default", () => {
    expect(explicitVideoSeconds("اصنع فيديو لمدة 5 ثوانٍ")).toBe(5);
    expect(explicitVideoSeconds("فيديو لمدة خمس ثوان")).toBe(5);
    expect(explicitVideoSeconds("make a four-second video")).toBe(4);
    expect(explicitVideoSeconds("a rabbit running in a garden")).toBeNull();
  });

  it("uses the requested fallback when no duration is specified", () => {
    expect(requestedVideoSeconds("a rabbit running in a garden")).toBe(3);
    expect(requestedVideoSeconds("a rabbit running in a garden", 4)).toBe(4);
  });
});
