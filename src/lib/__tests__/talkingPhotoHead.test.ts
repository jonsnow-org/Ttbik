import { drift, headPose } from "@/app/free-tools/talking-photo/engine";

// Reference: a learned audio-to-head-pose model (SadTalker audio2pose) measured on Arabic and English speech at 25 fps:
// spread (std) yaw 0.8-3.1 deg, pitch 2.6-6.1 deg, roll 1.4-3.3 deg; angular speed (rms) yaw 5-14, pitch 10-21, roll 5-12 deg/s.
const FPS = 25, DEG = 180 / Math.PI;
const stats = (a: number[]) => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
  const v = Math.sqrt(a.slice(1).reduce((x, y, i) => x + ((y - a[i]) * FPS) ** 2, 0) / (a.length - 1));
  return { sd, v };
};
const W = { J: 0, S: 0, R: 0, F: 0, E: 0.3, B: 0 };
const series = (f: (t: number) => number) => Array.from({ length: FPS * 90 }, (_, i) => f(i / FPS) * DEG);

describe("talking photo head motion", () => {
  it("moves like natural speech: spread and angular speed inside the measured ranges", () => {
    const yaw = stats(series((t) => headPose(t, W).yaw)), pitch = stats(series((t) => headPose(t, W).pitch)), roll = stats(series((t) => 0.121 * drift(t, 3, 1)));
    expect(yaw.sd).toBeGreaterThan(0.8); expect(yaw.sd).toBeLessThan(3.1); expect(yaw.v).toBeGreaterThan(5); expect(yaw.v).toBeLessThan(14);
    expect(pitch.sd).toBeGreaterThan(2.6); expect(pitch.sd).toBeLessThan(6.1); expect(pitch.v).toBeGreaterThan(10); expect(pitch.v).toBeLessThan(21);
    expect(roll.sd).toBeGreaterThan(1.4); expect(roll.sd).toBeLessThan(3.3); expect(roll.v).toBeGreaterThan(5); expect(roll.v).toBeLessThan(12);
  });
  it("does not repeat: no period in the yaw track", () => {
    const a = series((t) => headPose(t, W).yaw);
    const m = a.reduce((x, y) => x + y, 0) / a.length, n = a.length;
    const ac = (lag: number) => { let s = 0, d = 0; for (let i = 0; i + lag < n; i++) { s += (a[i] - m) * (a[i + lag] - m); d += (a[i] - m) ** 2; } return s / d; };
    for (let lag = FPS * 5; lag <= FPS * 30; lag += FPS) expect(Math.abs(ac(lag))).toBeLessThan(0.5);
  });
  it("is deterministic", () => { expect(headPose(3.3, W)).toEqual(headPose(3.3, W)); });
});
