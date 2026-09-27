import { ImageResponse } from "next/og";
import { SITE_URL } from "@/lib/siteUrl";

// Default social-share card. The designed artwork lives in /public/og as a
// static JPG (Arabic text already rendered into it), so this never depends on
// fetching a web font at request time — that fetch failing is what produced
// the empty blue card seen in Telegram previews.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "سوق تولز — سوق الخدمات والأدوات الرقمية المصغّرة";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`${SITE_URL}/og/cover.jpg`} width={1200} height={630} alt="" style={{ width: "100%", height: "100%" }} />
    ),
    { ...size }
  );
}
