import React from "react";
import { loadFont } from "@remotion/fonts";
import {
  AbsoluteFill, Audio, OffthreadVideo, Easing, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Sequence,
} from "remotion";

export const FPS = 30;
export const CTA_SEC = 3.2;
const HOOK_F = 54;
const FONT = "Cairo";
loadFont({ family: FONT, url: staticFile("Cairo.ttf"), weight: "200 1000" });

type Word = { text: string; startMs: number; endMs: number };
export type PromoProps = { title: string; hook: string; words: Word[]; voiceSec: number };

const GOLD = "#FFC83D";
const BG = "linear-gradient(160deg,#0b1f3a 0%,#123d6b 55%,#0e7c66 100%)";

// group words into pages of ≤3 words for kinetic captions
const pages = (words: Word[]) => {
  const out: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const punct = /[،,.؟?!…]$/.test(w.text);
    if (cur.length >= 3 || punct || i === words.length - 1) { out.push(cur); cur = []; }
  });
  return out;
};

const Captions: React.FC<{ words: Word[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const ms = (frame / FPS) * 1000;
  const ps = pages(words);
  const idx = ps.findIndex((p, i) => ms >= p[0].startMs - 80 && (i === ps.length - 1 || ms < ps[i + 1][0].startMs - 80));
  if (idx < 0) return null;
  const p = ps[idx];
  const last = p[p.length - 1];
  if (ms > last.endMs + 700) return null;
  const pageStartF = ((p[0].startMs - 80) / 1000) * FPS;
  const pop = spring({ frame: frame - pageStartF, fps: FPS, config: { damping: 12, stiffness: 180 } });
  return (
    <div style={{ position: "absolute", left: 60, right: 60, bottom: 250, display: "flex", justifyContent: "center",
      transform: `scale(${0.8 + 0.2 * pop}) translateY(${(1 - pop) * 40}px)` }}>
      <div dir="rtl" style={{ direction: "rtl", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 40px", fontFamily: FONT, fontWeight: 900, fontSize: 92, lineHeight: 1.35,
        background: "rgba(5,15,30,0.72)", padding: "14px 40px 22px", borderRadius: 36 }}>
        {p.map((w, i) => {
          const active = ms >= w.startMs - 40;
          const now = ms >= w.startMs - 40 && ms < w.endMs + 60;
          return (
            <span key={i} style={{ color: now ? GOLD : active ? "#fff" : "rgba(255,255,255,0.45)",
              display: "inline-block", whiteSpace: "nowrap", transform: `scale(${now ? 1.12 : 1})`,
              textShadow: "0 6px 18px rgba(0,0,0,0.6)" }}>{w.text}</span>
          );
        })}
      </div>
    </div>
  );
};

const Phone: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const inP = spring({ frame, fps: FPS, config: { damping: 16 } });
  const drift = interpolate(frame, [0, durationInFrames], [1.0, 1.08]);
  const tilt = Math.sin(frame / 45) * 2.2;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 230 }}>
      <div style={{ width: 760, height: 1351, borderRadius: 64, overflow: "hidden", border: "14px solid #0a0f1a",
        boxShadow: "0 40px 120px rgba(0,0,0,0.55), 0 0 0 3px rgba(255,255,255,0.15)",
        transform: `translateY(${(1 - inP) * 900}px) scale(${drift}) rotate(${tilt * 0.4}deg) perspective(1600px) rotateY(${tilt}deg)` }}>
        <OffthreadVideo src={staticFile("screen.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    </AbsoluteFill>
  );
};

const Hook: React.FC<{ hook: string; title: string }> = ({ hook, title }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame, fps: FPS, config: { damping: 9, stiffness: 200 } });
  const out = interpolate(frame, [HOOK_F - 12, HOOK_F], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shake = frame < 10 ? Math.sin(frame * 2.5) * (10 - frame) : 0;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out, transform: `translateY(${(1 - out) * -200}px)` }}>
      <div dir="rtl" style={{ fontFamily: FONT, fontWeight: 1000, fontSize: 132, color: "#fff", textAlign: "center", padding: "0 70px",
        lineHeight: 1.25, transform: `scale(${0.4 + 0.6 * s}) translateX(${shake}px)`, textShadow: "0 10px 40px rgba(0,0,0,0.6)" }}>
        {hook}
      </div>
      <div dir="rtl" style={{ marginTop: 40, fontFamily: FONT, fontWeight: 800, fontSize: 56, color: "#0b1f3a", background: GOLD,
        padding: "6px 36px 14px", borderRadius: 999, transform: `scale(${spring({ frame: frame - 12, fps: FPS })})` }}>
        {title} · شام AI
      </div>
    </AbsoluteFill>
  );
};

