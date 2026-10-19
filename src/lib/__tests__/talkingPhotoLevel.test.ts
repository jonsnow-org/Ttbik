import { levelFromDb } from "@/app/free-tools/talking-photo/engine";
import { loudnessDb } from "@/app/free-tools/talking-photo/voice";

describe("talking photo loudness", () => {
  it("ordinary speech opens the mouth 1x, a shout about 2.6x, a whisper at least half", () => {
    expect(levelFromDb(-20)).toBeCloseTo(1, 5);
    expect(levelFromDb(-8)).toBeCloseTo(2.6, 5);
    expect(levelFromDb(-60)).toBe(0.5);
    expect(levelFromDb(0)).toBe(2.6);
  });
  it("is monotonic in loudness", () => {
    let prev = 0;
    for (let db = -50; db <= 0; db += 2) { const v = levelFromDb(db); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });
  it("measures the loud parts of a signal in dBFS", () => {
    const sr = 22050, x = new Float32Array(sr);
    for (let i = 0; i < x.length; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 200 * i) / sr);   // RMS 0.0707 = -23 dBFS
    expect(loudnessDb(x, sr)).toBeGreaterThan(-24);
    expect(loudnessDb(x, sr)).toBeLessThan(-22);
    expect(loudnessDb(new Float32Array(10), sr)).toBe(-30);
  });
});
