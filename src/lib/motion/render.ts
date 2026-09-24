// «رموز» part 3: draws and animates a scene code on a canvas. Every creature,
// place, sky and weather effect is drawn here from plain shapes — nothing is
// downloaded — so the output belongs to us and renders instantly.
import type { Action, Actor, Kind, Place, SceneCode } from "./brain";

export const W = 540;
export const H = 960;
const HORIZON = H * 0.56;
const GROUND = H * 0.74;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- helpers

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function ell(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, TAU);
}

function limb(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

const wrap = (x: number, pad = 90) => ((((x + pad) % (W + 2 * pad)) + (W + 2 * pad)) % (W + 2 * pad)) - pad;
const ease = (p: number) => p * p * (3 - 2 * p);

// ---------------------------------------------------------------- sky

const SKY: Record<SceneCode["time"], [string, string]> = {
  morning: ["#8fc9f7", "#ffd9a8"],
  day: ["#3f97e0", "#c9ecff"],
  sunset: ["#3a2a66", "#ff8f5a"],
  night: ["#050920", "#1f2a5c"],
};

function drawSky(ctx: CanvasRenderingContext2D, s: SceneCode, t: number, r: () => number) {
  const [top, bottom] = SKY[s.time];
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
  g.addColorStop(0, s.weather === "rain" ? shade(top, -40) : top);
  g.addColorStop(1, s.weather === "rain" ? shade(bottom, -50) : bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, s.place === "space" ? H : HORIZON + 4);

  if (s.time === "night" || s.place === "space") {
    for (let i = 0; i < (s.place === "space" ? 160 : 90); i++) {
      const x = r() * W;
      const y = r() * (s.place === "space" ? H : HORIZON * 0.9);
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (1 + r() * 2) + i));
      ctx.fillStyle = `rgba(255,255,240,${tw})`;
      circle(ctx, x, y, r() * 1.6 + 0.4);
      ctx.fill();
    }
  }

  if (s.weather === "rain" || s.place === "space") return;
  if (s.time === "night") {
    const mx = W * 0.74;
    const my = H * 0.13;
    const glow = ctx.createRadialGradient(mx, my, 10, mx, my, 90);
    glow.addColorStop(0, "rgba(255,250,220,0.35)");
    glow.addColorStop(1, "rgba(255,250,220,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(mx - 90, my - 90, 180, 180);
    ctx.fillStyle = "#fff8d6";
    circle(ctx, mx, my, 34);
    ctx.fill();
    ctx.fillStyle = SKY.night[0];
    circle(ctx, mx + 14, my - 8, 30);
    ctx.fill();
  } else {
    const pos = s.time === "morning" ? [W * 0.22, HORIZON - 60 - t * 4] : s.time === "sunset" ? [W * 0.5, HORIZON - 40 + t * 5] : [W * 0.78, H * 0.13];
    const color = s.time === "sunset" ? "#ffb347" : s.time === "morning" ? "#ffe08a" : "#fff3b0";
    const glow = ctx.createRadialGradient(pos[0], pos[1], 20, pos[0], pos[1], 140);
    glow.addColorStop(0, "rgba(255,240,180,0.55)");
    glow.addColorStop(1, "rgba(255,240,180,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(pos[0] - 140, pos[1] - 140, 280, 280);
    ctx.fillStyle = color;
    circle(ctx, pos[0], pos[1], s.time === "sunset" ? 52 : 40);
    ctx.fill();
  }
}

function drawClouds(ctx: CanvasRenderingContext2D, s: SceneCode, t: number, r: () => number) {
  if (s.place === "space" || s.place === "house") return;
  const n = { clear: 3, clouds: 7, rain: 8, snow: 6, wind: 5 }[s.weather];
  const speed = s.weather === "wind" ? 60 : 12;
  const base = s.weather === "rain" ? "rgba(110,115,130,0.95)" : s.weather === "snow" ? "rgba(225,230,240,0.95)" : s.time === "night" ? "rgba(120,130,170,0.35)" : s.time === "sunset" ? "rgba(255,200,180,0.8)" : "rgba(255,255,255,0.9)";
  for (let i = 0; i < n; i++) {
    const y = 60 + r() * HORIZON * 0.5;
    const size = 40 + r() * 50;
    const x = wrap(r() * W + t * speed * (0.6 + r() * 0.8), 160);
    ctx.fillStyle = base;
    for (let k = 0; k < 4; k++) {
      ell(ctx, x + (k - 1.5) * size * 0.55, y + (k % 2 ? -size * 0.25 : 0), size * 0.55, size * 0.38);
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------- places

function hills(ctx: CanvasRenderingContext2D, y: number, amp: number, freq: number, phase: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 10) ctx.lineTo(x, y - amp * (0.5 + 0.5 * Math.sin(x * freq + phase)));
  ctx.lineTo(W, H);
  ctx.fill();
}

function groundFill(ctx: CanvasRenderingContext2D, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, HORIZON, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, leaf: string, sway: number) {
  ctx.fillStyle = "#6b4a2e";
  ctx.fillRect(x - h * 0.05, y - h * 0.45, h * 0.1, h * 0.45);
  ctx.fillStyle = leaf;
  for (const [dx, dy, rr] of [
    [0, -0.62, 0.26],
    [-0.16, -0.5, 0.2],
    [0.16, -0.5, 0.2],
    [0, -0.82, 0.18],
  ]) {
    circle(ctx, x + dx * h + sway, y + dy * h, rr * h);
    ctx.fill();
  }
}

function flowers(ctx: CanvasRenderingContext2D, r: () => number, n: number, y0: number, y1: number) {
  const colors = ["#ff6b8b", "#ffd24a", "#ffffff", "#b58cff", "#ff9a3c"];
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const y = y0 + r() * (y1 - y0);
    const k = (y - y0) / (y1 - y0);
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    circle(ctx, x, y, 2 + k * 4);
    ctx.fill();
  }
}

function water(ctx: CanvasRenderingContext2D, y0: number, y1: number, t: number, night: boolean) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, night ? "#1b2d5a" : "#2d8fd5");
  g.addColorStop(1, night ? "#0f1b3a" : "#1a5fa0");
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, y1 - y0);
  ctx.strokeStyle = night ? "rgba(200,220,255,0.25)" : "rgba(255,255,255,0.45)";
  ctx.lineWidth = 2;
  for (let row = 0; row < 7; row++) {
    const y = y0 + ((row + 0.5) / 7) * (y1 - y0);
    ctx.beginPath();
    for (let x = -20; x <= W + 20; x += 8) {
      const yy = y + Math.sin(x * 0.04 + t * 2 + row) * (2 + row * 0.6);
      if (x === -20) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
}

function drawPlace(ctx: CanvasRenderingContext2D, s: SceneCode, t: number, r: () => number) {
  const night = s.time === "night";
  const windSway = s.weather === "wind" ? 10 : 3;
  switch (s.place) {
    case "field":
    case "garden": {
      hills(ctx, HORIZON + 10, 50, 0.012, 1, night ? "#244a3a" : "#7cbf6a");
      hills(ctx, HORIZON + 40, 35, 0.018, 3, night ? "#1d3d2c" : "#5fae4f");
      groundFill(ctx, night ? "#1f3f2b" : "#6cc152", night ? "#15301f" : "#3f9a38");
      if (s.place === "garden") {
        ctx.fillStyle = night ? "#1a3a24" : "#3d8a3a";
        for (let x = -10; x < W; x += 46) {
          circle(ctx, x, HORIZON + 38, 30);
          ctx.fill();
        }
        ctx.fillStyle = night ? "#8a8f9a" : "#fdfdf6";
        for (let x = 6; x < W; x += 22) ctx.fillRect(x, HORIZON + 30, 8, 44);
        ctx.fillRect(0, HORIZON + 44, W, 6);
        flowers(ctx, r, 70, HORIZON + 80, H);
      } else {
        for (let i = 0; i < 3; i++) tree(ctx, 40 + r() * (W - 80), HORIZON + 36, 120 + r() * 60, night ? "#1c4a2c" : "#3e9a44", Math.sin(t * 1.5 + i) * windSway * 0.4);
        flowers(ctx, r, 45, HORIZON + 60, H);
      }
      break;
    }
    case "forest": {
      groundFill(ctx, night ? "#18301f" : "#4d8a3c", night ? "#0f2014" : "#2f5e25");
      for (let layer = 0; layer < 3; layer++) {
        const n = 7 - layer;
        for (let i = 0; i < n; i++) {
          const x = ((i + r()) / n) * W;
          const h = 260 + layer * 90 + r() * 80;
          const leaf = night ? ["#0f2a1a", "#133520", "#194128"][layer] : ["#2f6f3a", "#2b7d3d", "#3a9148"][layer];
          tree(ctx, x, HORIZON + 30 + layer * 55, h, leaf, Math.sin(t * 1.2 + i + layer) * windSway * 0.5);
        }
      }
      if (!night && s.weather !== "rain") {
        ctx.fillStyle = "rgba(255,250,210,0.12)";
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          const x = 80 + i * 170;
          ctx.moveTo(x, 0);
          ctx.lineTo(x + 60, 0);
          ctx.lineTo(x + 160, H);
          ctx.lineTo(x + 60, H);
          ctx.fill();
        }
      }
      break;
    }
    case "sea": {
      water(ctx, HORIZON, GROUND - 40, t, night);
      const g = ctx.createLinearGradient(0, GROUND - 40, 0, H);
      g.addColorStop(0, night ? "#6b6150" : "#f2dca4");
      g.addColorStop(1, night ? "#4a4236" : "#e0c37e");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 10) ctx.lineTo(x, GROUND - 40 + Math.sin(x * 0.03 + t * 1.6) * 5);
      ctx.lineTo(W, H);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 10) {
        const y = GROUND - 42 + Math.sin(x * 0.03 + t * 1.6) * 5;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case "river": {
      groundFill(ctx, night ? "#1f3f2b" : "#6cc152", night ? "#15301f" : "#3f9a38");
      water(ctx, HORIZON + 50, HORIZON + 130, t, night);
      for (let i = 0; i < 3; i++) tree(ctx, 30 + i * 200 + r() * 60, HORIZON + 40, 150, night ? "#1c4a2c" : "#3e9a44", Math.sin(t + i) * windSway * 0.4);
      flowers(ctx, r, 30, HORIZON + 150, H);
      break;
    }
    case "desert": {
      hills(ctx, HORIZON + 20, 60, 0.009, 0.5, night ? "#5a4a38" : "#e7b76a");
      hills(ctx, HORIZON + 80, 50, 0.013, 2, night ? "#4a3d2e" : "#dca55a");
      groundFill(ctx, night ? "#4a3d2e" : "#e2ae63", night ? "#3a3024" : "#c98f45");
      ctx.fillStyle = night ? "#2d4a2d" : "#4f8a3c";
      for (let i = 0; i < 2; i++) {
        const x = 70 + r() * (W - 140);
        const y = HORIZON + 110 + r() * 40;
        ctx.fillRect(x - 8, y - 90, 16, 90);
        ctx.fillRect(x - 30, y - 60, 12, 30);
        ctx.fillRect(x - 30, y - 40, 30, 10);
        ctx.fillRect(x + 18, y - 75, 12, 35);
        ctx.fillRect(x + 8, y - 50, 22, 10);
      }
      break;
    }
    case "city": {
      for (let layer = 0; layer < 2; layer++) {
        let x = -20;
        while (x < W) {
          const bw = 50 + r() * 60;
          const bh = 180 + r() * 220 - layer * 60;
          const top = HORIZON + 40 - bh + layer * 50;
          ctx.fillStyle = night ? ["#1b2140", "#252c52"][layer] : ["#8d9bb3", "#a9b6cb"][layer];
          ctx.fillRect(x, top, bw, bh + 200);
          for (let wy = top + 14; wy < HORIZON + 30; wy += 24) {
            for (let wx = x + 8; wx < x + bw - 12; wx += 16) {
              const lit = night ? r() > 0.45 : r() > 0.85;
              ctx.fillStyle = lit ? (night ? "#ffd86b" : "#e8f2ff") : night ? "#141933" : "#7a879d";
              ctx.fillRect(wx, wy, 8, 12);
            }
          }
          x += bw + 6;
        }
      }
      ctx.fillStyle = night ? "#2b2b33" : "#6a6a73";
      ctx.fillRect(0, HORIZON + 80, W, H);
      ctx.fillStyle = night ? "#3a3a44" : "#9a9aa4";
      ctx.fillRect(0, HORIZON + 80, W, 26);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let x = (-t * 40) % 80; x < W; x += 80) ctx.fillRect(x, GROUND + 40, 40, 6);
      for (let i = 0; i < 3; i++) {
        const x = 60 + i * 190;
        ctx.fillStyle = "#333";
        ctx.fillRect(x, HORIZON - 30, 6, 116);
        ctx.fillStyle = night ? "#ffe79a" : "#ddd";
        circle(ctx, x + 3, HORIZON - 34, 9);
        ctx.fill();
        if (night) {
          const glow = ctx.createRadialGradient(x + 3, HORIZON - 34, 4, x + 3, HORIZON - 34, 90);
          glow.addColorStop(0, "rgba(255,220,120,0.4)");
          glow.addColorStop(1, "rgba(255,220,120,0)");
          ctx.fillStyle = glow;
          ctx.fillRect(x - 90, HORIZON - 124, 186, 186);
        }
      }
      break;
    }
    case "house": {
      ctx.fillStyle = night ? "#5a4e6a" : "#f3e3c8";
      ctx.fillRect(0, 0, W, H);
      // window showing the sky outside
      const wx = W * 0.2;
      const wy = H * 0.18;
      const ww = W * 0.6;
      const wh = H * 0.28;
      ctx.save();
      ctx.beginPath();
      ctx.rect(wx, wy, ww, wh);
      ctx.clip();
      const [top, bottom] = SKY[s.time];
      const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
      ctx.fillStyle = g;
      ctx.fillRect(wx, wy, ww, wh);
      if (s.time === "night") {
        ctx.fillStyle = "#fff8d6";
        circle(ctx, wx + ww * 0.7, wy + wh * 0.35, 22);
        ctx.fill();
      }
      if (s.weather === "rain" || s.weather === "snow") weather(ctx, s.weather, t, rng(7), 0.6);
      ctx.restore();
      ctx.strokeStyle = "#7a5534";
      ctx.lineWidth = 10;
      ctx.strokeRect(wx, wy, ww, wh);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(wx + ww / 2, wy);
      ctx.lineTo(wx + ww / 2, wy + wh);
      ctx.moveTo(wx, wy + wh / 2);
      ctx.lineTo(wx + ww, wy + wh / 2);
      ctx.stroke();
      // floor, rug, lamp glow
      const fg = ctx.createLinearGradient(0, HORIZON + 40, 0, H);
      fg.addColorStop(0, night ? "#5b4030" : "#b98552");
      fg.addColorStop(1, night ? "#40291d" : "#8f5f35");
      ctx.fillStyle = fg;
      ctx.fillRect(0, HORIZON + 40, W, H);
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 2;
      for (let y = HORIZON + 70; y < H; y += 36) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.fillStyle = "#b23a48";
      ell(ctx, W / 2, GROUND + 10, 200, 48);
      ctx.fill();
      ctx.strokeStyle = "#f2c14e";
      ctx.lineWidth = 4;
      ell(ctx, W / 2, GROUND + 10, 180, 38);
      ctx.stroke();
      if (night) {
        const glow = ctx.createRadialGradient(W * 0.88, H * 0.5, 10, W * 0.88, H * 0.5, 260);
        glow.addColorStop(0, "rgba(255,210,120,0.45)");
        glow.addColorStop(1, "rgba(255,210,120,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
      }
      break;
    }
    case "mountain": {
      const peaks = (baseY: number, color: string, snow: string, n: number) => {
        for (let i = 0; i < n; i++) {
          const cx = ((i + 0.5 + (r() - 0.5) * 0.4) / n) * W;
          const hgt = 220 + r() * 160;
          const half = 150 + r() * 60;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(cx - half, baseY);
          ctx.lineTo(cx, baseY - hgt);
          ctx.lineTo(cx + half, baseY);
          ctx.fill();
          ctx.fillStyle = snow;
          ctx.beginPath();
          ctx.moveTo(cx - half * 0.28, baseY - hgt * 0.72);
          ctx.lineTo(cx, baseY - hgt);
          ctx.lineTo(cx + half * 0.28, baseY - hgt * 0.72);
          ctx.fill();
        }
      };
      peaks(HORIZON + 40, night ? "#39406a" : "#7d8fb3", night ? "#c9d2ee" : "#ffffff", 3);
      peaks(HORIZON + 90, night ? "#2c3356" : "#62739a", night ? "#b8c2e2" : "#f4f7ff", 4);
      groundFill(ctx, night ? "#1f3f2b" : "#79b85f", night ? "#15301f" : "#4d913f");
      flowers(ctx, r, 25, HORIZON + 140, H);
      break;
    }
    case "space": {
      const px = W * 0.25;
      const py = H * 0.28;
      const pg = ctx.createRadialGradient(px - 30, py - 30, 10, px, py, 90);
      pg.addColorStop(0, "#ffb870");
      pg.addColorStop(1, "#b0523a");
      ctx.fillStyle = pg;
      circle(ctx, px, py, 80);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,220,170,0.7)";
      ctx.lineWidth = 6;
      ell(ctx, px, py, 130, 26, -0.3);
      ctx.stroke();
      ctx.fillStyle = "#cfd6e6";
      circle(ctx, W * 0.8, H * 0.7, 40);
      ctx.fill();
      break;
    }
  }
}