const TopBar: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - HOOK_F, fps: FPS, config: { damping: 14 } });
  return (
    <div dir="rtl" style={{ position: "absolute", top: 80, left: 0, right: 0, display: "flex", justifyContent: "center",
      transform: `translateY(${(1 - s) * -200}px)`, opacity: s }}>
      <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: 60, color: "#fff", background: "rgba(255,255,255,0.12)",
        border: "2px solid rgba(255,255,255,0.25)", padding: "4px 40px 12px", borderRadius: 999 }}>
        <span style={{ color: GOLD }}>شام AI</span> · {title}
      </div>
    </div>
  );
};

const CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const s = spring({ frame, fps: FPS, config: { damping: 10, stiffness: 160 } });
  const pulse = 1 + Math.sin(frame / 4) * 0.03;
  const bg = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: `rgba(8,20,40,${0.88 * bg})`, alignItems: "center", justifyContent: "center" }}>
      <div dir="rtl" style={{ fontFamily: FONT, fontWeight: 1000, fontSize: 150, color: "#fff", transform: `scale(${s * pulse})`,
        textShadow: "0 10px 40px rgba(0,0,0,0.5)" }}>جرّبها ببلاش</div>
      <div style={{ marginTop: 50, fontFamily: FONT, fontWeight: 900, fontSize: 76, color: "#0b1f3a", background: GOLD,
        padding: "10px 50px 20px", borderRadius: 30, transform: `translateY(${(1 - spring({ frame: frame - 8, fps: FPS })) * 300}px)` }}>
        ttbik.vercel.app
      </div>
      <div dir="rtl" style={{ marginTop: 40, fontFamily: FONT, fontWeight: 800, fontSize: 64, color: GOLD,
        opacity: interpolate(frame, [14, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>شام AI</div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC<PromoProps> = ({ title, hook, words }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const ctaStart = durationInFrames - Math.round(CTA_SEC * FPS);
  const hue = interpolate(frame, [0, durationInFrames], [0, 25]);
  const voiceEndF = words.length ? Math.round((words[words.length - 1].endMs / 1000) * FPS) : ctaStart;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: BG, filter: `hue-rotate(${hue}deg)` }} />
      {/* moving light blobs: background never static */}
      <div style={{ position: "absolute", width: 900, height: 900, borderRadius: "50%", background: "rgba(255,200,61,0.18)", filter: "blur(120px)",
        left: -300 + Math.sin(frame / 40) * 200, top: 200 + Math.cos(frame / 50) * 300 }} />
      <div style={{ position: "absolute", width: 800, height: 800, borderRadius: "50%", background: "rgba(14,200,160,0.18)", filter: "blur(120px)",
        right: -300 + Math.cos(frame / 35) * 200, bottom: 100 + Math.sin(frame / 45) * 300 }} />
      <Sequence from={HOOK_F - 10} layout="none"><Phone /></Sequence>
      <TopBar title={title} />
      <Sequence durationInFrames={HOOK_F} layout="none"><Hook hook={hook} title={title} /></Sequence>
      <Sequence from={HOOK_F - 6} durationInFrames={ctaStart - HOOK_F + 6} layout="none"><Captions words={words} /></Sequence>
      <Sequence from={ctaStart} layout="none"><CTA /></Sequence>
      <Audio src={staticFile("voice.mp3")} />
      <Audio src={staticFile("music.mp3")} volume={(f) => {
        const base = interpolate(f, [0, 6, voiceEndF, voiceEndF + 12], [0.28, 0.07, 0.07, 0.3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return base * interpolate(f, [durationInFrames - 20, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      }} />
    </AbsoluteFill>
  );
};
