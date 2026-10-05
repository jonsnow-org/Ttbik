// Text drawn as outlines, so a picture looks the same on every renderer, including the servers of markets and wallets that have no fonts
// (they print empty boxes for <text>). See glyphs.data.ts. Kerning is not applied; letter-spacing is, as SVG does.
import { GLYPHS } from "./glyphs.data";

export type TextOpts = {
  x: number; y: number; size: number;
  font?: "sans" | "serif";
  anchor?: "start" | "middle";
  spacing?: number;                 // letter-spacing, in the same units as size
  fill: string; opacity?: number;
};

const AR = "";                // the header word أثر (joined forms), drawn left to right as it is read right to left
const num = (n: number) => String(Math.round(n * 100) / 100);

export function textWidth(str: string, size: number, font: "sans" | "serif" = "sans", spacing = 0): number {
  const g = GLYPHS[font]; let w = 0, n = 0;
  for (const ch of str.replace(/أثر/g, AR)) { const e = g[ch] ?? g["?"]; w += e[0] * size / 1000 + spacing; n++; }
  return n ? w - spacing : 0;
}

/** `str` as one <g> of outlines. Characters the font does not hold are drawn as "?". */
export function textPaths(str: string, o: TextOpts): string {
  const font = o.font ?? "sans", g = GLYPHS[font], k = o.size / 1000, sp = (o.spacing ?? 0) / k;
  const text = str.replace(/أثر/g, AR);
  let total = 0; const items: [number, string | [string, number, string][]][] = [];
  for (const ch of text) { const e = g[ch] ?? g["?"]; items.push([total, e[1]]); total += e[0] + sp; }
  total -= items.length ? sp : 0;
  const x0 = o.anchor === "middle" ? o.x - (total * k) / 2 : o.x;
  let body = "";
  for (const [dx, d] of items) {
    if (typeof d === "string") { if (d) body += `<path transform="translate(${num(dx)} 0)" d="${d}"/>`; }
    else for (const [, ox, pd] of d) body += `<path transform="translate(${num(dx + ox)} 0)" d="${pd}"/>`;
  }
  return `<g data-t="${str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}" transform="translate(${num(x0)} ${num(o.y)}) scale(${Math.round(k * 1e5) / 1e5})" fill="${o.fill}"${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ""}>${body}</g>`;
}
