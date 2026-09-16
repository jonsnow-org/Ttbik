import { ImageResponse } from "next/og";

// PWA manifest icon (512x512) — see pwa-icon-192/route.tsx for why this
// exists alongside the 32x32 favicon route.
export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0284c7",
          borderRadius: 100,
        }}
      >
        <svg width="320" height="320" viewBox="0 0 24 24" fill="none">
          <path
            d="M8 15.5 14.8 8.7a1.6 1.6 0 0 1 2.3 2.3L10.3 17.8a1.9 1.9 0 0 1-1.3.55H7v-2a1.9 1.9 0 0 1 .55-1.33Z"
            stroke="white"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M13 10.5l2.3 2.3" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