function weather(ctx: CanvasRenderingContext2D, w: SceneCode["weather"], t: number, r: () => number, alpha = 1) {
  if (w === "rain") {
    ctx.strokeStyle = `rgba(200,215,240,${0.55 * alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 140; i++) {
      const x = (r() * W + t * 60) % W;
      const y = (r() * H + t * (700 + r() * 300)) % H;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y + 22);
    }
    ctx.stroke();
  } else if (w === "snow") {
    ctx.fillStyle = `rgba(255,255,255,${0.9 * alpha})`;
    for (let i = 0; i < 110; i++) {
      const sp = 40 + r() * 60;
      const x = (r() * W + Math.sin(t * 1.2 + i) * 20 + W) % W;
      const y = (r() * H + t * sp) % H;
      circle(ctx, x, y, 1.5 + r() * 3);
      ctx.fill();
    }
  } else if (w === "wind") {
    for (let i = 0; i < 18; i++) {
      const x = wrap(r() * W + t * (220 + r() * 120), 40);
      const y = r() * GROUND + Math.sin(t * 3 + i) * 20;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 4 + i);
      ctx.fillStyle = ["#d9822b", "#e0b23c", "#8fbf4a"][i % 3];
      ell(ctx, 0, 0, 9, 4);
      ctx.fill();
      ctx.restore();
    }
  }
}

function foreground(ctx: CanvasRenderingContext2D, s: SceneCode, t: number, r: () => number) {
  if (["field", "garden", "mountain", "river", "forest"].includes(s.place)) {
    const amp = s.weather === "wind" ? 12 : 4;
    ctx.strokeStyle = s.time === "night" ? "#1c3a26" : "#2f8a2c";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 90; i++) {
      const x = r() * W;
      const y = H - r() * 60;
      const h = 14 + r() * 26;
      const sway = Math.sin(t * 2.2 + x * 0.05) * amp;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + sway * 0.4, y - h * 0.6, x + sway, y - h);
    }
    ctx.stroke();
  }
  if (s.weather === "snow" && s.place !== "house" && s.place !== "space") {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(0, GROUND + 20, W, H);
  }
}

// ---------------------------------------------------------------- creatures

type Pose = {
  phase: number; // leg cycle
  swing: number; // 0 standing still … 1 full stride
  pose: "stand" | "sit" | "lie";
  tilt: number; // head tilt (look up < 0)
  dip: number; // head down 0..1 (eating)
  happy: boolean;
  closed: boolean;
  flap: number; // wings 0..1
  roll: number; // body rotation
};

const DEFAULT_COLOR: Record<Kind, string> = {
  cat: "#f0913a",
  dog: "#a0673c",
  rabbit: "#d9d2c5",
  bird: "#4f8ef0",
  butterfly: "#f39ac4",
  fish: "#f59a2f",
  person: "#3a7be0",
  child: "#e0453a",
  car: "#e0453a",
  ball: "#ffffff",
};

function eyes(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose, t: number) {
  const blink = p.closed || Math.sin(t * 1.3 + x) > 0.985;
  ctx.strokeStyle = "#1c1c22";
  ctx.fillStyle = "#1c1c22";
  if (blink || p.happy) {
    ctx.lineWidth = Math.max(1.5, r * 0.5);
    ctx.beginPath();
    if (p.happy && !p.closed) ctx.arc(x, y + r * 0.4, r, Math.PI * 1.1, Math.PI * 1.9);
    else {
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
    }
    ctx.stroke();
  } else {
    circle(ctx, x, y, r);
    ctx.fill();
    ctx.fillStyle = "#fff";
    circle(ctx, x + r * 0.35, y - r * 0.35, r * 0.35);
    ctx.fill();
  }
}

function quadruped(ctx: CanvasRenderingContext2D, kind: "cat" | "dog" | "rabbit", color: string, p: Pose, t: number) {
  const dark = shade(color, -45);
  const light = shade(color, 35);
  const leg = kind === "rabbit" ? 16 : 30;
  const hopY = kind === "rabbit" && p.swing > 0 ? -Math.abs(Math.sin(p.phase)) * 24 : 0;
  ctx.save();
  ctx.translate(0, hopY);
  ctx.rotate(p.roll);

  if (p.pose === "lie") {
    ctx.fillStyle = color;
    ell(ctx, 0, -18, 50, 17);
    ctx.fill();
    // tail
    ctx.strokeStyle = color;
    ctx.lineWidth = kind === "dog" ? 9 : 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-46, -16);
    ctx.quadraticCurveTo(-72, -10 + Math.sin(t * 2) * 3, -80, -4);
    ctx.stroke();
    head(ctx, kind, color, dark, light, 44, -24, { ...p, closed: true }, t);
    ctx.restore();
    return;
  }

  if (p.pose === "sit") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-18, -8);
    ctx.quadraticCurveTo(-55, -4, -52 + Math.sin(t * 3) * 8, -34);
    ctx.stroke();
    ctx.fillStyle = color;
    ell(ctx, 0, -42, 28, 38);
    ctx.fill();
    ctx.fillStyle = light;
    ell(ctx, 8, -38, 14, 26);
    ctx.fill();
    limb(ctx, 10, -30, 12, 0, 9, dark);
    limb(ctx, 20, -30, 22, 0, 9, color);
    head(ctx, kind, color, dark, light, 12, -90, p, t);
    ctx.restore();
    return;
  }

  // standing / moving
  const sw = p.swing * 0.55;
  const legs: [number, number][] = [
    [-28, p.phase],
    [-16, p.phase + Math.PI],
    [20, p.phase + Math.PI],
    [32, p.phase],
  ];
  legs.forEach(([lx, ph], i) => {
    const a = Math.sin(ph) * sw;
    limb(ctx, lx, -34, lx + Math.sin(a) * leg, -34 + Math.cos(a) * (leg + 4), kind === "dog" ? 11 : 9, i % 2 ? color : dark);
  });
  // tail
  ctx.strokeStyle = kind === "rabbit" ? "#fff" : color;
  ctx.lineCap = "round";
  if (kind === "rabbit") {
    ctx.fillStyle = "#fff";
    circle(ctx, -40, -46, 10);
    ctx.fill();
  } else {
    const wag = Math.sin(t * (kind === "dog" ? 14 : 3)) * (kind === "dog" ? 14 : 10);
    ctx.lineWidth = kind === "dog" ? 9 : 8;
    ctx.beginPath();
    ctx.moveTo(-40, -48);
    if (kind === "cat") ctx.bezierCurveTo(-70, -50, -64 + wag, -96, -50 + wag, -104);
    else ctx.quadraticCurveTo(-60, -60, -64 + wag * 0.4, -80 + Math.abs(wag) * 0.3);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ell(ctx, 0, -46, kind === "rabbit" ? 36 : 44, kind === "rabbit" ? 26 : 22);
  ctx.fill();
  ctx.fillStyle = light;
  ell(ctx, 6, -36, 26, 9);
  ctx.fill();
  const bob = Math.sin(p.phase * 2) * 2 * p.swing;
  head(ctx, kind, color, dark, light, kind === "rabbit" ? 34 : 46, -68 + bob + p.dip * 36, p, t);
  ctx.restore();
}

function head(ctx: CanvasRenderingContext2D, kind: "cat" | "dog" | "rabbit", color: string, dark: string, light: string, x: number, y: number, p: Pose, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(p.tilt);
  const r = kind === "dog" ? 25 : 23;
  if (kind === "rabbit") {
    const flop = Math.sin(t * 2) * 0.08;
    for (const [dx, rot] of [
      [-7, -0.15 + flop],
      [7, 0.15 - flop],
    ]) {
      ctx.fillStyle = color;
      ell(ctx, dx, -34, 7, 26, rot);
      ctx.fill();
      ctx.fillStyle = "#f5b6c4";
      ell(ctx, dx, -34, 3.5, 18, rot);
      ctx.fill();
    }
  }
  if (kind === "cat") {
    ctx.fillStyle = color;
    for (const dx of [-13, 11]) {
      ctx.beginPath();
      ctx.moveTo(dx - 10, -12);
      ctx.lineTo(dx, -34);
      ctx.lineTo(dx + 10, -12);
      ctx.fill();
    }
    ctx.fillStyle = "#f5b6c4";
    for (const dx of [-13, 11]) {
      ctx.beginPath();
      ctx.moveTo(dx - 5, -14);
      ctx.lineTo(dx, -27);
      ctx.lineTo(dx + 5, -14);
      ctx.fill();
    }
  }
  ctx.fillStyle = color;
  circle(ctx, 0, 0, r);
  ctx.fill();
  if (kind === "dog") {
    ctx.fillStyle = dark;
    ell(ctx, -18, 4, 9, 20, 0.35 + Math.sin(t * 3) * 0.08);
    ctx.fill();
    ell(ctx, 16, 4, 9, 20, -0.35 - Math.sin(t * 3) * 0.08);
    ctx.fill();
    ctx.fillStyle = light;
    ell(ctx, 10, 10, 16, 11);
    ctx.fill();
  } else {
    ctx.fillStyle = light;
    ell(ctx, 6, 10, 12, 8);
    ctx.fill();
  }
  eyes(ctx, -2, -4, 3.6, p, t);
  eyes(ctx, 13, -4, 3.6, p, t);
  ctx.fillStyle = kind === "dog" ? "#1c1c22" : "#e7718d";
  ell(ctx, 10, 6, kind === "dog" ? 5 : 3.5, kind === "dog" ? 4 : 2.6);
  ctx.fill();
  if (p.happy) {
    ctx.fillStyle = "#b8324a";
    ell(ctx, 8, 14, 5, 4);
    ctx.fill();
  }
  if (kind === "cat") {
    ctx.strokeStyle = "rgba(40,40,40,0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const dy of [-2, 3]) {
      ctx.moveTo(14, 8 + dy);
      ctx.lineTo(34, 5 + dy * 2);
      ctx.moveTo(6, 8 + dy);
      ctx.lineTo(-14, 5 + dy * 2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function bird(ctx: CanvasRenderingContext2D, color: string, p: Pose, t: number, flying: boolean) {
  const dark = shade(color, -45);
  if (!flying) {
    limb(ctx, -3, -8, -4, 0, 2.5, "#d9822b");
    limb(ctx, 5, -8, 6, 0, 2.5, "#d9822b");
  }
  ctx.save();
  ctx.translate(0, flying ? 0 : -18);
  ctx.fillStyle = color;
  ell(ctx, 0, 0, 20, 13);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-16, -2);
  ctx.lineTo(-32, -8);
  ctx.lineTo(-30, 6);
  ctx.fill();
  ctx.fillStyle = shade(color, 40);
  ell(ctx, 4, 5, 12, 6);
  ctx.fill();
  ctx.fillStyle = color;
  circle(ctx, 18, -10, 10);
  ctx.fill();
  ctx.fillStyle = "#f2a531";
  ctx.beginPath();
  ctx.moveTo(26, -12);
  ctx.lineTo(36, -8);
  ctx.lineTo(26, -5);
  ctx.fill();
  eyes(ctx, 21, -12, 2.4, p, t);
  const wing = flying ? Math.sin(p.flap * TAU) : 0.2;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(-6, -4);
  ctx.quadraticCurveTo(-4, -4 - 34 * wing, 12, -2 - 30 * wing);
  ctx.lineTo(8, -2);
  ctx.fill();
  ctx.restore();
}

function butterfly(ctx: CanvasRenderingContext2D, color: string, p: Pose) {
  const open = 0.25 + 0.75 * Math.abs(Math.sin(p.flap * Math.PI));
  const inner = shade(color, -60);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side * open, 1);
    ctx.fillStyle = color;
    ell(ctx, 16, -12, 17, 21, 0.5);
    ctx.fill();
    ell(ctx, 13, 12, 11, 13, -0.4);
    ctx.fill();
    ctx.fillStyle = inner;
    circle(ctx, 17, -13, 5);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = "#2a2230";
  ell(ctx, 0, 0, 3.5, 17);
  ctx.fill();
  ctx.strokeStyle = "#2a2230";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -15);
  ctx.quadraticCurveTo(-6, -28, -10, -30);
  ctx.moveTo(0, -15);
  ctx.quadraticCurveTo(6, -28, 10, -30);
  ctx.stroke();
}

function fish(ctx: CanvasRenderingContext2D, color: string, p: Pose, t: number) {
  ctx.save();
  ctx.rotate(Math.sin(t * 3) * 0.08);
  ctx.fillStyle = color;
  ctx.save();
  ctx.translate(-26, 0);
  ctx.rotate(Math.sin(t * 10) * 0.35);
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(-18, -16);
  ctx.lineTo(-18, 16);
  ctx.fill();
  ctx.restore();
  ell(ctx, 0, 0, 30, 17);
  ctx.fill();
  ctx.fillStyle = shade(color, 40);
  ell(ctx, 2, 6, 18, 6);
  ctx.fill();
  ctx.fillStyle = shade(color, -40);
  ctx.beginPath();
  ctx.moveTo(-4, -14);
  ctx.quadraticCurveTo(4, -28, 12, -14);
  ctx.fill();
  eyes(ctx, 16, -4, 3.2, p, t);
  ctx.restore();
}

function human(ctx: CanvasRenderingContext2D, color: string, p: Pose, t: number, action: Action, child: boolean, seed: number) {
  const skin = ["#f1c7a0", "#d9a27a", "#a8704a", "#7a4e32"][seed % 4];
  const hair = ["#2b1d14", "#4a2f1d", "#1a1a1a", "#7a4a24"][(seed >> 2) % 4];
  const pants = "#2f3a55";
  const sw = p.swing * 0.6;
  ctx.save();
  if (child) ctx.scale(0.72, 0.72);
  ctx.rotate(p.roll);
  if (p.pose === "lie") {
    ctx.rotate(-Math.PI / 2);
    ctx.translate(-20, -40);
  }
  const hipY = p.pose === "sit" ? -40 : -70;
  // legs
  if (p.pose === "sit") {
    limb(ctx, -6, hipY, 22, hipY, 12, pants);
    limb(ctx, 22, hipY, 24, 0, 11, pants);
  } else {
    for (const ph of [p.phase, p.phase + Math.PI]) {
      const a = Math.sin(ph) * sw;
      limb(ctx, 0, hipY, Math.sin(a) * 40, hipY + Math.cos(a) * 68, 12, pants);
    }
  }
  // arms
  const armUp = action === "dance" || action === "laugh" ? 1 : 0;
  for (const [ph, side] of [
    [p.phase + Math.PI, -1],
    [p.phase, 1],
  ] as [number, number][]) {
    const a = armUp ? -2.4 * side + Math.sin(t * 6) * 0.3 : Math.sin(ph) * sw;
    limb(ctx, 0, hipY - 58, Math.sin(a) * 44, hipY - 58 + Math.cos(a) * 46, 9, skin);
  }
  // torso
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-16, hipY - 66, 32, 70, 12);
  ctx.fill();
  // head
  ctx.save();
  ctx.translate(0, hipY - 90);
  ctx.rotate(p.tilt);
  ctx.fillStyle = skin;
  circle(ctx, 0, 0, 22);
  ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.arc(0, -3, 23, Math.PI * 1.02, Math.PI * 1.98);
  ctx.fill();
  eyes(ctx, 3, -2, 2.8, p, t);
  eyes(ctx, 13, -2, 2.8, p, t);
  ctx.strokeStyle = "#7a2f2f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (p.happy) ctx.arc(9, 7, 6, 0.1 * Math.PI, 0.9 * Math.PI);
  else ctx.arc(9, 9, 4, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function car(ctx: CanvasRenderingContext2D, color: string, x: number, night: boolean) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-80, -62, 160, 40, 12);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-46, -94, 88, 36, 14);
  ctx.fill();
  ctx.fillStyle = night ? "#2a3a55" : "#bfe3ff";
  ctx.beginPath();
  ctx.roundRect(-38, -88, 34, 26, 6);
  ctx.roundRect(2, -88, 34, 26, 6);
  ctx.fill();
  ctx.fillStyle = "#ffe79a";
  circle(ctx, 76, -48, 6);
  ctx.fill();
  if (night) {
    const glow = ctx.createLinearGradient(80, 0, 260, 0);
    glow.addColorStop(0, "rgba(255,240,170,0.5)");
    glow.addColorStop(1, "rgba(255,240,170,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(80, -52);
    ctx.lineTo(260, -80);
    ctx.lineTo(260, 0);
    ctx.fill();
  }
  for (const wx of [-48, 48]) {
    ctx.fillStyle = "#1c1c22";
    circle(ctx, wx, -20, 20);
    ctx.fill();
    ctx.fillStyle = "#b8bcc6";
    circle(ctx, wx, -20, 9);
    ctx.fill();
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 3;
    const a = x / 20;
    ctx.beginPath();
    ctx.moveTo(wx + Math.cos(a) * 9, -20 + Math.sin(a) * 9);
    ctx.lineTo(wx - Math.cos(a) * 9, -20 - Math.sin(a) * 9);
    ctx.stroke();
  }
}

function ball(ctx: CanvasRenderingContext2D, color: string, spin: number) {
  ctx.save();
  ctx.rotate(spin);
  ctx.fillStyle = color;
  circle(ctx, 0, -18, 18);
  ctx.fill();
  ctx.fillStyle = "#e0453a";
  ctx.beginPath();
  ctx.arc(0, -18, 18, -0.5, 0.5);
  ctx.arc(0, -18, 18, Math.PI - 0.5, Math.PI + 0.5);
  ctx.fill();
  ctx.fillStyle = "#3a7be0";
  ell(ctx, 0, -18, 5, 18);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- motion

type Placed = { kind: Kind; x: number; y: number; s: number; f: number; pose: Pose; color: string; action: Action; seed: number; air: boolean; spin: number };

const FLYING: Kind[] = ["bird", "butterfly"];

function basePose(): Pose {
  return { phase: 0, swing: 0, pose: "stand", tilt: 0, dip: 0, happy: false, closed: false, flap: 0, roll: 0 };
}

function waterY(place: Place) {
  if (place === "sea") return [HORIZON + 30, GROUND - 60];
  if (place === "river") return [HORIZON + 62, HORIZON + 118];
  return [GROUND - 70, GROUND - 20];
}

function placeScene(s: SceneCode, t: number): Placed[] {
  const out: Placed[] = [];
  const subject = s.actors[0];
  // shared anchor so chasers and the chased stay together
  const chaseSpeed = 120;
  const leadX = wrap(W * 0.15 + t * chaseSpeed, 160);

  s.actors.forEach((a, gi) => {
    const n = a.count;
    for (let j = 0; j < n; j++) {
      const seed = gi * 7 + j * 3 + 1;
      const ph = j * 1.9 + gi * 0.8;
      const depth = (j % 2) * 26 + gi * 14;
      const s0 = a.size * (0.9 + depth / 260) * (a.kind === "car" ? 1.1 : a.kind === "person" || a.kind === "child" ? 1.25 : 1.4);
      const pose = basePose();
      let x = W * (0.3 + (0.45 * (j + 0.5)) / n) + (gi - 0.5) * 60;
      let y = GROUND + depth;
      let f = gi % 2 ? -1 : 1;
      let air = false;
      let spin = 0;
      const flyer = FLYING.includes(a.kind);
      let action = a.action;
      if (action === "fly" && !flyer) action = "jump";
      if (flyer && action !== "sit" && action !== "sleep" && action !== "eat") action = action === "chase" ? "chase" : "fly";
      if (a.kind === "fish") action = "swim";
      if (a.kind === "car") action = action === "sleep" || action === "sit" ? "idle" : "run";

      switch (action) {
        case "walk":
        case "run": {
          const v = action === "run" ? (a.kind === "car" ? 210 : 170) : 55;
          x = wrap(x + t * v * f);
          pose.phase = t * (action === "run" ? 13 : 6) + ph;
          pose.swing = 1;
          break;
        }
        case "chase": {
          x = wrap(leadX - 120 - j * 80 - gi * 50, 160);
          f = 1;
          pose.phase = t * 12 + ph;
          pose.swing = 1;
          if (flyer) {
            air = true;
            y = HORIZON - 40 + Math.sin(t * 2 + ph) * 40;
          }
          break;
        }
        case "play": {
          const cx = W / 2 + (j - (n - 1) / 2) * 150 + (gi ? 90 : 0);
          x = cx + Math.sin(t * 1.4 + ph) * 50;
          f = Math.cos(t * 1.4 + ph) > 0 ? 1 : -1;
          y -= Math.abs(Math.sin(t * 3.2 + ph)) * 46;
          pose.phase = t * 9 + ph;
          pose.swing = 0.8;
          pose.happy = true;
          break;
        }
        case "jump": {
          y -= Math.max(0, Math.sin(t * 4 + ph)) * 110;
          x = wrap(x + t * 30 * f);
          pose.phase = Math.PI / 2;
          pose.swing = Math.sin(t * 4 + ph) > 0 ? 0.9 : 0;
          break;
        }
        case "fly": {
          air = true;
          const v = a.kind === "bird" ? 110 : 60;
          x = wrap(x + t * v * f, 60);
          y = HORIZON - 160 + j * 55 + Math.sin(t * (a.kind === "bird" ? 1.6 : 2.6) + ph) * 60;
          break;
        }
        case "swim": {
          const [y0, y1] = waterY(s.place);
          air = true;
          x = wrap(x + t * 70 * f, 60);
          y = y0 + ((j + 0.5) / n) * (y1 - y0) + Math.sin(t * 2 + ph) * 8;
          break;
        }
        case "sleep":
          pose.pose = "lie";
          pose.closed = true;
          break;
        case "laugh":
          pose.happy = true;
          y -= Math.abs(Math.sin(t * 9 + ph)) * 14;
          pose.roll = Math.sin(t * 9 + ph) * 0.06;
          break;
        case "eat":
          pose.dip = (Math.sin(t * 4 + ph) + 1) / 2;
          break;
        case "dance":
          pose.roll = Math.sin(t * 5 + ph) * 0.18;
          y -= Math.abs(Math.sin(t * 5 + ph)) * 26;
          pose.phase = t * 5;
          pose.swing = 0.6;
          pose.happy = true;
          break;
        case "sit":
          pose.pose = "sit";
          break;
        case "look":
          pose.pose = "sit";
          pose.tilt = -0.4;
          break;
        default:
          break;
      }
      if (flyer) pose.flap = t * (a.kind === "bird" ? 3.5 : 2.6) + ph;
      if (a.kind === "person" || a.kind === "child") {
        if (action === "look") pose.pose = "stand";
      }
      if (["sit", "look", "sleep", "eat", "laugh", "idle"].includes(action) && s.actors.length + n > 1) {
        f = x < W / 2 ? 1 : -1;
      }
      out.push({ kind: a.kind, x, y, s: s0, f, pose, color: a.color || DEFAULT_COLOR[a.kind], action, seed, air, spin });
    }
  });

  // the chased / played-with target
  if (s.target && subject) {
    const tk = s.target;
    const pose = basePose();
    let x = leadX;
    let y = GROUND + 10;
    let air = FLYING.includes(tk);
    let spin = 0;
    if (subject.action === "play") {
      x = W / 2 + Math.sin(t * 2.1) * 130;
      if (tk === "ball") {
        y = GROUND + 10 - Math.abs(Math.sin(t * 4.2)) * 150;
        spin = t * 6;
      }
    }
    if (air) {
      y = HORIZON - 40 + Math.sin(t * 2.4) * 60 - (subject.action === "play" ? 80 : 0);
      pose.flap = t * 3;
    } else if (tk !== "ball") {
      pose.phase = t * 13;
      pose.swing = 1;
    }
    if (tk === "fish") {
      air = true;
      y = waterY(s.place)[0] + 20;
    }
    if (tk === "ball" && subject.action === "chase") spin = t * 8;
    out.push({ kind: tk, x, y, s: 1.2, f: 1, pose, color: DEFAULT_COLOR[tk], action: tk === "ball" ? "idle" : "run", seed: 99, air, spin });
  }
  return out;
}

function drawPlaced(ctx: CanvasRenderingContext2D, a: Placed, t: number, night: boolean) {
  // ground shadow
  if (!a.air) {
    const lift = Math.max(0, GROUND - a.y + 10) / 200;
    ctx.fillStyle = `rgba(0,0,0,${0.18 * (1 - Math.min(0.8, lift))})`;
    ell(ctx, a.x, Math.max(a.y, GROUND) + 2, (a.kind === "car" ? 90 : a.kind === "person" || a.kind === "child" ? 28 : 46) * a.s * (1 - lift * 0.4), 8 * a.s);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.scale(a.s * a.f, a.s);
  switch (a.kind) {
    case "cat":
    case "dog":
    case "rabbit":
      quadruped(ctx, a.kind, a.color, a.pose, t);
      break;
    case "bird":
      bird(ctx, a.color, a.pose, t, a.air);
      break;
    case "butterfly":
      butterfly(ctx, a.color, a.pose);
      break;
    case "fish":
      fish(ctx, a.color, a.pose, t);
      break;
    case "person":
    case "child":
      human(ctx, a.color, a.pose, t, a.action, a.kind === "child", a.seed);
      break;
    case "car":
      car(ctx, a.color, a.x, night);
      break;
    case "ball":
      ball(ctx, a.color, a.spin);
      break;
  }
  ctx.restore();
  // little extras that sell the action
  if (a.action === "sleep") {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 22px sans-serif";
    for (let k = 0; k < 3; k++) {
      const p = (t * 0.5 + k / 3) % 1;
      ctx.globalAlpha = 1 - p;
      ctx.fillText("z", a.x + a.f * (40 + p * 30) * a.s, a.y - (40 + p * 70) * a.s);
    }
    ctx.globalAlpha = 1;
  }
  if (a.action === "swim" && a.kind === "fish") {
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      const p = (t * 0.7 + k / 3 + a.seed * 0.1) % 1;
      circle(ctx, a.x + a.f * 34 * a.s, a.y - p * 60, 3 + k);
      ctx.stroke();
    }
  }
  if (a.action === "eat" && !a.air) {
    ctx.fillStyle = "#3a7be0";
    ctx.beginPath();
    ctx.ellipse(a.x + a.f * 72 * a.s, a.y - 6, 22 * a.s, 10 * a.s, 0, 0, Math.PI);
    ctx.fill();
  }
}

function pond(ctx: CanvasRenderingContext2D, t: number, night: boolean) {
  ctx.save();
  ell(ctx, W / 2, GROUND - 45, W * 0.46, 60);
  ctx.clip();
  water(ctx, GROUND - 110, GROUND + 20, t, night);
  ctx.restore();
  ctx.strokeStyle = "rgba(90,70,50,0.6)";
  ctx.lineWidth = 6;
  ell(ctx, W / 2, GROUND - 45, W * 0.46, 60);
  ctx.stroke();
}

// ---------------------------------------------------------------- captions

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function drawCaption(ctx: CanvasRenderingContext2D, caption: string, p: number) {
  if (!caption) return;
  const shadeG = ctx.createLinearGradient(0, H * 0.72, 0, H);
  shadeG.addColorStop(0, "rgba(0,0,0,0)");
  shadeG.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = shadeG;
  ctx.fillRect(0, H * 0.72, W, H * 0.28);
  const appear = Math.min(1, Math.max(0, (p - 0.06) / 0.18));
  ctx.globalAlpha *= appear;
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 10;
  const lines = wrapLines(ctx, caption, W - 80);
  const baseY = H - 110 - (lines.length - 1) * 46 + (1 - appear) * 24;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, baseY + i * 46));
  ctx.shadowBlur = 0;
}

// ---------------------------------------------------------------- scene

/** Draws one frame of a scene. t = seconds into the scene, dur = scene length. */
export function drawScene(ctx: CanvasRenderingContext2D, s: SceneCode, t: number, dur: number, index: number, alpha = 1, captions = true) {
  const p = Math.min(1, Math.max(0, t / dur));
  const night = s.time === "night";
  ctx.save();
  ctx.globalAlpha = alpha;
  // slow camera push-in, direction alternates per scene
  const z = 1 + 0.06 * ease(p);
  const panX = (index % 2 ? -1 : 1) * 14 * ease(p);
  ctx.translate(W / 2 + panX, H / 2);
  ctx.scale(z, z);
  ctx.translate(-W / 2, -H / 2);

  const seed = index * 1013 + s.place.length * 17 + 5;
  drawSky(ctx, s, t, rng(seed));
  drawClouds(ctx, s, t, rng(seed + 1));
  drawPlace(ctx, s, t, rng(seed + 2));

  const placed = placeScene(s, t);
  if (placed.some((a) => a.kind === "fish") && s.place !== "sea" && s.place !== "river") pond(ctx, t, night);
  placed.sort((a, b) => a.y - b.y).forEach((a) => drawPlaced(ctx, a, t, night));

  weather(ctx, s.weather, t, rng(seed + 3));
  foreground(ctx, s, t, rng(seed + 4));

  if (night && s.place !== "space" && s.place !== "house") {
    ctx.fillStyle = "rgba(10,20,70,0.28)";
    ctx.fillRect(0, 0, W, H);
  } else if (s.time === "sunset") {
    ctx.fillStyle = "rgba(255,120,60,0.12)";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  if (captions) drawCaption(ctx, s.caption, p);
  ctx.restore();
}

export type { Actor };
