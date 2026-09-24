// «رموز» part 4: every sound is synthesised here (Web Audio), so the soundtrack
// is ours too: a soft chord pad plus per-scene ambience picked from the scene
// code (birds by day outdoors, rain, waves, wind, crickets at night).
import type { SceneCode } from "./brain";

function noiseBuffer(ac: AudioContext, seconds: number) {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * seconds), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function envelope(g: GainNode, start: number, end: number, level: number, fade = 0.4) {
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(level, start + fade);
  g.gain.setValueAtTime(level, Math.max(start + fade, end - fade));
  g.gain.linearRampToValueAtTime(0, end);
}

function noiseBed(ac: AudioContext, dest: AudioNode, start: number, end: number, type: BiquadFilterType, freq: number, level: number, lfo = 0) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, end - start + 0.5);
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ac.createGain();
  envelope(g, start, end, level);
  src.connect(f);
  f.connect(g);
  if (lfo) {
    const osc = ac.createOscillator();
    osc.frequency.value = lfo;
    const depth = ac.createGain();
    depth.gain.value = level * 0.8;
    osc.connect(depth);
    depth.connect(g.gain);
    osc.start(start);
    osc.stop(end);
  }
  g.connect(dest);
  src.start(start);
  src.stop(end + 0.1);
}

function chirps(ac: AudioContext, dest: AudioNode, start: number, end: number) {
  for (let t = start + 0.3; t < end - 0.3; t += 0.5 + Math.random() * 1.1) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const s = t + k * 0.09;
      const osc = ac.createOscillator();
      osc.type = "sine";
      const base = 2600 + Math.random() * 1400;
      osc.frequency.setValueAtTime(base, s);
      osc.frequency.exponentialRampToValueAtTime(base * 1.5, s + 0.06);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.05, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
      osc.connect(g);
      g.connect(dest);
      osc.start(s);
      osc.stop(s + 0.1);
    }
  }
}

function crickets(ac: AudioContext, dest: AudioNode, start: number, end: number) {
  for (let t = start + 0.2; t < end - 0.2; t += 0.35) {
    for (let k = 0; k < 3; k++) {
      const s = t + k * 0.045;
      const osc = ac.createOscillator();
      osc.frequency.value = 4400;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.02, s + 0.005);
      g.gain.linearRampToValueAtTime(0, s + 0.03);
      osc.connect(g);
      g.connect(dest);
      osc.start(s);
      osc.stop(s + 0.04);
    }
  }
}

function pad(ac: AudioContext, dest: AudioNode, start: number, duration: number) {
  const chords = [
    [261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
  ];
  const master = ac.createGain();
  master.gain.value = 0.1;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1400;
  master.connect(filter);
  filter.connect(dest);
  const len = 2.5;
  for (let t = 0, i = 0; t < duration; t += len, i++) {
    for (const f of chords[i % chords.length]) {
      for (const detune of [-6, 6]) {
        const osc = ac.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = f;
        osc.detune.value = detune;
        const g = ac.createGain();
        const s = start + t;
        const e = Math.min(s + len + 0.4, start + duration);
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.25, s + 0.6);
        g.gain.linearRampToValueAtTime(0, e);
        osc.connect(g);
        g.connect(master);
        osc.start(s);
        osc.stop(e + 0.05);
      }
    }
  }
  master.gain.setValueAtTime(0.1, start + Math.max(0, duration - 1));
  master.gain.linearRampToValueAtTime(0, start + duration);
}

/** Schedules music + ambience for the whole story, starting now. */
export function scheduleSoundtrack(ac: AudioContext, dest: AudioNode, scenes: SceneCode[], perScene: number, music: boolean, ambience: boolean) {
  const t0 = ac.currentTime + 0.05;
  const total = scenes.length * perScene;
  if (music) pad(ac, dest, t0, total);
  if (!ambience) return;
  scenes.forEach((s, i) => {
    const start = t0 + i * perScene;
    const end = start + perScene;
    const outdoor = s.place !== "house" && s.place !== "space";
    if (s.weather === "rain") noiseBed(ac, dest, start, end, "highpass", 1200, s.place === "house" ? 0.05 : 0.12);
    if (s.weather === "wind") noiseBed(ac, dest, start, end, "bandpass", 500, 0.1, 0.3);
    if (s.place === "sea" || s.place === "river") noiseBed(ac, dest, start, end, "lowpass", s.place === "sea" ? 700 : 1500, 0.1, s.place === "sea" ? 0.18 : 0);
    if (s.place === "city") noiseBed(ac, dest, start, end, "lowpass", 300, 0.07);
    if (outdoor && s.weather !== "rain" && s.place !== "city") {
      if (s.time === "night") crickets(ac, dest, start, end);
      else if (s.place !== "desert") chirps(ac, dest, start, end);
    }
  });
}
