import { checkImage, checkMp4, checkWav, MediaQualityError, vetMedia } from "@/lib/mediaQuality";
import { b64, mp4Shell, png, wav } from "./mediaFixtures";

const reasonOf = async (fn: () => unknown) => { try { await fn(); return "ok"; } catch (e) { return e instanceof MediaQualityError ? e.reason : `other:${e}`; } };

describe("media quality gate (TypeScript side)", () => {
  it("rejects a black 512x512 PNG (a size check alone would pass it), constant grey and pixel noise; accepts real content", async () => {
    const black = await png("black", 512);
    expect(black.length).toBeGreaterThan(128);
    expect(await reasonOf(() => checkImage(black))).toBe("blank_image");
    expect(await reasonOf(async () => checkImage(await png("gray")))).toBe("blank_image");
    expect(await reasonOf(async () => checkImage(await png("noise")))).toBe("noise_image");
    expect(await reasonOf(async () => checkImage(await png("gradient")))).toBe("ok");
    expect(await reasonOf(() => checkImage(Buffer.from("not an image")))).toBe("invalid_image");
  });
  it("audio: tone passes; silence, empty and too-short fail", () => {
    expect(checkWav(wav("tone")).peak).toBeGreaterThan(0.1);
    for (const b of [wav("silence"), Buffer.alloc(0), wav("tone", 0.05)]) expect(() => checkWav(b)).toThrow(/silent_audio/);
    expect(() => checkWav(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(200, 1)]))).toThrow(/invalid_audio/);
  });
  it("video: a complete MP4 container passes; empty, tiny or truncated fail", () => {
    expect(checkMp4(mp4Shell()).bytes).toBeGreaterThan(1024);
    for (const b of [Buffer.alloc(0), Buffer.alloc(5000, 7), mp4Shell().subarray(0, 200)]) expect(() => checkMp4(b)).toThrow(/empty_video/);
  });
  it("vetMedia returns good media untouched and turns bad media into a typed error (backend kept, bytes dropped); non-media passes through", async () => {
    const good = { type: "image", b64: b64(await png("gradient")) };
    expect(await vetMedia(good)).toBe(good);
    const bad = (await vetMedia({ type: "image", b64: b64(await png("black", 512)), backend: "ready" })) as any;
    expect(bad).toMatchObject({ type: "error", reason: "blank_image", backend: "ready" });
    expect(bad.b64).toBeUndefined();
    expect(bad.text).toMatch(/فارغة|سوداء/);
    expect(await vetMedia({ type: "audio", b64: b64(wav("silence")) })).toMatchObject({ type: "error", reason: "silent_audio" });
    expect(await vetMedia({ type: "video", b64: "AAA" })).toMatchObject({ type: "error", reason: "empty_video" });
    for (const t of [{ type: "text", text: "x" }, { type: "busy" }, { type: "error", text: "e" }]) expect(await vetMedia(t)).toBe(t);
    expect(await vetMedia(null)).toBeNull();
  });
});
