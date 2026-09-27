import { readFile } from "node:fs/promises";
import path from "node:path";

// Default social-share card. The designed artwork lives in /public/og as a
// static JPG (Arabic text already rendered into it). This route is
// prerendered at build time, so it reads the file from disk rather than
// fetching it over HTTP (the file isn't online yet during the build).
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";
export const alt = "سوق تولز — سوق الخدمات والأدوات الرقمية المصغّرة";

export default async function OpengraphImage() {
  const data = await readFile(path.join(process.cwd(), "public", "og", "cover.jpg"));
  return new Response(data, { headers: { "Content-Type": "image/jpeg" } });
}
